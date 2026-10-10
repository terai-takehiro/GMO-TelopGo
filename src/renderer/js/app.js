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

  /** 現在の送出モード ('cg' | 'telop') */
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
    if (!this.rundown || (mode !== 'cg' && mode !== 'telop')) return;
    this.rundown.activeMode = mode;
    this.saveRundown();
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

  /** アクティブ放送に最終オープン時刻を記録 (ホームの「続きから」の並び順) */
  touchBroadcast() {
    const bc = this.activeBroadcast();
    if (bc) bc.openedAt = Date.now();
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

  /** チャンネルの送出状態スロット (prevOnAirPageId = 直前にオンエアしていたページ。かるた取りのCLEAR&BACK用) */
  chState(channelId) {
    if (!this.broadcast[channelId]) {
      this.broadcast[channelId] = { onAirPageId: null, nextPageId: null, onAirSummary: '', onAirAt: 0, prevOnAirPageId: null };
    }
    return this.broadcast[channelId];
  },

  /**
   * 系統の送出方式 (電テロのみ。放送ごとに保持し、2台運用ではランダウンと一緒に同期される)
   *   'list'   = リスト送出: 上から順に。TAKE後にNEXTが次のページへ進む
   *   'karuta' = かるた取り: 札を並べ、クリックした札をNEXTにしてTAKE。TAKE後にNEXTは進めない
   */
  sendMode(channelId) {
    if (this.activeMode !== 'telop') return 'list';
    const bc = this.activeBroadcast();
    return bc && bc.sendModes && bc.sendModes[channelId] === 'karuta' ? 'karuta' : 'list';
  },

  setSendMode(channelId, mode) {
    const bc = this.activeBroadcast();
    if (!bc || this.activeMode !== 'telop') return;
    bc.sendModes = bc.sendModes || {};
    if (mode === 'karuta') bc.sendModes[channelId] = 'karuta';
    else delete bc.sendModes[channelId];
    this.saveRundown();
  },

  anyOnAir() {
    return Object.values(this.broadcast).some((st) => st && st.onAirPageId !== null);
  },

  // ===== 永続化 (デバウンス自動保存) =====

  _saveTimer: null,
  saveRundown() {
    this.recordRundownHistory();
    // ページの内容が変わるとNEXT出力 (?next=1) の描画も変わる
    if (typeof Broadcast !== 'undefined') Broadcast.syncNextOutput();
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      if (this.rundown && window.api.rundownSet) {
        window.api.rundownSet(JSON.parse(JSON.stringify(this.rundown)));
      }
    }, 400);
  },

  /** 自動保存を待たずに今すぐ保存 (Ctrl+S) */
  flushRundown() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (this.rundown && window.api.rundownSet) {
      return window.api.rundownSet(JSON.parse(JSON.stringify(this.rundown)));
    }
    return Promise.resolve();
  },

  // ===== 送出リストの 元に戻す / やり直し (Ctrl+Z / Ctrl+Y) =====
  // 保存のたびにランダウン全体を覚えておく。画面の選択 (モード・番組・放送・最終オープン) だけの変化は履歴に積まない。
  // 送出状態 (ON AIR/NEXT) は App.broadcast にあり、ランダウンの外なので元に戻す対象にならない

  HISTORY_MAX: 50,
  HISTORY_NAV_KEYS: ['activeMode', 'activeProgramId', 'activeBroadcastId', 'openedAt'],
  _hist: { undo: [], redo: [], cur: null, sig: null },
  _histApplying: false,

  _contentSig(rundown) {
    const nav = this.HISTORY_NAV_KEYS;
    return JSON.stringify(rundown, (k, v) => (nav.includes(k) ? undefined : v));
  },

  /** 履歴を今の状態から始め直す (起動時の読込・ファイル読込・2台運用で相手の状態を受け取ったとき) */
  resetRundownHistory() {
    this._hist = { undo: [], redo: [], cur: null, sig: null };
    if (this.rundown) {
      this._hist.cur = JSON.stringify(this.rundown);
      this._hist.sig = this._contentSig(this.rundown);
    }
  },

  recordRundownHistory() {
    if (!this.rundown || this._histApplying) return;
    const h = this._hist;
    const json = JSON.stringify(this.rundown);
    const sig = this._contentSig(this.rundown);
    if (h.cur === null) { h.cur = json; h.sig = sig; return; }
    if (sig === h.sig) { h.cur = json; return; } // 選択の切替だけ
    h.undo.push(h.cur);
    if (h.undo.length > this.HISTORY_MAX) h.undo.shift();
    h.redo = [];
    h.cur = json;
    h.sig = sig;
  },

  /** 履歴の状態へ戻す。画面の選択 (モード・番組・放送) は今のまま */
  _restoreRundown(json) {
    const snap = JSON.parse(json);
    const cur = this.rundown || {};
    snap.activeMode = cur.activeMode || snap.activeMode;
    ['cg', 'telop'].forEach((m) => {
      if (snap[m] && cur[m]) {
        snap[m].activeProgramId = cur[m].activeProgramId;
        snap[m].activeBroadcastId = cur[m].activeBroadcastId;
      }
    });
    this.rundown = snap;
    this._hist.cur = JSON.stringify(snap);
    this._hist.sig = this._contentSig(snap);
    this._histApplying = true;
    try { this.saveRundown(); } finally { this._histApplying = false; }
  },

  undoRundown() {
    const h = this._hist;
    if (!h.undo.length || h.cur === null) return false;
    h.redo.push(h.cur);
    this._restoreRundown(h.undo.pop());
    return true;
  },

  redoRundown() {
    const h = this._hist;
    if (!h.redo.length || h.cur === null) return false;
    h.undo.push(h.cur);
    this._restoreRundown(h.redo.pop());
    return true;
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
      templates[key] = { region: tpl.region || 'name', bindings, label: tpl.label || key, guides: { ...(tpl.varGuides || {}) } };
    });
    this.templates = templates;
    this.graphicsProject = project;
  },

  /**
   * テンプレートのExcelの列 (有効な列のみ・取込/書き出しと同じ順序)。
   * template.excelColumns の順序・見出し・有効/無効に従い、無くなった変数は除外、増えた変数は末尾に追加する
   * (main の templateExcelColumns / デザインエディタの excelColumns と同じ規則)
   */
  excelColumns(templateKey) {
    const tpl = this.graphicsProject && this.graphicsProject.templates && this.graphicsProject.templates[templateKey];
    if (!tpl) return [];
    const fields = [];
    ['jp', 'en'].forEach((lang) => {
      const variant = tpl.variants && tpl.variants[lang];
      ((variant && variant.layers) || []).forEach((layer) => {
        if (layer.type !== 'text' || !layer.binding || fields.some((f) => f.binding === layer.binding)) return;
        fields.push({ binding: layer.binding, label: layer.name || '', sample: layer.sample || layer.text || '' });
      });
    });
    const byBinding = new Map(fields.map((f) => [f.binding, f]));
    const cols = [];
    const seen = new Set();
    (Array.isArray(tpl.excelColumns) ? tpl.excelColumns : []).forEach((c) => {
      const f = c && byBinding.get(c.binding);
      if (!f || seen.has(c.binding)) return;
      seen.add(c.binding);
      cols.push({ ...f, header: String(c.header || '').trim(), enabled: c.enabled !== false });
    });
    fields.forEach((f) => { if (!seen.has(f.binding)) cols.push({ ...f, header: '', enabled: true }); });
    return cols.filter((c) => c.enabled).map((c) => ({
      ...c,
      title: c.header || (c.label && c.label !== c.binding ? `${c.label} [${c.binding}]` : c.binding),
    }));
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
  setTimeout(async () => {
    if (await AppModal.confirm('終了の確認', `${reasons.join('\n')}\n\nこのまま終了しますか?`, { danger: true, okLabel: '終了する' })) {
      allowAppClose = true;
      window.close();
    }
  }, 0);
});
