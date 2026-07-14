/**
 * スポーツコーダー (スポーツ送出モードの操作盤)
 *
 * スコア・ピリオド・試合時計・野球カウントを画面のボタンで操作し、
 * ON AIR中のスコアバグへ graphicsUpdateValues (インプレース更新) で
 * 再テイクなし・無アニメ・即時に反映し続ける。
 *
 * 試合状態は App.match() (= アクティブ放送の broadcast.match) に保存され、
 * rundown として永続化・2台運用の状態同期に自動で乗る。
 *
 * binding規約 (テンプレートのテキストレイヤーが受け取る値):
 *   homeName / homeScore / awayName / awayScore / period / clock
 *   homeSets / awaySets (セット制) / inning / bso / bases (野球)
 */
const SportsUI = {
  onAirHere: false, // このアプリからTAKEした状態か (OA表示ピル用)
  _lastClockStr: null,

  SPORTS: [
    { key: 'generic', label: '汎用 (ピリオド+時計)', template: 'sports-score' },
    { key: 'set', label: 'セット制 (バレー等)', template: 'sports-score' },
    { key: 'baseball', label: '野球 (BSO/イニング/塁)', template: 'sports-baseball' },
  ],

  init() {
    const on = (id, ev, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };

    on('sp-sport', 'change', () => this.mutate((m) => {
      m.sport = document.getElementById('sp-sport').value;
      const def = this.SPORTS.find((s) => s.key === m.sport);
      // 競技の既定テンプレへ自動切替 (ユーザーが独自テンプレを選んでいた場合は維持)
      if (def && (m.templateKey === 'sports-score' || m.templateKey === 'sports-baseball')) {
        m.templateKey = def.template;
      }
    }));
    on('sp-template', 'change', () => this.mutate((m) => {
      m.templateKey = document.getElementById('sp-template').value;
    }));
    on('sp-home-name', 'change', () => this.mutate((m) => { m.home.name = document.getElementById('sp-home-name').value; }));
    on('sp-away-name', 'change', () => this.mutate((m) => { m.away.name = document.getElementById('sp-away-name').value; }));
    on('sp-home-color', 'change', () => this.mutate((m) => { m.home.color = document.getElementById('sp-home-color').value; }));
    on('sp-away-color', 'change', () => this.mutate((m) => { m.away.color = document.getElementById('sp-away-color').value; }));

    // 得点キー (data-team / data-delta)
    document.querySelectorAll('#tab-sports [data-score-delta]').forEach((btn) => {
      btn.addEventListener('click', () => this.mutate((m) => {
        const t = m[btn.dataset.team];
        t.score = Math.max(0, t.score + parseInt(btn.dataset.scoreDelta, 10));
      }));
    });
    // セット数
    document.querySelectorAll('#tab-sports [data-sets-delta]').forEach((btn) => {
      btn.addEventListener('click', () => this.mutate((m) => {
        const t = m[btn.dataset.team];
        t.sets = Math.max(0, (t.sets || 0) + parseInt(btn.dataset.setsDelta, 10));
      }));
    });
    on('sp-set-win-home', 'click', () => this.winSet('home'));
    on('sp-set-win-away', 'click', () => this.winSet('away'));

    // ピリオド
    on('sp-period-up', 'click', () => this.mutate((m) => { m.period += 1; }));
    on('sp-period-down', 'click', () => this.mutate((m) => { m.period = Math.max(1, m.period - 1); }));

    // クロック
    on('sp-clock-toggle', 'click', () => this.toggleClock());
    on('sp-clock-reset', 'click', () => this.mutate((m) => this.resetClock(m)));
    on('sp-clock-mode', 'change', () => this.mutate((m) => {
      m.clock.mode = document.getElementById('sp-clock-mode').value;
      this.resetClock(m);
    }));
    on('sp-clock-duration', 'change', () => this.mutate((m) => {
      const min = Math.max(1, parseInt(document.getElementById('sp-clock-duration').value, 10) || 40);
      m.clock.durationSec = min * 60;
      if (m.clock.mode === 'down') this.resetClock(m);
    }));
    document.querySelectorAll('#tab-sports [data-clock-adjust]').forEach((btn) => {
      btn.addEventListener('click', () => this.mutate((m) => {
        const ms = this.currentClockMs(m) + parseInt(btn.dataset.clockAdjust, 10) * 1000;
        m.clock.baseMs = Math.max(0, ms);
        if (m.clock.running) m.clock.startedAt = Date.now();
      }));
    });

    // 野球
    on('sp-bb-ball', 'click', () => this.mutate((m) => {
      m.bb.balls += 1;
      if (m.bb.balls > 3) { m.bb.balls = 0; m.bb.strikes = 0; } // 四球: カウントリセット
    }));
    on('sp-bb-strike', 'click', () => this.mutate((m) => {
      m.bb.strikes += 1;
      if (m.bb.strikes > 2) { m.bb.balls = 0; m.bb.strikes = 0; } // 三振: カウントリセット
    }));
    on('sp-bb-out', 'click', () => this.mutate((m) => {
      m.bb.outs += 1;
      if (m.bb.outs > 2) this.changeInning(m); // スリーアウト: チェンジ
      else { m.bb.balls = 0; m.bb.strikes = 0; }
    }));
    on('sp-bb-count-reset', 'click', () => this.mutate((m) => { m.bb.balls = 0; m.bb.strikes = 0; }));
    on('sp-bb-inning-up', 'click', () => this.mutate((m) => this.changeInning(m)));
    on('sp-bb-inning-down', 'click', () => this.mutate((m) => {
      if (!m.bb.top) { m.bb.top = true; } else if (m.bb.inning > 1) { m.bb.inning -= 1; m.bb.top = false; }
    }));
    document.querySelectorAll('#tab-sports [data-base]').forEach((btn) => {
      btn.addEventListener('click', () => this.mutate((m) => {
        const i = parseInt(btn.dataset.base, 10);
        m.bb.bases[i] = !m.bb.bases[i];
      }));
    });

    // 送出
    on('sp-take', 'click', () => this.take());
    on('sp-clear', 'click', () => this.clear());
    on('sp-reselect', 'click', () => { if (typeof StartWizard !== 'undefined') StartWizard.open('sports'); });

    // クロック駆動 (表示秒が変わったときだけ出力へ反映)
    setInterval(() => this.tick(), 200);
  },

  // ===== 状態操作 =====

  /** 試合状態を変更 → 保存 → 再描画 → onAir中なら出力へ即時反映 */
  mutate(fn) {
    const m = App.match();
    if (!m) return;
    fn(m);
    App.saveRundown();
    this.renderAll();
    this.pushIfOnAir();
  },

  winSet(team) {
    this.mutate((m) => {
      m[team].sets = (m[team].sets || 0) + 1;
      m.home.score = 0;
      m.away.score = 0;
      m.period += 1; // 次セットへ
    });
  },

  changeInning(m) {
    m.bb.balls = 0; m.bb.strikes = 0; m.bb.outs = 0;
    m.bb.bases = [false, false, false];
    if (m.bb.top) m.bb.top = false;
    else { m.bb.top = true; m.bb.inning += 1; }
  },

  // ===== クロック =====

  currentClockMs(m) {
    const c = m.clock;
    if (!c.running) return c.baseMs;
    const elapsed = Date.now() - c.startedAt;
    return c.mode === 'down' ? Math.max(0, c.baseMs - elapsed) : c.baseMs + elapsed;
  },

  resetClock(m) {
    m.clock.running = false;
    m.clock.baseMs = m.clock.mode === 'down' ? m.clock.durationSec * 1000 : 0;
  },

  toggleClock() {
    this.mutate((m) => {
      const c = m.clock;
      if (c.running) {
        c.baseMs = this.currentClockMs(m);
        c.running = false;
      } else {
        if (c.mode === 'down' && c.baseMs <= 0) c.baseMs = c.durationSec * 1000;
        c.startedAt = Date.now();
        c.running = true;
      }
    });
  },

  clockStr(m) {
    const total = Math.floor(this.currentClockMs(m) / 1000);
    const mm = Math.floor(total / 60);
    const ss = total % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  },

  /** 200ms周期: クロック表示と出力を秒単位で追従。ダウンで0到達なら自動停止 */
  tick() {
    if (!this.isActive()) return;
    const m = App.match();
    if (!m || !m.clock.running) return;
    const str = this.clockStr(m);
    if (str === this._lastClockStr) return;
    this._lastClockStr = str;
    const disp = document.getElementById('sp-clock-display');
    if (disp) disp.textContent = str;
    if (m.clock.mode === 'down' && this.currentClockMs(m) <= 0) {
      m.clock.baseMs = 0;
      m.clock.running = false;
      App.saveRundown();
      this.renderAll();
    }
    if (this.onAirHere) {
      window.api.graphicsUpdateValues(this.region(m), { clock: str });
    }
  },

  isActive() {
    const tab = document.getElementById('tab-sports');
    return tab && tab.classList.contains('active');
  },

  // ===== 値マッピング =====

  region(m) {
    const tpl = App.templates[m.templateKey];
    return (tpl && tpl.region) || m.channelId || 'tl1';
  },

  /** 試合状態 → テンプレbinding値 */
  buildValues(m) {
    const dots = (n, total) => '●'.repeat(n) + '○'.repeat(Math.max(0, total - n));
    const values = {
      homeName: m.home.name,
      awayName: m.away.name,
      homeScore: String(m.home.score),
      awayScore: String(m.away.score),
      period: m.sport === 'set' ? `第${m.period}セット` : `第${m.period}ピリオド`,
      clock: m.sport === 'baseball' ? '' : this.clockStr(m),
      homeSets: m.sport === 'set' ? String(m.home.sets || 0) : '',
      awaySets: m.sport === 'set' ? String(m.away.sets || 0) : '',
      inning: `${m.bb.inning}回${m.bb.top ? '表' : '裏'}`,
      bso: `B${dots(m.bb.balls, 3)} S${dots(m.bb.strikes, 2)} O${dots(m.bb.outs, 2)}`,
      bases: m.bb.bases.map((b) => (b ? '◆' : '◇')).join(''),
    };
    if (m.sport === 'baseball') values.period = '';
    return values;
  },

  // ===== 送出 =====

  async take() {
    const m = App.match();
    if (!m) return;
    const result = await window.api.graphicsTake(m.templateKey, this.buildValues(m), true,
      `スポーツ ${m.home.name} vs ${m.away.name}`);
    if (result && result.ok) {
      this.onAirHere = true;
      App.setStatus(`スコアバグを送出しました (${this.region(m)})`, 'success');
    } else {
      App.setStatus(`送出エラー: ${(result && result.error) || '不明'}`, 'error');
    }
    this.renderAll();
  },

  async clear() {
    const m = App.match();
    if (!m) return;
    await window.api.graphicsClear(this.region(m), 'スポーツ CLEAR');
    this.onAirHere = false;
    this.renderAll();
  },

  /** onAir中なら現在値を出力へ即時反映 (インプレース更新 = 再テイクなし) */
  pushIfOnAir() {
    if (!this.onAirHere) return;
    const m = App.match();
    if (!m) return;
    window.api.graphicsUpdateValues(this.region(m), this.buildValues(m));
  },

  // ===== 描画 =====

  renderAll() {
    if (!App.rundown) return;
    const m = App.match();
    if (!m) return;
    const $ = (id) => document.getElementById(id);
    if (!$('sp-sport')) return;

    // コンテキスト (番組/放送)
    const prog = App.activeProgram();
    const bc = App.activeBroadcast();
    $('sp-context').textContent = prog && bc ? `${prog.name} / ${bc.name}` : '-';

    // 競技/テンプレ/系統
    const sportSel = $('sp-sport');
    sportSel.innerHTML = '';
    this.SPORTS.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.key; opt.textContent = s.label;
      sportSel.appendChild(opt);
    });
    sportSel.value = m.sport;

    const tplSel = $('sp-template');
    tplSel.innerHTML = '';
    Object.keys(App.templates).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = App.templates[key].label || key;
      tplSel.appendChild(opt);
    });
    if (!App.templates[m.templateKey]) m.templateKey = 'sports-score';
    tplSel.value = m.templateKey;

    const region = this.region(m);
    const ch = App.channels.find((c) => c.region === region);
    const chPill = $('sp-channel');
    chPill.textContent = ch ? ch.label : region;
    chPill.style.borderColor = ch ? ch.color : '';
    chPill.style.color = ch ? ch.color : '';

    // チーム
    $('sp-home-name').value = m.home.name;
    $('sp-away-name').value = m.away.name;
    $('sp-home-color').value = m.home.color;
    $('sp-away-color').value = m.away.color;
    $('sp-home-score').textContent = m.home.score;
    $('sp-away-score').textContent = m.away.score;
    $('sp-home-card').style.borderTopColor = m.home.color;
    $('sp-away-card').style.borderTopColor = m.away.color;

    // ピリオド/セット
    const isSet = m.sport === 'set';
    $('sp-period-label').textContent = isSet ? `第${m.period}セット` : `第${m.period}ピリオド`;
    document.querySelectorAll('#tab-sports .sp-sets').forEach((el) => el.classList.toggle('hidden', !isSet));
    $('sp-home-sets').textContent = m.home.sets || 0;
    $('sp-away-sets').textContent = m.away.sets || 0;

    // クロック (野球は非表示)
    const isBb = m.sport === 'baseball';
    $('sp-clock-panel').classList.toggle('hidden', isBb);
    $('sp-bb-panel').classList.toggle('hidden', !isBb);
    $('sp-clock-display').textContent = this.clockStr(m);
    $('sp-clock-toggle').textContent = m.clock.running ? '⏸ 停止' : '▶ 開始';
    $('sp-clock-toggle').classList.toggle('running', m.clock.running);
    $('sp-clock-mode').value = m.clock.mode;
    $('sp-clock-duration').value = Math.round(m.clock.durationSec / 60);

    // 野球
    const dots = (n, total, id) => { $(id).textContent = '●'.repeat(n) + '○'.repeat(total - n); };
    dots(m.bb.balls, 3, 'sp-bb-balls');
    dots(m.bb.strikes, 2, 'sp-bb-strikes');
    dots(m.bb.outs, 2, 'sp-bb-outs');
    $('sp-bb-inning').textContent = `${m.bb.inning}回${m.bb.top ? '表' : '裏'}`;
    document.querySelectorAll('#tab-sports [data-base]').forEach((btn) => {
      btn.classList.toggle('on', !!m.bb.bases[parseInt(btn.dataset.base, 10)]);
    });

    // OA状態 + モニター
    const pill = $('sp-onair-state');
    pill.textContent = this.onAirHere ? '● ON AIR' : 'OFF AIR';
    pill.classList.toggle('lit', this.onAirHere);
    const frame = $('sp-oa-iframe');
    if (frame) {
      const base = (typeof GraphicsUI !== 'undefined' && GraphicsUI.previewBase)
        ? GraphicsUI.previewBase(GraphicsUI.status) : null;
      const url = base ? `${base}/output/jp/${region}?preview=1` : 'about:blank';
      if (frame.src !== url) frame.src = url;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => SportsUI.init());
