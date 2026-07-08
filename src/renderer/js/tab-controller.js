/**
 * タブ切替制御 + 並列表示（DOM組み替え方式）
 */
(function () {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const nameTab = document.getElementById('tab-name-telop');
  const sideTab = document.getElementById('tab-side-telop');
  const settingsTab = document.getElementById('tab-settings');
  const dualTab = document.getElementById('tab-dual');
  const designTab = document.getElementById('tab-design');

  // パネル参照
  const nameLayout = nameTab.querySelector('.panel-layout');
  const sideLayout = sideTab.querySelector('.panel-layout');
  const nameInput = nameTab.querySelector('.panel--input');
  const sideInput = sideTab.querySelector('.panel--input');
  const nameBroadcast = nameTab.querySelector('.panel--broadcast');
  const sideBroadcast = sideTab.querySelector('.panel--broadcast');

  // ヘッダーh2参照（テキスト切替用）
  const nameH2 = nameBroadcast.querySelector('.panel-header h2');
  const sideH2 = sideBroadcast.querySelector('.panel-header h2');

  // 並列モード状態管理
  let dualActive = false;
  let savedNameChildren = null;
  let savedSideChildren = null;

  function enterDualMode() {
    // 元の子要素順序を保存（復元時に使用）
    savedNameChildren = [...nameBroadcast.children];
    savedSideChildren = [...sideBroadcast.children];

    // 入力パネルを左カラムへ移動
    document.getElementById('dual-tables').append(nameInput, sideInput);

    // 名前テロップのプレビューを共有プレビューエリアへ
    const namePreview = nameBroadcast.querySelector('.preview-container');
    document.getElementById('dual-preview').appendChild(namePreview);

    // 名前テロップの残りコントロールを左側コントロールカラムへ
    const dualCtrlName = document.getElementById('dual-ctrl-name');
    while (nameBroadcast.firstChild) {
      dualCtrlName.appendChild(nameBroadcast.firstChild);
    }

    // サイドテロップのコントロールを右側カラムへ（プレビューは除く）
    const dualCtrlSide = document.getElementById('dual-ctrl-side');
    const sideChildren = [...sideBroadcast.children];
    sideChildren.forEach(child => {
      if (!child.classList.contains('preview-container')) {
        dualCtrlSide.appendChild(child);
      }
    });

    // ヘッダーテキストを変更
    nameH2.textContent = '名前テロップ';
    sideH2.textContent = 'サイドテロップ';

    dualActive = true;
  }

  function leaveDualMode() {
    if (!dualActive) return;

    // 名前テロップ送出パネルの子要素を元の順序で復元
    savedNameChildren.forEach(child => nameBroadcast.appendChild(child));

    // サイドテロップ送出パネルの子要素を元の順序で復元
    savedSideChildren.forEach(child => sideBroadcast.appendChild(child));

    // 入力パネルを元のレイアウトに復元（送出パネルの前に配置）
    nameLayout.insertBefore(nameInput, nameBroadcast);
    sideLayout.insertBefore(sideInput, sideBroadcast);

    // ヘッダーテキストを復元
    nameH2.textContent = '送出制御';
    sideH2.textContent = '送出制御';

    dualTab.classList.remove('active');
    dualActive = false;
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      // すべてのタブボタンを非アクティブに
      tabBtns.forEach((b) => b.classList.remove('active'));

      // 並列モードを解除（DOM復元）
      leaveDualMode();

      // すべてのタブコンテンツを非アクティブに
      nameTab.classList.remove('active');
      sideTab.classList.remove('active');
      settingsTab.classList.remove('active');
      dualTab.classList.remove('active');
      designTab.classList.remove('active');

      btn.classList.add('active');

      if (target === 'dual') {
        enterDualMode();
        dualTab.classList.add('active');
      } else if (target === 'name-telop') {
        nameTab.classList.add('active');
      } else if (target === 'side-telop') {
        sideTab.classList.add('active');
      } else if (target === 'settings') {
        settingsTab.classList.add('active');
      } else if (target === 'design') {
        designTab.classList.add('active');
        if (typeof DesignEditor !== 'undefined') DesignEditor.onShow();
      }
    });
  });
})();
