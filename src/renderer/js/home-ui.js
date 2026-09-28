/**
 * ホーム画面 (起動時ランディング / モード選択ハブ)
 *
 * 起動時に最初に表示され、送出モード (リアルタイムCG / 電テロ) を選んで送出画面へ入る。
 * 「続きから」(最近開いた放送) とシステム状態 (出力サーバ/2台運用/GPIO/ライブデータ) を表示する。
 */
const HomeUI = {
  /** 「続きから」に出す件数 */
  RECENT_MAX: 5,

  init() {
    // モードカード → 番組/放送を選ぶ入場ウィザード
    document.querySelectorAll('#tab-home [data-mode]').forEach((el) => {
      el.addEventListener('click', () => this.enterMode(el.dataset.mode));
    });
    const openSettings = document.getElementById('home-open-settings');
    if (openSettings) openSettings.addEventListener('click', () => this.goTab('settings'));

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
    this.enterOnair();
  },

  /** 「続きから」: 指定の放送を開いて送出画面へ */
  resume(mode, programId, broadcastId) {
    if (!App.rundown) return;
    App.setMode(mode);
    App.setActiveProgram(programId);
    App.setActiveBroadcast(broadcastId);
    App.touchBroadcast();
    App.saveRundown();
    this.enterOnair();
  },

  enterOnair() {
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
    this.renderRecent();
    this.renderSystem();
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

  /** 両モードの放送を最終オープン順に並べる (未オープンのみなら各モードのアクティブ放送) */
  recentBroadcasts() {
    const rd = App.rundown;
    if (!rd) return [];
    const all = [];
    ['cg', 'telop'].forEach((mode) => {
      const tree = rd[mode];
      if (!tree) return;
      tree.programs.forEach((prog) => {
        (prog.broadcasts || []).forEach((bc) => {
          const active = prog.id === tree.activeProgramId && bc.id === tree.activeBroadcastId;
          all.push({ mode, prog, bc, openedAt: bc.openedAt || 0, active });
        });
      });
    });
    const opened = all.filter((r) => r.openedAt).sort((a, b) => b.openedAt - a.openedAt);
    const list = opened.length ? opened : all.filter((r) => r.active);
    return list.slice(0, this.RECENT_MAX);
  },

  renderRecent() {
    const wrap = document.getElementById('home-recent');
    if (!wrap) return;
    wrap.innerHTML = '';
    const rows = this.recentBroadcasts();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'home-recent-empty';
      empty.textContent = 'まだ開いた放送がありません。上のモードから始めてください。';
      wrap.appendChild(empty);
      return;
    }
    rows.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'home-recent-row';

      const badge = document.createElement('span');
      badge.className = `home-badge home-badge--${r.mode}`;
      badge.textContent = r.mode === 'telop' ? '電テロ' : 'CG';

      const name = document.createElement('span');
      name.className = 'home-recent-name';
      name.append(r.prog.name);
      const sep = document.createElement('span');
      sep.className = 'home-recent-sep';
      sep.textContent = '▸';
      name.append(sep, r.bc.name);

      const pages = (r.bc.corners || []).reduce((n, cn) => n + (cn.pages || []).length, 0);
      const meta = document.createElement('span');
      meta.className = 'home-recent-meta';
      meta.textContent = `${(r.bc.corners || []).length}コーナー / ${pages}ページ`;

      const open = document.createElement('button');
      open.className = `btn btn--small${i === 0 ? ' btn--primary' : ''}`;
      open.textContent = '開く';
      open.addEventListener('click', () => this.resume(r.mode, r.prog.id, r.bc.id));

      row.append(badge, name, meta, open);
      wrap.appendChild(row);
    });
  },

  async renderSystem() {
    const wrap = document.getElementById('home-sys');
    if (!wrap) return;
    const rows = [];

    let status = null;
    try {
      if (window.api && window.api.graphicsServerStatus) status = await window.api.graphicsServerStatus();
    } catch (_) { /* ignore */ }
    if (status && status.running) {
      const host = (status.lanAddresses && status.lanAddresses[0]) || '127.0.0.1';
      rows.push(['出力サーバ', `${host}:${status.port}`, true]);
    } else {
      rows.push(['出力サーバ', '停止中', false]);
    }

    if (typeof RemoteSync !== 'undefined') {
      const role = RemoteSync.role;
      const label = role === 'host' ? (RemoteSync.connected ? 'ホスト / 接続中' : 'ホスト / 待機')
        : role === 'client' ? (RemoteSync.connected ? 'クライアント / 接続中' : 'クライアント / 再接続中')
          : '使用しない';
      rows.push(['2台運用', label, role !== 'standalone' && RemoteSync.connected]);
    }
    if (typeof GpioRemote !== 'undefined') {
      rows.push(['GPIO', GpioRemote.connected ? '接続中' : '未接続', GpioRemote.connected]);
    }
    const ld = document.getElementById('ld-status');
    if (ld) rows.push(['ライブデータ', ld.textContent, ld.classList.contains('connected')]);

    wrap.innerHTML = '';
    rows.forEach(([label, value, ok]) => {
      const row = document.createElement('div');
      row.className = 'home-sys-row';
      const dot = document.createElement('span');
      dot.className = `home-sys-dot${ok ? ' ok' : ''}`;
      const lab = document.createElement('span');
      lab.className = 'home-sys-label';
      lab.textContent = label;
      const val = document.createElement('span');
      val.className = 'home-sys-value';
      val.textContent = value;
      row.append(dot, lab, val);
      wrap.appendChild(row);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => HomeUI.init());
