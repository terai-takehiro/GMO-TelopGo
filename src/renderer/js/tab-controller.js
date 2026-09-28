/**
 * タブ切替制御 (ホーム / 送出 / デザイン / 設定) + ヘッダーの状態表示・ヘルプ
 */
(function () {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabBtns.forEach((b) => b.classList.remove('active'));
      contents.forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add('active');

      if (target === 'design' && typeof DesignEditor !== 'undefined') {
        DesignEditor.onShow();
      }
      if (target === 'onair' && typeof RundownUI !== 'undefined' && RundownUI.loaded) {
        // デザイン変更後に戻ってきたときテンプレ情報を再取得
        RundownUI.refreshTemplates();
      }
      if (target === 'home' && typeof HomeUI !== 'undefined') {
        HomeUI.refresh();
      }
    });
  });

  // ヘッダーの状態ピル → 設定の該当セクションへ
  document.querySelectorAll('.app-header [data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      const btn = document.querySelector(`.tab-btn[data-tab="${el.dataset.goto}"]`);
      if (btn) btn.click();
      if (el.dataset.section && typeof SettingsNav !== 'undefined') SettingsNav.show(el.dataset.section);
    });
  });

  // ヘルプ (旧マニュアルタブ) — 右からのドロワー
  const overlay = document.getElementById('help-overlay');
  const openHelp = () => {
    overlay.classList.remove('hidden');
    if (typeof ManualUI !== 'undefined') ManualUI.onShow();
  };
  const closeHelp = () => overlay.classList.add('hidden');
  document.getElementById('help-open').addEventListener('click', openHelp);
  document.getElementById('help-close').addEventListener('click', closeHelp);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeHelp(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeHelp();
    if (e.key === 'F1') { e.preventDefault(); openHelp(); }
  });
})();

// ヘッダーの時計 (放送運用の基準時刻)
(function () {
  const el = document.getElementById('hdr-clock');
  if (!el) return;
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 250);
})();

/** ヘッダー右側の状態ピル (出力サーバ / 2台運用) */
const HeaderStatus = {
  setOutput(running, port) {
    const el = document.getElementById('hdr-output');
    if (!el) return;
    el.classList.toggle('ok', !!running);
    el.querySelector('.hdr-pill-text').textContent = running ? `OUTPUT :${port}` : 'OUTPUT 停止';
  },
  setRemote(role, connected, count) {
    const el = document.getElementById('hdr-remote');
    if (!el) return;
    el.classList.toggle('hidden', role === 'standalone');
    el.classList.toggle('ok', !!connected);
    el.classList.toggle('warn', !connected);
    const label = role === 'host'
      ? `LINK HOST${connected ? ` · ${count}` : ' (待機)'}`
      : `LINK CLIENT${connected ? '' : ' (再接続中)'}`;
    el.querySelector('.hdr-pill-text').textContent = label;
  },
};
