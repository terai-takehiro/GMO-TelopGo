/**
 * グローバルアプリケーション状態
 *
 * v2.0: ランダウン (番組 > 放送 > コーナー > ページ) を中核データにする。
 * ページ = { id, pageNo, templateKey, values, note, duration, locked }
 * ページの出力チャンネルはテンプレートの region から決まる。
 */
const App = {
  /** 出力チャンネル [{id, label, region, color}] (settingsから) */
  channels: [],

  /** 出力グループ [{id, label, channels: [region...]}] (複数系統を1URLへ合成) */
  outputGroups: [],

  /** ランダウン全体 { programs, activeProgramId, activeBroadcastId, namePool } */
  rundown: null,

  /** グラフィックステンプレート情報 { key: { region, bindings: [] } } */
  templates: {},

  /** チャンネルごとの送出状態 { [channelId]: { onAirPageId, nextPageId, onAirSummary, onAirAt } } */
  broadcast: {},

  /** リハーサルモード (ONの間は出力サーバへ送らない) */
  rehearsal: false,

  // ===== モード (リアルタイムCG / 電テロ) =====

  /** 現在の送出モード ('cg' | 'telop' | 'sports') */
  get activeMode() {
    return (this.rundown && this.rundown.activeMode) || 'cg';
  },

  /** 現在モードのランダウンツリー { programs, activeProgramId, activeBroadcastId } */
  modeTree() {
    if (!this.rundown) return null;
    return this.rundown[this.activeMode] || null;
  },

  /** 送出モードを切り替える */
  setMode(mode) {
    if (!this.rundown || (mode !== 'cg' && mode !== 'telop' && mode !== 'sports')) return;
    this.rundown.activeMode = mode;
    this.saveRundown();
  },

  /**
   * スポーツモード: アクティブ放送(=試合)の試合状態。無ければ既定値で生成する。
   * rundown内に保存するため、永続化と2台運用の状態同期に自動で乗る。
   */
  match() {
    const bc = this.activeBroadcast();
    if (!bc) return null;
    if (!bc.match) bc.match = {};
    return this.normalizeMatch(bc.match);
  },

  /** 試合状態の既定値補完 (旧v2.8 matchの移行も兼ねる) */
  normalizeMatch(m) {
    if (!m.sport) m.sport = 'generic';
    if (!m.templateKey) m.templateKey = 'sports-score';
    if (!m.channelId) m.channelId = (this.channels[0] && this.channels[0].id) || 'tl1';
    const team = (t, defName, defColor) => {
      m[t] = m[t] || {};
      const o = m[t];
      if (o.name === undefined) o.name = defName;
      if (o.short === undefined) o.short = defName[0] || defName;
      if (o.color === undefined) o.color = defColor;
      if (typeof o.score !== 'number') o.score = 0;
      if (typeof o.sets !== 'number') o.sets = 0;
      if (!Array.isArray(o.roster)) o.roster = [];
      if (typeof o.atBat !== 'number') o.atBat = 0;
    };
    team('home', 'HOME', '#d92d20');
    team('away', 'AWAY', '#1d7ff0');
    if (typeof m.period !== 'number') m.period = 1;
    if (!m.clock) m.clock = { mode: 'up', durationSec: 2400, baseMs: 0, running: false, startedAt: 0 };
    if (!m.bb) m.bb = { balls: 0, strikes: 0, outs: 0, inning: 1, top: true, bases: [false, false, false] };
    if (!m.meta) m.meta = { tournament: '', game: '', place: '', date: '', time: '' };
    if (!m.linescore) m.linescore = { home: [], away: [], inningsShown: 9 };
    if (!m.title) m.title = { text: '', sub: '', bold: true, edge: false, bg: true };
    if (!Array.isArray(m.widgets)) m.widgets = this.defaultWidgets();
    return m;
  },

  /** 野球の既定オンエアウィンドウ一式 (各1region、既定は無変換=テンプレの定位置) */
  defaultWidgets() {
    const w = (id, key, label, templateKey, region) => ({
      id, key, label, templateKey, region, x: 0, y: 0, scale: 1, onAir: false, opts: {},
    });
    return [
      w('wsb', 'scoreboard', 'スコアボード', 'bb-scoreboard', 'sb'),
      w('wbso', 'bso', 'BSO', 'bb-bso', 'bso'),
      w('wrun', 'runners', '走者', 'bb-runners', 'runners'),
      w('wbig', 'scoreBig', '得点(大)', 'bb-score-big', 'score-big'),
      w('wttl', 'title', 'タイトル', 'bb-title', 'title'),
      w('wply', 'player', '選手紹介', 'bb-player', 'player'),
    ];
  },

  // ===== ランダウンアクセサ (現在モードツリー起点) =====

  activeProgram() {
    const tree = this.modeTree();
    if (!tree) return null;
    return tree.programs.find((p) => p.id === tree.activeProgramId) || tree.programs[0] || null;
  },

  activeBroadcast() {
    const program = this.activeProgram();
    if (!program) return null;
    const tree = this.modeTree();
    return program.broadcasts.find((b) => b.id === tree.activeBroadcastId)
      || program.broadcasts[0] || null;
  },

  setActiveProgram(id) {
    const tree = this.modeTree();
    if (tree) { tree.activeProgramId = id; tree.activeBroadcastId = null; }
  },

  setActiveBroadcast(id) {
    const tree = this.modeTree();
    if (tree) tree.activeBroadcastId = id;
  },

  corners() {
    const broadcast = this.activeBroadcast();
    return broadcast ? broadcast.corners : [];
  },

  /** ページIDから {page, corner, list} を探す (pages/standby両方) */
  findPage(pageId) {
    for (const corner of this.corners()) {
      for (const listName of ['pages', 'standby']) {
        const page = (corner[listName] || []).find((pg) => pg.id === pageId);
        if (page) return { page, corner, list: listName };
      }
    }
    return null;
  },

  /** ページ番号からページを探す (アクティブ放送内・プレイリストのみ) */
  findPageByNo(pageNo) {
    const target = String(pageNo).trim();
    for (const corner of this.corners()) {
      const page = (corner.pages || []).find((pg) => String(pg.pageNo) === target);
      if (page) return { page, corner };
    }
    return null;
  },

  /**
   * ページの出力チャンネルID。
   * 電テロ (静止画/作画) ページは page.channelId を直接持つ。
   * リアルタイムCGページはテンプレートの region から決まる。
   */
  channelOfPage(page) {
    if (page.channelId) return page.channelId;
    const tpl = this.templates[page.templateKey];
    return tpl ? tpl.region : null;
  },

  channelById(id) {
    return this.channels.find((c) => c.id === id) || null;
  },

  /** チャンネルの送出状態スロット */
  chState(channelId) {
    if (!this.broadcast[channelId]) {
      this.broadcast[channelId] = { onAirPageId: null, nextPageId: null, onAirSummary: '', onAirAt: 0 };
    }
    return this.broadcast[channelId];
  },

  anyOnAir() {
    return Object.values(this.broadcast).some((st) => st && st.onAirPageId !== null);
  },

  // ===== 永続化 (デバウンス自動保存) =====

  _saveTimer: null,
  saveRundown() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this.rundown && window.api.rundownSet) {
        window.api.rundownSet(JSON.parse(JSON.stringify(this.rundown)));
      }
    }, 400);
  },

  /** グラフィックスプロジェクトからテンプレート情報を取り込む */
  loadTemplatesFrom(project) {
    const templates = {};
    Object.entries((project && project.templates) || {}).forEach(([key, tpl]) => {
      const bindings = [];
      ['jp', 'en'].forEach((lang) => {
        const variant = tpl.variants && tpl.variants[lang];
        ((variant && variant.layers) || []).forEach((layer) => {
          if (layer.type === 'text' && layer.binding && !bindings.includes(layer.binding)) {
            bindings.push(layer.binding);
          }
        });
      });
      templates[key] = { region: tpl.region || 'name', bindings, label: tpl.label || key };
    });
    this.templates = templates;
    this.graphicsProject = project;
  },

  /**
   * ステータスバーにメッセージを表示
   */
  setStatus(message, type = 'info') {
    const el = document.getElementById('status-text');
    el.textContent = message;
    el.style.color = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--text-muted)';
  },
};

// --- 終了時の確認 (送出中 / デザイン未保存) ---
let allowAppClose = false;
window.addEventListener('beforeunload', (e) => {
  if (allowAppClose) return;

  const reasons = [];
  if (App.anyOnAir()) {
    reasons.push('・テロップが送出中です (終了するとvMixの表示が消えます)');
  }
  if (typeof DesignEditor !== 'undefined' && DesignEditor.dirty) {
    reasons.push('・デザインに未保存の変更があります');
  }
  if (reasons.length === 0) return;

  // いったん終了をキャンセルし、確認してから閉じ直す
  e.preventDefault();
  e.returnValue = false;
  setTimeout(() => {
    if (confirm(`${reasons.join('\n')}\n\nこのまま終了しますか?`)) {
      allowAppClose = true;
      window.close();
    }
  }, 0);
});
