/**
 * ホーム画面 (起動時ランディング)
 *
 * 起動時に最初に表示され、各タブ (送出/デザイン/マニュアル/設定) への入口、
 * クイックスタート (番組・放送の選択→送出タブへ)、現在のON AIR状況、
 * 出力サーバの状態、最近の更新ハイライトを表示する。
 */
const HomeUI = {
  // 最近の更新ハイライト (新しい順)
  CHANGES: [
    'v2.3.0 ホーム画面・アプリ内マニュアルを追加、送出画面を白基調に統一',
    'v2.2.0 電テロモード (静止画・作画の静的送出) を追加',
    'v2.1.0 送出を最大4系統の横並び表示 + 出力グループ (URLレイヤー合成)',
    'v2.0.0 ランダウン方式の送出システム (番組>放送>コーナー>ページ) に刷新',
  ],

  init() {
    // ナビカード → 対応タブへ (tab-controllerのボタンクリックを再利用)
    document.querySelectorAll('#tab-home [data-goto]').forEach((el) => {
      el.addEventListener('click', () => this.goTab(el.dataset.goto));
    });
    document.getElementById('home-go-onair').addEventListener('click', () => this.goOnair());
    document.getElementById('home-open-settings').addEventListener('click', () => this.goTab('settings'));

    // 番組/放送セレクタ (クイックスタート)
    document.getElementById('home-program').addEventListener('change', (e) => {
      if (!App.rundown) return;
      App.rundown.activeProgramId = e.target.value;
      App.rundown.activeBroadcastId = null;
      App.saveRundown();
      this.renderQuick();
    });
    document.getElementById('home-broadcast').addEventListener('change', (e) => {
      if (!App.rundown) return;
      App.rundown.activeBroadcastId = e.target.value;
      App.saveRundown();
    });

    // 最近の更新
    const ul = document.getElementById('home-changes');
    ul.innerHTML = '';
    this.CHANGES.forEach((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    });

    // バージョン
    if (window.api && window.api.getAppVersion) {
      window.api.getAppVersion().then((v) => {
        const el = document.getElementById('home-version');
        if (el && v) el.textContent = `v${v}`;
      }).catch(() => {});
    }
  },

  goTab(tab) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.click();
  },

  /** クイックスタートで選んだ番組/放送を反映して送出タブへ */
  goOnair() {
    if (App.rundown) {
      const prog = document.getElementById('home-program').value;
      const bc = document.getElementById('home-broadcast').value;
      if (prog) App.rundown.activeProgramId = prog;
      if (bc) App.rundown.activeBroadcastId = bc;
      App.saveRundown();
      if (typeof RundownUI !== 'undefined' && RundownUI.loaded) {
        RundownUI.currentCornerId = null;
        RundownUI.renderAll();
      }
    }
    this.goTab('onair');
  },

  /** タブ表示時・ロード完了時に呼ぶ (状況を最新化) */
  refresh() {
    this.renderQuick();
    this.renderOnair();
    this.renderServer();
  },

  renderQuick() {
    const progSel = document.getElementById('home-program');
    const bcSel = document.getElementById('home-broadcast');
    if (!progSel || !bcSel || !App.rundown) return;
    progSel.innerHTML = '';
    (App.rundown.programs || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      progSel.appendChild(opt);
    });
    progSel.value = App.rundown.activeProgramId;

    bcSel.innerHTML = '';
    const program = App.activeProgram();
    ((program && program.broadcasts) || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id; opt.textContent = b.name;
      bcSel.appendChild(opt);
    });
    bcSel.value = App.rundown.activeBroadcastId;
  },

  renderOnair() {
    const el = document.getElementById('home-onair');
    if (!el) return;
    const parts = [];
    (App.channels || []).forEach((ch) => {
      const st = App.broadcast[ch.id];
      if (st && st.onAirPageId) {
        const found = App.findPage(st.onAirPageId);
        parts.push(found ? `${ch.label} P${found.page.pageNo}` : ch.label);
      }
    });
    el.textContent = parts.length ? `ON AIR: ${parts.join(' + ')}` : 'ON AIR: なし';
    el.classList.toggle('live', parts.length > 0);
  },

  async renderServer() {
    const stateEl = document.getElementById('home-server-state');
    const urlsEl = document.getElementById('home-server-urls');
    if (!stateEl || !window.api || !window.api.graphicsServerStatus) return;
    let status;
    try { status = await window.api.graphicsServerStatus(); } catch (_) { return; }
    if (status.running) {
      stateEl.textContent = `稼働中 — ポート ${status.port} / 接続 ${status.clients || 0}`;
      stateEl.className = 'home-server-state running';
      const host = (status.lanAddresses && status.lanAddresses[0]) || '127.0.0.1';
      urlsEl.innerHTML = '';
      [`http://${host}:${status.port}/output/jp`, `http://${host}:${status.port}/output/en`].forEach((u) => {
        const code = document.createElement('code');
        code.className = 'home-url';
        code.textContent = u;
        urlsEl.appendChild(code);
      });
    } else {
      stateEl.textContent = '停止中 — 設定タブで起動してください';
      stateEl.className = 'home-server-state stopped';
      urlsEl.innerHTML = '';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => HomeUI.init());
