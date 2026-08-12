/**
 * スポーツシーン・コンポーザー (スポーツ送出モードの操作盤)
 *
 * 各グラフィック要素 (スコアボード/BSO/走者/得点/タイトル/選手紹介) を
 * 独立した「オンエア・ウィンドウ」= 1region として扱い、操作者が
 *   - 個別に ON AIR / OFF (graphicsTakeTo / graphicsClear)
 *   - プレビュー上でドラッグして 位置・サイズ (graphicsSetLayout)
 *   - 値をライブ操作 → onAir中のウィンドウへ即時反映 (graphicsUpdateValues)
 * できる。試合状態は App.match() (broadcast.match) に保存され、永続化と
 * 2台同期に自動で乗る。野球を主対象に作り込み、汎用/セット制は簡易バーで送出。
 *
 * binding規約 (自作テンプレでも同名bindingを使えば操作盤から流し込める):
 *   scoreboard: awayShort/homeShort, away1..away9, home1..home9, awayR/homeR, status
 *   bso: balls/strikes/outs   runners: base1/base2/base3
 *   score-big: homeShort/awayShort, homeScore/awayScore, status, title
 *   title: title/sub          player: pOrder/pPos/pNo/pName
 */
const SportsUI = {
  _lastClockStr: null,
  _composerWidget: null, // ドラッグ配置中のウィジェット
  POS: ['', '投', '捕', '一', '二', '三', '遊', '左', '中', '右', '指'],

  SPORTS: [
    { key: 'baseball', label: '野球 (コンソール)' },
    { key: 'generic', label: '汎用 (得点+ピリオド+時計)' },
    { key: 'set', label: 'セット制 (バレー等)' },
  ],

  init() {
    // 競技切替
    const sportSel = document.getElementById('sp-sport');
    if (sportSel) sportSel.addEventListener('change', () => this.mutate((m) => { m.sport = sportSel.value; }));
    // メタ入力
    ['tournament', 'game', 'place', 'date', 'time'].forEach((k) => {
      const el = document.getElementById(`sp-meta-${k}`);
      if (el) el.addEventListener('change', () => this.mutate((m) => { m.meta[k] = el.value; }));
    });
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    on('sp-reselect', 'click', () => { if (typeof StartWizard !== 'undefined') StartWizard.open('sports'); });

    // 汎用/セット簡易コンソール
    document.querySelectorAll('#sp-generic [data-score-delta]').forEach((b) => b.addEventListener('click', () => this.mutate((m) => {
      const t = m[b.dataset.team]; t.score = Math.max(0, t.score + parseInt(b.dataset.scoreDelta, 10));
    })));
    on('g-period-up', 'click', () => this.mutate((m) => { m.period += 1; }));
    on('g-period-down', 'click', () => this.mutate((m) => { m.period = Math.max(1, m.period - 1); }));
    on('g-clock-toggle', 'click', () => this.toggleClock());
    on('g-clock-reset', 'click', () => this.mutate((m) => this.resetClock(m)));
    on('g-take', 'click', () => this.genericTake());
    on('g-clear', 'click', () => this.genericClear());
    on('g-home-name', 'change', () => this.mutate((m) => { m.home.name = document.getElementById('g-home-name').value; }));
    on('g-away-name', 'change', () => this.mutate((m) => { m.away.name = document.getElementById('g-away-name').value; }));

    // 野球: チーム短縮名
    ['home', 'away'].forEach((side) => on(`bb-short-${side}`, 'change', () => this.mutate((m) => {
      m[side].short = document.getElementById(`bb-short-${side}`).value;
    })));

    // 野球: 走者/BSO/得点/イニング
    document.querySelectorAll('#tab-sports [data-base]').forEach((b) => b.addEventListener('click', () => this.mutate((m) => {
      const i = parseInt(b.dataset.base, 10); m.bb.bases[i] = !m.bb.bases[i];
    })));
    on('bb-clear-runners', 'click', () => this.mutate((m) => { m.bb.bases = [false, false, false]; }));
    on('bb-ball', 'click', () => this.mutate((m) => { m.bb.balls += 1; if (m.bb.balls > 3) { m.bb.balls = 0; m.bb.strikes = 0; } }));
    on('bb-strike', 'click', () => this.mutate((m) => { m.bb.strikes += 1; if (m.bb.strikes > 2) { m.bb.balls = 0; m.bb.strikes = 0; } }));
    on('bb-out', 'click', () => this.mutate((m) => { m.bb.outs += 1; if (m.bb.outs > 2) this.changeInning(m); else { m.bb.balls = 0; m.bb.strikes = 0; } }));
    on('bb-count-reset', 'click', () => this.mutate((m) => { m.bb.balls = 0; m.bb.strikes = 0; }));
    on('bb-batter-change', 'click', () => this.mutate((m) => { m.bb.balls = 0; m.bb.strikes = 0; }));
    on('bb-change', 'click', () => this.mutate((m) => this.changeInning(m)));
    on('bb-inn-up', 'click', () => this.mutate((m) => this.changeInning(m)));
    on('bb-inn-down', 'click', () => this.mutate((m) => { if (!m.bb.top) m.bb.top = true; else if (m.bb.inning > 1) { m.bb.inning -= 1; m.bb.top = false; } }));
    // 得点 (現イニング・攻撃側の升へ加点)
    on('bb-run-plus', 'click', () => this.addRun(1));
    on('bb-run-minus', 'click', () => this.addRun(-1));

    // コンポーザー
    on('sp-composer-close', 'click', () => this.closeComposer());
    this.initComposerDrag();

    setInterval(() => this.tick(), 200);
  },

  // ===== 状態操作 =====
  mutate(fn) {
    const m = App.match(); if (!m) return;
    fn(m);
    this.syncScore(m);
    App.saveRundown();
    this.renderAll();
    this.pushAll();
  },
  /** linescore合計 = score, R表示に反映 */
  syncScore(m) {
    const sum = (a) => (a || []).reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
    m.home.score = sum(m.linescore.home);
    m.away.score = sum(m.linescore.away);
  },
  addRun(d) {
    this.mutate((m) => {
      const side = m.bb.top ? 'away' : 'home';
      const arr = m.linescore[side];
      const i = m.bb.inning - 1;
      while (arr.length <= i) arr.push(0);
      arr[i] = Math.max(0, (parseInt(arr[i], 10) || 0) + d);
    });
  },
  changeInning(m) {
    m.bb.balls = 0; m.bb.strikes = 0; m.bb.outs = 0; m.bb.bases = [false, false, false];
    if (m.bb.top) m.bb.top = false;
    else { m.bb.top = true; m.bb.inning += 1; }
  },

  // ===== クロック (汎用/セット) =====
  currentClockMs(m) {
    const c = m.clock; if (!c.running) return c.baseMs;
    const e = Date.now() - c.startedAt;
    return c.mode === 'down' ? Math.max(0, c.baseMs - e) : c.baseMs + e;
  },
  resetClock(m) { m.clock.running = false; m.clock.baseMs = m.clock.mode === 'down' ? m.clock.durationSec * 1000 : 0; },
  toggleClock() {
    this.mutate((m) => {
      const c = m.clock;
      if (c.running) { c.baseMs = this.currentClockMs(m); c.running = false; }
      else { if (c.mode === 'down' && c.baseMs <= 0) c.baseMs = c.durationSec * 1000; c.startedAt = Date.now(); c.running = true; }
    });
  },
  clockStr(m) {
    const t = Math.floor(this.currentClockMs(m) / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  },
  tick() {
    if (!this.isActive()) return;
    const m = App.match(); if (!m || !m.clock.running) return;
    const s = this.clockStr(m);
    if (s === this._lastClockStr) return;
    this._lastClockStr = s;
    const disp = document.getElementById('g-clock-display'); if (disp) disp.textContent = s;
    if (m.clock.mode === 'down' && this.currentClockMs(m) <= 0) { m.clock.baseMs = 0; m.clock.running = false; App.saveRundown(); this.renderAll(); }
    // 汎用バーがonAirなら時計を反映
    if (m.sport !== 'baseball' && this._genericOnAir) window.api.graphicsUpdateValues(this.genericRegion(m), { clock: s });
  },
  isActive() { const t = document.getElementById('tab-sports'); return t && t.classList.contains('active'); },

  // ===== 値マッピング =====
  dots(n, total) { return '●'.repeat(n) + '○'.repeat(Math.max(0, total - n)); },
  statusStr(m) { return `${m.bb.inning}回${m.bb.top ? '表' : 'ウラ'}`; },
  /** ウィジェットkey → binding値 */
  widgetValues(key, m) {
    if (key === 'scoreboard') {
      const v = { awayShort: m.away.short, homeShort: m.home.short, awayR: String(m.away.score), homeR: String(m.home.score), status: this.statusStr(m) };
      for (let i = 0; i < 9; i++) {
        v[`away${i + 1}`] = m.linescore.away[i] === undefined ? '' : String(m.linescore.away[i]);
        v[`home${i + 1}`] = m.linescore.home[i] === undefined ? '' : String(m.linescore.home[i]);
      }
      return v;
    }
    if (key === 'bso') return { balls: this.dots(m.bb.balls, 3), strikes: this.dots(m.bb.strikes, 2), outs: this.dots(m.bb.outs, 2) };
    if (key === 'runners') return { base1: m.bb.bases[0] ? '◆' : '◇', base2: m.bb.bases[1] ? '◆' : '◇', base3: m.bb.bases[2] ? '◆' : '◇' };
    if (key === 'scoreBig') return { homeShort: m.home.short, awayShort: m.away.short, homeScore: String(m.home.score), awayScore: String(m.away.score), status: this.statusStr(m), title: m.title.text };
    if (key === 'title') return { title: m.title.text, sub: m.title.sub };
    if (key === 'player') {
      const side = m.bb.top ? 'away' : 'home';
      const p = (m[side].roster || [])[m[side].atBat] || {};
      return { pOrder: p.order ? `${p.order}番` : '', pPos: p.pos || '', pNo: p.no || '', pName: p.name || '' };
    }
    return {};
  },

  // ===== ウィンドウ送出 =====
  widgets(m) { return m.widgets || []; },
  async toggleWidget(w) {
    const m = App.match();
    if (w.onAir) { await window.api.graphicsClear(w.region, `スポーツ ${w.label} CLEAR`); w.onAir = false; }
    else {
      await window.api.graphicsTakeTo(w.region, w.templateKey, this.widgetValues(w.key, m), true, `スポーツ ${w.label}`);
      w.onAir = true;
      window.api.graphicsSetLayout(w.region, w.x, w.y, w.scale);
    }
    App.saveRundown(); this.renderWindows();
  },
  pushAll() {
    const m = App.match(); if (!m) return;
    if (m.sport === 'baseball') {
      this.widgets(m).forEach((w) => { if (w.onAir) window.api.graphicsUpdateValues(w.region, this.widgetValues(w.key, m)); });
    } else if (this._genericOnAir) {
      window.api.graphicsUpdateValues(this.genericRegion(m), this.genericValues(m));
    }
  },
  applyWidgetLayout(w) { window.api.graphicsSetLayout(w.region, w.x, w.y, w.scale); },

  // ===== 汎用/セット (単一バー sports-score) =====
  _genericOnAir: false,
  genericRegion(m) { const t = App.templates['sports-score']; return (t && t.region) || 'tl1'; },
  genericValues(m) {
    return {
      homeName: m.home.name, awayName: m.away.name, homeScore: String(m.home.score), awayScore: String(m.away.score),
      period: m.sport === 'set' ? `第${m.period}セット` : `第${m.period}ピリオド`,
      clock: this.clockStr(m), homeSets: m.sport === 'set' ? String(m.home.sets || 0) : '', awaySets: m.sport === 'set' ? String(m.away.sets || 0) : '',
    };
  },
  async genericTake() {
    const m = App.match();
    await window.api.graphicsTakeTo(this.genericRegion(m), 'sports-score', this.genericValues(m), true, 'スポーツ 汎用');
    this._genericOnAir = true; this.renderAll();
  },
  async genericClear() { const m = App.match(); await window.api.graphicsClear(this.genericRegion(m), 'スポーツ CLEAR'); this._genericOnAir = false; this.renderAll(); },

  // ===== 描画 =====
  renderAll() {
    if (!App.rundown) return;
    const m = App.match(); if (!m || !document.getElementById('sp-sport')) return;
    document.getElementById('sp-sport').value = m.sport;
    const prog = App.activeProgram(); const bc = App.activeBroadcast();
    const ctx = document.getElementById('sp-context'); if (ctx) ctx.textContent = prog && bc ? `${prog.name} / ${bc.name}` : '-';
    ['tournament', 'game', 'place', 'date', 'time'].forEach((k) => { const el = document.getElementById(`sp-meta-${k}`); if (el && document.activeElement !== el) el.value = m.meta[k] || ''; });
    const isBb = m.sport === 'baseball';
    document.getElementById('sp-baseball').classList.toggle('hidden', !isBb);
    document.getElementById('sp-generic').classList.toggle('hidden', isBb);
    if (isBb) { this.renderLinescore(m); this.renderRosters(m); this.renderBbControls(m); this.renderWindows(); }
    else this.renderGeneric(m);
  },

  renderGeneric(m) {
    const $ = (id) => document.getElementById(id);
    if ($('g-home-name')) { if (document.activeElement !== $('g-home-name')) $('g-home-name').value = m.home.name; }
    if ($('g-away-name')) { if (document.activeElement !== $('g-away-name')) $('g-away-name').value = m.away.name; }
    if ($('g-home-score')) $('g-home-score').textContent = m.home.score;
    if ($('g-away-score')) $('g-away-score').textContent = m.away.score;
    if ($('g-period')) $('g-period').textContent = m.sport === 'set' ? `第${m.period}セット` : `第${m.period}ピリオド`;
    if ($('g-clock-display')) $('g-clock-display').textContent = this.clockStr(m);
    if ($('g-onair')) { $('g-onair').textContent = this._genericOnAir ? '● ON AIR' : 'OFF AIR'; $('g-onair').classList.toggle('lit', this._genericOnAir); }
  },

  renderLinescore(m) {
    const host = document.getElementById('bb-linescore'); if (!host) return;
    const n = m.linescore.inningsShown || 9;
    const cell = (side, i) => {
      const arr = m.linescore[side]; const v = arr[i] === undefined ? '' : arr[i];
      return `<td class="bb-ls-cell" data-side="${side}" data-inn="${i}">${v}</td>`;
    };
    let head = '<tr><th></th>';
    for (let i = 0; i < n; i++) head += `<th>${i + 1}</th>`;
    head += '<th class="bb-ls-r">R</th></tr>';
    const rowFor = (side, label) => {
      let r = `<tr><th class="bb-ls-team">${label}</th>`;
      for (let i = 0; i < n; i++) r += cell(side, i);
      r += `<td class="bb-ls-r">${m[side].score}</td></tr>`;
      return r;
    };
    host.innerHTML = `<table class="bb-ls">${head}${rowFor('away', m.away.short || 'A')}${rowFor('home', m.home.short || 'H')}</table>`;
    host.querySelectorAll('.bb-ls-cell').forEach((td) => {
      td.addEventListener('click', () => this.mutate((mm) => {
        const arr = mm.linescore[td.dataset.side]; const i = parseInt(td.dataset.inn, 10);
        while (arr.length <= i) arr.push(0);
        arr[i] = (parseInt(arr[i], 10) || 0) + 1;
      }));
      td.addEventListener('contextmenu', (e) => { e.preventDefault(); this.mutate((mm) => {
        const arr = mm.linescore[td.dataset.side]; const i = parseInt(td.dataset.inn, 10);
        if (arr[i]) arr[i] = Math.max(0, (parseInt(arr[i], 10) || 0) - 1);
      }); });
    });
  },

  renderRosters(m) {
    ['home', 'away'].forEach((side) => {
      const host = document.getElementById(`bb-roster-${side}`); if (!host) return;
      const t = m[side];
      const nameEl = document.getElementById(`bb-short-${side}`);
      if (nameEl && document.activeElement !== nameEl) nameEl.value = t.short || '';
      let html = '<table class="bb-roster"><tr><th>打</th><th>名前</th><th>守</th><th>番</th><th></th></tr>';
      (t.roster || []).forEach((p, i) => {
        const cur = (m.bb.top ? 'away' : 'home') === side && t.atBat === i;
        html += `<tr class="${cur ? 'atbat' : ''}" data-idx="${i}">`
          + `<td>${p.order || i + 1}</td>`
          + `<td class="bb-r-name" contenteditable>${p.name || ''}</td>`
          + `<td class="bb-r-pos">${p.pos || ''}</td>`
          + `<td class="bb-r-no" contenteditable>${p.no || ''}</td>`
          + `<td><button class="btn btn--small bb-r-send" data-side="${side}" data-idx="${i}">選手</button></td></tr>`;
      });
      html += '</table>';
      host.innerHTML = html;
      host.querySelectorAll('tr[data-idx]').forEach((tr) => {
        const idx = parseInt(tr.dataset.idx, 10);
        tr.querySelector('.bb-r-name').addEventListener('blur', (e) => this.mutate((mm) => { mm[side].roster[idx].name = e.target.textContent.trim(); }));
        tr.querySelector('.bb-r-no').addEventListener('blur', (e) => this.mutate((mm) => { mm[side].roster[idx].no = e.target.textContent.trim(); }));
        tr.querySelector('.bb-r-pos').addEventListener('click', () => this.mutate((mm) => {
          const p = mm[side].roster[idx]; const ci = this.POS.indexOf(p.pos); p.pos = this.POS[(ci + 1) % this.POS.length];
        }));
      });
      host.querySelectorAll('.bb-r-send').forEach((b) => b.addEventListener('click', () => this.sendPlayer(b.dataset.side, parseInt(b.dataset.idx, 10))));
      const add = document.getElementById(`bb-roster-add-${side}`);
      if (add && !add._wired) { add._wired = true; add.addEventListener('click', () => this.mutate((mm) => { mm[side].roster.push({ order: mm[side].roster.length + 1, name: '', pos: '', no: '', year: '' }); })); }
    });
  },

  /** 選手紹介ウィンドウへ指定打者を流し込む (打席もそこへ) */
  sendPlayer(side, idx) {
    const m = App.match();
    m[side].atBat = idx;
    const w = this.widgets(m).find((x) => x.key === 'player');
    App.saveRundown();
    this.renderAll();
    if (!w) return;
    const vals = this.widgetValues('player', m);
    if (w.onAir) window.api.graphicsUpdateValues(w.region, vals);
    else this.toggleWidget(w);
  },

  renderBbControls(m) {
    const $ = (id) => document.getElementById(id);
    if ($('bb-status')) $('bb-status').textContent = this.statusStr(m);
    const dot = (n, t, id) => { if ($(id)) $(id).textContent = '●'.repeat(n) + '○'.repeat(t - n); };
    dot(m.bb.balls, 3, 'bb-balls'); dot(m.bb.strikes, 2, 'bb-strikes'); dot(m.bb.outs, 2, 'bb-outs');
    document.querySelectorAll('#tab-sports [data-base]').forEach((b) => b.classList.toggle('on', !!m.bb.bases[parseInt(b.dataset.base, 10)]));
  },

  renderWindows() {
    const host = document.getElementById('sp-windows'); if (!host) return;
    const m = App.match();
    host.innerHTML = '';
    this.widgets(m).forEach((w) => {
      const row = document.createElement('div');
      row.className = `sp-win-row${w.onAir ? ' on' : ''}`;
      const toggle = document.createElement('button');
      toggle.className = `sp-win-onair${w.onAir ? ' lit' : ''}`;
      toggle.textContent = w.onAir ? '● ON AIR' : 'OFF';
      toggle.addEventListener('click', () => this.toggleWidget(w));
      const label = document.createElement('span');
      label.className = 'sp-win-label';
      label.textContent = w.label;
      const pos = document.createElement('button');
      pos.className = 'btn btn--small';
      pos.textContent = '位置・サイズ';
      pos.addEventListener('click', () => this.openComposer(w));
      row.appendChild(toggle);
      row.appendChild(label);
      row.appendChild(pos);
      host.appendChild(row);
    });
  },

  // ===== ドラッグ配置コンポーザー =====
  openComposer(w) {
    this._composerWidget = w;
    const wrap = document.getElementById('sp-composer'); if (!wrap) return;
    wrap.classList.remove('hidden');
    document.getElementById('sp-composer-title').textContent = `位置・サイズ: ${w.label}`;
    // プレビューを合成に
    const frame = document.getElementById('sp-composer-frame');
    const base = (typeof GraphicsUI !== 'undefined' && GraphicsUI.previewBase) ? GraphicsUI.previewBase(GraphicsUI.status) : null;
    const url = base ? `${base}/output/jp?preview=1` : 'about:blank';
    if (frame.src !== url) frame.src = url;
    // onAirでなければ一時的に出しておく (配置しやすく)
    if (!w.onAir) this.toggleWidget(w);
    this.syncComposerBox();
    this.renderComposerFields();
  },
  closeComposer() { const wrap = document.getElementById('sp-composer'); if (wrap) wrap.classList.add('hidden'); this._composerWidget = null; },
  /** 1920空間 ↔ プレビューpx の倍率 */
  composerScale() {
    const stage = document.getElementById('sp-composer-stage');
    return stage ? stage.clientWidth / 1920 : 1;
  },
  syncComposerBox() {
    const w = this._composerWidget; const box = document.getElementById('sp-composer-box');
    if (!w || !box) return;
    const s = this.composerScale();
    box.style.left = `${w.x * s}px`;
    box.style.top = `${w.y * s}px`;
    box.style.width = `${1920 * w.scale * s}px`;
    box.style.height = `${1080 * w.scale * s}px`;
    box.textContent = w.label;
  },
  renderComposerFields() {
    const w = this._composerWidget; if (!w) return;
    const set = (id, v) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = v; };
    set('sp-c-x', Math.round(w.x)); set('sp-c-y', Math.round(w.y)); set('sp-c-scale', Math.round(w.scale * 100));
  },
  initComposerDrag() {
    const box = document.getElementById('sp-composer-box');
    const handle = document.getElementById('sp-composer-handle');
    if (!box) return;
    let drag = null;
    const toSpace = (e) => { const s = this.composerScale(); return { x: e.clientX / s, y: e.clientY / s }; };
    box.addEventListener('mousedown', (e) => {
      if (e.target === handle) return;
      const w = this._composerWidget; if (!w) return;
      const p = toSpace(e); drag = { mode: 'move', sx: p.x, sy: p.y, ox: w.x, oy: w.y }; e.preventDefault();
    });
    if (handle) handle.addEventListener('mousedown', (e) => {
      const w = this._composerWidget; if (!w) return;
      drag = { mode: 'scale', sx: e.clientX, os: w.scale }; e.preventDefault(); e.stopPropagation();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const w = this._composerWidget; if (!w) return;
      if (drag.mode === 'move') {
        const p = toSpace(e);
        w.x = Math.round((drag.ox + (p.x - drag.sx)) / 10) * 10; // 10pxスナップ
        w.y = Math.round((drag.oy + (p.y - drag.sy)) / 10) * 10;
      } else {
        const dpx = e.clientX - drag.sx;
        w.scale = Math.max(0.3, Math.min(3, drag.os + dpx / 400));
      }
      this.syncComposerBox(); this.renderComposerFields();
      window.api.graphicsSetLayout(w.region, w.x, w.y, w.scale);
    });
    window.addEventListener('mouseup', () => { if (drag) { App.saveRundown(); drag = null; } });
    // 数値入力
    const num = (id, apply) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { const w = this._composerWidget; if (!w) return; apply(w, parseFloat(el.value) || 0); this.syncComposerBox(); window.api.graphicsSetLayout(w.region, w.x, w.y, w.scale); App.saveRundown(); }); };
    num('sp-c-x', (w, v) => { w.x = v; });
    num('sp-c-y', (w, v) => { w.y = v; });
    num('sp-c-scale', (w, v) => { w.scale = Math.max(0.3, Math.min(3, v / 100)); });
    window.addEventListener('resize', () => { if (this._composerWidget) this.syncComposerBox(); });
  },
};

document.addEventListener('DOMContentLoaded', () => SportsUI.init());
