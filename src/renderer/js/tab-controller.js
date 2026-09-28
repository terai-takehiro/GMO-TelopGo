/**
 * タブ切替制御 (ホーム / 送出 / デザイン / マニュアル / 設定)
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
      if (target === 'manual' && typeof ManualUI !== 'undefined') {
        ManualUI.onShow();
      }
    });
  });
})();
