/**
 * ホーム画面 (起動時ランディング / モード選択ハブ)
 *
 * 起動時に最初に表示され、送出モード (リアルタイムCG / 電テロ) を選んで送出画面へ入る。
 * デザイン/マニュアル/設定への入口、現在のON AIR状況、出力サーバの状態、
 * 最近の更新ハイライトも表示する。
 */
const HomeUI = {
  // 最近の更新ハイライト (新しい順)
  CHANGES: [
    'v2.7.2 macOS版 (Apple Silicon / Intel) の配布を開始',
    'v2.7.0 自動字詰め (短文=字間広げ/長文=詰め+長体) を追加、記号だけのボタンを日本語ラベル併記に統一',
    'v2.6.1 上部の合成プレビュー帯を撤去 — プレビューは各TL列のOA/NEXTに一本化、ページリストを広く',
    'v2.6.0 TL系統ごとにOA/NEXTモニターと送出ボタン一式を配置 (列=コンソール化)',
    'v2.5.1 ポップアップを画面中央に修正、ボタン類をコンソール風にリスタイル、起動時に最大化',
    'v2.5.0 プレビューを主役に再設計 (大型PGM|NEXT/背景変更)、CLEAR&BACK、ページ検索、操作性を全面改善',
    'v2.4.1 モード選択後に番組→放送(日付)を選ぶ入場ポップアップを追加、系統ラベルをTL1/TL2に統一',
    'v2.4.0 送出モードをホームで選ぶ方式に整理、系統をTL1/TL2の汎用枠+プリセット化',
    'v2.3.0 ホーム画面・アプリ内マニュアルを追加、送出画面を白基調に統一',
    'v2.2.0 電テロモード (静止画・作画の静的送出) を追加',
    'v2.1.0 送出を最大4系統の横並び表示 + 出力グループ (URLレイヤー合成)',
  ],

  init() {
    // モードカード → そのモードで送出画面へ
    document.querySelectorAll('#tab-home [data-mode]').forEach((el) => {
      el.addEventListener('click', () => this.enterMode(el.dataset.mode));
    });
    // 通常のナビカード → 対応タブへ
    document.querySelectorAll('#tab-home [data-goto]').forEach((el) => {
      el.addEventListener('click', () => this.goTab(el.dataset.goto));
    });
    const openSettings = document.getElementById('home-open-settings');
    if (openSettings) openSettings.addEventListener('click', () => this.goTab('settings'));

    // 最近の更新
    const ul = document.getElementById('home-changes');
    if (ul) {
      ul.innerHTML = '';
      this.CHANGES.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c;
        ul.appendChild(li);
      });
    }

    // バージョン
    if (window.api && window.api.getAppVersion) {
      window.api.getAppVersion().then((v) => {
        const el = document.getElementById('home-version');
        if (el && v) el.textContent = `v${v}`;
        const hdr = document.getElementById('app-header-ver');
        if (hdr && v) hdr.textContent = `v${v}`;
      }).catch(() => {});
    }
  },

  goTab(tab) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
    if (btn) btn.click();
  },

  /** モードを選んで送出画面へ */
  enterMode(mode) {
    if (!App.rundown) return;
    // 番組 → 放送(日付) を選ぶ入場ウィザードを開く
    if (typeof StartWizard !== 'undefined') {
      StartWizard.open(mode);
      return;
    }
    // フォールバック (ウィザード未読込時は従来どおり直接入場)
    App.setMode(mode);
    if (typeof RundownUI !== 'undefined' && RundownUI.loaded) {
      RundownUI.currentCornerId = null;
      RundownUI.ensureSelections();
      RundownUI.renderAll();
    }
    this.goTab('onair');
  },

  /** タブ表示時・ロード完了時に呼ぶ (状況を最新化) */
  refresh() {
    this.renderOnair();
    this.renderServer();
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
      if (urlsEl) {
        urlsEl.innerHTML = '';
        [`http://${host}:${status.port}/output/jp`, `http://${host}:${status.port}/output/en`].forEach((u) => {
          const code = document.createElement('code');
          code.className = 'home-url';
          code.textContent = u;
          urlsEl.appendChild(code);
        });
      }
    } else {
      stateEl.textContent = '停止中 — 設定タブで起動してください';
      stateEl.className = 'home-server-state stopped';
      if (urlsEl) urlsEl.innerHTML = '';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => HomeUI.init());
