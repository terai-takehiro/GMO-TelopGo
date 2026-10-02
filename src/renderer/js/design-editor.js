/**
 * デザインエディタ (Photoshop風レイヤー編集)
 *
 * グラフィックステンプレートをGUIで編集する。
 * アートボードは出力ページと同じ TelopRenderer で描画するため、
 * 編集画面の見た目 = vMix出力の見た目 (WYSIWYG)。
 *
 * - レイヤーパネル: 選択 / 表示切替 / ロック / 重ね順 / 追加・複製・削除
 * - アートボード: ドラッグ移動 / 8方向リサイズ / 中央・端スナップ / 矢印キー移動
 * - プロパティパネル: 位置・サイズ・フォント・色・縁取り・影・塗り 等
 * - 保存すると project.json に書き込まれ、出力ページへ即時反映される
 */
const DesignEditor = {
  CANVAS_W: 1920,
  CANVAS_H: 1080,
  SNAP_PX: 8, // スナップ判定 (画面px)

  ANIM_PRESETS: [
    ['cut', 'カット (出現)'], ['fade', 'フェード'], ['slide', 'スライド'], ['wipe', 'ワイプ'],
    ['push', 'プッシュ (押し出し)'], ['pop', 'ポップ'], ['zoom', 'ズーム'],
    ['flip', 'フリップ (回転)'], ['blur', 'ブラー'], ['chars', '文字送り'],
  ],
  ANIM_EASINGS: [
    ['ease-out', 'イーズアウト'], ['ease-in', 'イーズイン'], ['ease-in-out', 'イーズ両端'],
    ['ease', 'イーズ'], ['linear', 'リニア'], ['cubic-bezier(0.34,1.56,0.64,1)', 'バウンス'],
  ],
  ANIM_DIRECTIONS: [['up', '上へ'], ['down', '下へ'], ['left', '左へ'], ['right', '右へ']],

  /** Webフォント取得の候補 (Google Fontsの日本語フォントのみ、[ファミリー, 取得ウェイト]) */
  GOOGLE_FONTS: [
    ['LINE Seed JP', [400, 700, 800]],
    ['Noto Sans JP', [400, 700, 900]],
    ['Noto Serif JP', [400, 700, 900]],
    ['M PLUS 1p', [400, 700, 900]],
    ['M PLUS Rounded 1c', [400, 700]],
    ['Zen Kaku Gothic New', [400, 700, 900]],
    ['Zen Maru Gothic', [400, 700, 900]],
    ['Zen Antique', [400]],
    ['BIZ UDPGothic', [400, 700]],
    ['BIZ UDPMincho', [400]],
    ['Shippori Mincho', [400, 700]],
    ['Kosugi Maru', [400]],
    ['Sawarabi Gothic', [400]],
    ['Kiwi Maru', [400, 500]],
    ['Dela Gothic One', [400]],
    ['DotGothic16', [400]],
    ['RocknRoll One', [400]],
    ['Yusei Magic', [400]],
    ['Mochiy Pop One', [400]],
    ['Train One', [400]],
    ['Reggae One', [400]],
  ],

  TEMPLATE_LABELS: {
    'name-nameOnly': '名前スーパー: 名前のみ',
    'name-1S': '名前スーパー: 1S',
    'name-2S': '名前スーパー: 2S',
    'name-3S': '名前スーパー: 3S',
    'name-4S': '名前スーパー: 4S',
    'side': 'サイドスーパー',
  },

  project: null,       // 編集中プロジェクト (保存するまでメモリ上)
  templateKey: 'name-1S',
  lang: 'jp',
  selectedId: null,
  zoomMode: 'fit',
  zoom: 0.4,
  dirty: false,
  undoStack: [],
  redoStack: [],
  drag: null,          // 進行中のドラッグ {kind:'move'|'resize', ...}
  gridSize: 0,         // グリッド間隔 (px, 0=非表示)
  safetyMode: 'off',    // セーフティゾーン表示 'off' | '98' | '95' | 'both'
  aspectLocked: false,  // プロパティパネルのW/H数値入力で縦横比を固定するか
  loaded: false,

  init() {
    // デザインセット
    document.getElementById('de-set-select').addEventListener('change', (e) => this.switchSet(e.target.value));
    document.getElementById('de-set-new').addEventListener('click', () => this.openSetDialog('new'));
    document.getElementById('de-set-rename').addEventListener('click', () => this.openSetDialog('rename'));
    document.getElementById('de-set-delete').addEventListener('click', () => this.deleteSet());
    document.getElementById('de-set-cancel').addEventListener('click', () => document.getElementById('de-set-dialog').close());
    document.getElementById('de-set-ok').addEventListener('click', () => this.submitSetDialog());

    // ツールバー
    document.getElementById('de-template').addEventListener('change', (e) => {
      this.templateKey = e.target.value;
      this.clearSelection();
      this.renderAll();
    });
    document.getElementById('de-tpl-add').addEventListener('click', () => this.openTplDialog());
    document.getElementById('de-tpl-rename').addEventListener('click', () => this.renameTemplate());
    document.getElementById('de-tpl-delete').addEventListener('click', () => this.deleteTemplate());
    document.getElementById('de-tpl-cancel').addEventListener('click', () => document.getElementById('de-tpl-dialog').close());
    document.getElementById('de-tpl-ok').addEventListener('click', () => this.submitTplDialog());
    document.getElementById('de-lang-jp').addEventListener('click', () => this.setLang('jp'));
    document.getElementById('de-lang-en').addEventListener('click', () => this.setLang('en'));
    document.getElementById('de-zoom').addEventListener('change', (e) => {
      this.zoomMode = e.target.value;
      this.applyZoom();
      this.renderSelection();
    });
    document.getElementById('de-anim-settings').addEventListener('click', () => {
      this.clearSelection();
      this.renderAll();
    });
    document.getElementById('de-play-in').addEventListener('click', () => this.playAnimation('in'));
    document.getElementById('de-play-out').addEventListener('click', () => this.playAnimation('out'));
    document.getElementById('de-copy-lang').addEventListener('click', () => this.copyJpToEn());
    document.getElementById('de-add-font').addEventListener('click', () => this.addFont());
    document.getElementById('de-add-gfont').addEventListener('click', () => this.openGFontDialog());
    document.getElementById('de-gfont-cancel').addEventListener('click', () => document.getElementById('de-gfont-dialog').close());
    document.getElementById('de-gfont-fetch').addEventListener('click', () => this.fetchGoogleFont());
    document.getElementById('de-export').addEventListener('click', () => this.exportDesign());
    document.getElementById('de-import').addEventListener('click', () => this.importDesign());
    document.getElementById('de-export-png').addEventListener('click', () => this.exportPng());
    document.getElementById('de-set-gallery-btn').addEventListener('click', () => this.openSetGallery());
    document.getElementById('de-set-gallery-close').addEventListener('click', () => document.getElementById('de-set-gallery').close());
    document.getElementById('de-font-replace').addEventListener('click', () => this.openFontReplaceDialog());
    document.getElementById('de-fr-cancel').addEventListener('click', () => document.getElementById('de-font-replace-dialog').close());
    document.getElementById('de-fr-ok').addEventListener('click', () => this.submitFontReplace());
    document.getElementById('de-undo').addEventListener('click', () => this.undo());
    document.getElementById('de-redo').addEventListener('click', () => this.redo());
    document.getElementById('de-reload').addEventListener('click', () => this.reload());
    document.getElementById('de-save').addEventListener('click', () => this.save());

    // レイヤー操作
    document.getElementById('de-layer-up').addEventListener('click', () => this.moveLayer(1));
    document.getElementById('de-layer-down').addEventListener('click', () => this.moveLayer(-1));
    document.getElementById('de-layer-top').addEventListener('click', () => this.moveLayerEnd(true));
    document.getElementById('de-layer-bottom').addEventListener('click', () => this.moveLayerEnd(false));
    document.getElementById('de-grid').addEventListener('change', (e) => {
      this.gridSize = parseInt(e.target.value, 10) || 0;
      this.updateOverlayAids();
    });
    document.getElementById('de-safety').addEventListener('change', (e) => {
      this.safetyMode = e.target.value;
      this.updateOverlayAids();
    });
    document.getElementById('de-add-text').addEventListener('click', () => this.addLayer('text'));
    document.getElementById('de-add-rect').addEventListener('click', () => this.addLayer('rect'));
    document.getElementById('de-add-image').addEventListener('click', () => this.addLayer('image'));
    document.getElementById('de-duplicate').addEventListener('click', () => this.duplicateLayer());
    document.getElementById('de-delete').addEventListener('click', () => this.deleteLayer());

    // アートボード操作
    const canvas = document.getElementById('de-canvas');
    canvas.addEventListener('mousedown', (e) => this.onCanvasMouseDown(e));
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', () => this.onMouseUp());
    window.addEventListener('resize', () => { this.applyZoom(); this.renderSelection(); });

    // キーボード
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.initChrome();
  },

  // ===== Photoshop風の外枠 (メニュー / ツール / パネルタブ / ドキュメントタブ / スタイル) =====

  /** プロパティパネルのタブ ('props' | 'text' | 'anim') */
  propsTab: 'props',

  initChrome() {
    const root = document.getElementById('tab-design');

    // メニューバー: クリックで開閉、開いている間はホバーで隣のメニューへ移る
    const menus = () => root.querySelectorAll('.de-menu');
    const closeMenus = () => {
      menus().forEach((m) => m.classList.add('hidden'));
      root.querySelectorAll('.de-menu-btn').forEach((b) => b.classList.remove('open'));
    };
    const openMenu = (btn) => {
      closeMenus();
      const menu = document.getElementById(btn.dataset.demenu);
      if (!menu) return;
      menu.classList.remove('hidden');
      btn.classList.add('open');
    };
    root.querySelectorAll('.de-menu-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.classList.contains('open')) closeMenus(); else openMenu(btn);
      });
      btn.addEventListener('mouseenter', () => {
        if (root.querySelector('.de-menu-btn.open') && !btn.classList.contains('open')) openMenu(btn);
      });
    });
    root.querySelectorAll('.de-menu').forEach((m) => m.addEventListener('click', (e) => {
      if (e.target.closest('.de-menu-item')) closeMenus();
    }));
    document.addEventListener('click', (e) => { if (!e.target.closest('.de-menu-wrap')) closeMenus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

    // メニュー項目等から本体ボタンへの委譲 (data-click="<id>")
    root.querySelectorAll('[data-click]').forEach((el) => {
      el.addEventListener('click', () => {
        const target = document.getElementById(el.dataset.click);
        if (target) target.click();
      });
    });

    // ツール: 図形の種類つき追加
    root.querySelectorAll('.de-tool[data-shape]').forEach((btn) => {
      btn.addEventListener('click', () => this.addShapeLayer(btn.dataset.shape));
    });

    // プロパティパネルのタブ
    root.querySelectorAll('#de-props-tabs .de-ptab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.propsTab = tab.dataset.ptab;
        this.showPropsTab();
      });
    });

    // テンプレート / スタイル パネルのタブ
    root.querySelectorAll('#de-lib-tabs .de-ptab').forEach((tab) => {
      tab.addEventListener('click', () => {
        root.querySelectorAll('#de-lib-tabs .de-ptab').forEach((t) => t.classList.toggle('active', t === tab));
        document.getElementById('de-lib-tpl').classList.toggle('hidden', tab.dataset.libtab !== 'tpl');
        document.getElementById('de-lib-style').classList.toggle('hidden', tab.dataset.libtab !== 'style');
      });
    });

    document.getElementById('de-style-add').addEventListener('click', () => this.registerStylePreset());
    document.getElementById('de-group').addEventListener('click', () => this.groupSelection());
    this.initContextMenus();
    document.getElementById('de-ungroup').addEventListener('click', () => this.ungroupSelection());
  },

  // ===== 右クリックメニュー (Photoshop風) =====

  /**
   * コンテキストメニューを表示する
   * items: { label, kbd?, action?, disabled?, danger?, checked?, submenu?: items } | '-'
   */
  showContextMenu(x, y, items) {
    this.closeContextMenu();
    const build = (list, left, top, isSub) => {
      const menu = document.createElement('div');
      menu.className = `de-ctx${isSub ? ' de-ctx--sub' : ''}`;
      list.forEach((it) => {
        if (it === '-') {
          if (menu.lastChild && !menu.lastChild.classList.contains('de-ctx-sep')) {
            menu.appendChild(Object.assign(document.createElement('div'), { className: 'de-ctx-sep' }));
          }
          return;
        }
        const row = document.createElement('button');
        row.className = `de-ctx-item${it.danger ? ' de-ctx-item--danger' : ''}`;
        row.disabled = !!it.disabled;
        const check = document.createElement('span');
        check.className = 'de-ctx-check';
        check.textContent = it.checked ? '✓' : '';
        const label = document.createElement('span');
        label.className = 'de-ctx-label';
        label.textContent = it.label;
        const kbd = document.createElement('span');
        kbd.className = 'de-ctx-kbd';
        kbd.textContent = it.submenu ? '▸' : (it.kbd || '');
        row.append(check, label, kbd);
        if (it.submenu) {
          let sub = null;
          row.addEventListener('mouseenter', () => {
            menu.querySelectorAll(':scope > .de-ctx--sub').forEach((m) => m.remove());
            const r = row.getBoundingClientRect();
            sub = build(it.submenu, r.right - 2, r.top - 4, true);
            menu.appendChild(sub);
          });
        } else {
          row.addEventListener('mouseenter', () => {
            menu.querySelectorAll(':scope > .de-ctx--sub').forEach((m) => m.remove());
          });
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeContextMenu();
            if (!it.disabled && it.action) it.action();
          });
        }
        menu.appendChild(row);
      });
      if (menu.lastChild && menu.lastChild.classList.contains('de-ctx-sep')) menu.lastChild.remove();
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      // 画面外にはみ出さないよう位置補正 (描画後に計測)
      requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = `${Math.max(4, (isSub ? left - r.width - 180 : window.innerWidth - r.width - 4))}px`;
        if (r.bottom > window.innerHeight) menu.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
      });
      if (!isSub) document.body.appendChild(menu);
      return menu;
    };
    this._ctx = build(items, x, y, false);
  },

  closeContextMenu() {
    if (this._ctx) { this._ctx.remove(); this._ctx = null; }
  },

  initContextMenus() {
    const close = () => this.closeContextMenu();
    document.addEventListener('mousedown', (e) => { if (this._ctx && !this._ctx.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);

    // キャンバス: レイヤー上ならそのレイヤー (グループ) のメニュー、空き領域なら作成メニュー
    document.getElementById('de-viewport').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const wrap = document.getElementById('de-canvas-wrap');
      const r = wrap.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const layer = inside ? this.hitTest(this.canvasPoint(e)) : null;
      if (layer && !this.targets().includes(layer)) {
        if (layer.groupId && !(e.ctrlKey || e.metaKey)) this.selectGroup(layer.groupId); else this.selectLayer(layer.id);
        this.refreshSelectionUI();
      }
      if (layer) this.showContextMenu(e.clientX, e.clientY, this.layerMenuItems());
      else this.showContextMenu(e.clientX, e.clientY, this.canvasMenuItems());
    });

    // ドキュメントタブ / テンプレート一覧: テンプレートのメニュー
    ['de-doc-tabs', 'de-tpl-list'].forEach((id) => {
      document.getElementById(id).addEventListener('contextmenu', (e) => {
        const btn = e.target.closest('[data-tpl-key]');
        if (!btn) return;
        e.preventDefault();
        this.selectTemplate(btn.dataset.tplKey);
        this.showContextMenu(e.clientX, e.clientY, this.templateMenuItems(btn.dataset.tplKey));
      });
    });
  },

  /** レイヤー / グループ / 複数選択の右クリックメニュー */
  layerMenuItems() {
    const targets = this.targets();
    const group = this.activeGroup();
    const one = targets.length === 1 ? targets[0] : null;
    const inGroup = !!(one && one.groupId) || !!group;
    const allHidden = targets.every((l) => l.visible === false);
    const allLocked = targets.every((l) => l.locked);
    const textLayer = one && one.type === 'text' ? one : null;
    const align = (fn) => () => { this.beginChange(); const b = this.boundsOf(this.targets()); fn(b); this.renderAll(); };
    const shift = (dx, dy) => this.targets().forEach((l) => { l.x += dx; l.y += dy; });
    const items = [];
    if (group) {
      items.push({ label: 'グループ名の変更…', action: () => this.renameGroup(group) });
      items.push({ label: 'グループのアニメーション…', action: () => { this.propsTab = 'anim'; this.renderProps(); } });
      items.push('-');
      items.push({ label: 'グループを複製', kbd: 'Ctrl+J', action: () => this.duplicateLayer() });
      items.push({ label: 'グループ解除', kbd: 'Ctrl+Shift+G', action: () => this.ungroupSelection() });
      items.push({ label: 'グループを削除', kbd: 'Del', danger: true, action: () => this.deleteLayer() });
    } else {
      if (one) items.push({ label: 'レイヤー名の変更…', action: () => this.renameLayer(one) });
      items.push({ label: targets.length > 1 ? `${targets.length}個のレイヤーを複製` : 'レイヤーを複製', kbd: 'Ctrl+J', action: () => this.duplicateLayer() });
      items.push({ label: targets.length > 1 ? `${targets.length}個のレイヤーを削除` : 'レイヤーを削除', kbd: 'Del', danger: true, action: () => this.deleteLayer() });
      items.push('-');
      items.push({ label: 'レイヤーからグループ…', kbd: 'Ctrl+G', action: () => this.groupSelection() });
      if (inGroup) items.push({ label: 'グループから出す / 解除', kbd: 'Ctrl+Shift+G', action: () => this.ungroupSelection() });
    }
    items.push('-');
    items.push({ label: 'コピー', kbd: 'Ctrl+C', action: () => this.copyLayers() });
    items.push({ label: 'ペースト', kbd: 'Ctrl+V', disabled: !this._layerClipboard, action: () => this.pasteLayers() });
    items.push('-');
    items.push({
      label: '重ね順',
      submenu: [
        { label: '最前面へ', kbd: 'Ctrl+Shift+]', action: () => this.moveLayerEnd(true) },
        { label: '前面へ', kbd: 'Ctrl+]', action: () => this.moveLayer(1) },
        { label: '背面へ', kbd: 'Ctrl+[', action: () => this.moveLayer(-1) },
        { label: '最背面へ', kbd: 'Ctrl+Shift+[', action: () => this.moveLayerEnd(false) },
      ],
    });
    items.push({
      label: '整列 (カンバス基準)',
      submenu: [
        { label: '左端', action: align((b) => shift(-b.x, 0)) },
        { label: '水平方向中央', action: align((b) => shift(Math.round((this.CANVAS_W - b.w) / 2) - b.x, 0)) },
        { label: '右端', action: align((b) => shift(this.CANVAS_W - b.w - b.x, 0)) },
        '-',
        { label: '上端', action: align((b) => shift(0, -b.y)) },
        { label: '垂直方向中央', action: align((b) => shift(0, Math.round((this.CANVAS_H - b.h) / 2) - b.y)) },
        { label: '下端', action: align((b) => shift(0, this.CANVAS_H - b.h - b.y)) },
      ],
    });
    items.push('-');
    if (group) {
      items.push({ label: 'グループを非表示', checked: group.visible === false, action: () => { this.beginChange(); group.visible = group.visible === false; this.renderAll(); } });
      items.push({ label: 'グループをロック', checked: !!group.locked, action: () => { this.beginChange(); group.locked = !group.locked; this.renderAll(); } });
    } else {
      items.push({ label: 'レイヤーを非表示', checked: allHidden, action: () => { this.beginChange(); targets.forEach((l) => { l.visible = allHidden; }); this.renderAll(); } });
      items.push({ label: 'レイヤーをロック', checked: allLocked, action: () => { this.beginChange(); targets.forEach((l) => { l.locked = !allLocked; }); this.renderAll(); } });
    }
    if (textLayer) {
      items.push('-');
      items.push({ label: 'レイヤースタイルをコピー', action: () => { this._styleClipboard = this.captureStyle(textLayer); App.setStatus('装飾スタイルをコピーしました', 'success'); } });
      items.push({ label: 'レイヤースタイルをペースト', disabled: !this._styleClipboard, action: () => { this.beginChange(); this.applyStyle(textLayer, this._styleClipboard); this.renderAll(); } });
      items.push({ label: 'スタイルとして登録…', action: () => this.registerStylePreset() });
    }
    items.push('-');
    items.push({ label: '選択を解除', kbd: 'Ctrl+D', action: () => { this.clearSelection(); this.renderAll(); } });
    return items;
  },

  /** キャンバスの空き領域の右クリックメニュー */
  canvasMenuItems() {
    return [
      { label: '文字を追加', action: () => this.addLayer('text') },
      { label: '矩形を追加', action: () => this.addLayer('rect') },
      { label: '楕円を追加', action: () => this.addShapeLayer('ellipse') },
      { label: '画像を追加…', action: () => this.addLayer('image') },
      '-',
      { label: 'ペースト', kbd: 'Ctrl+V', disabled: !this._layerClipboard, action: () => this.pasteLayers() },
      { label: 'すべてを選択', kbd: 'Ctrl+A', disabled: !this.layers().length, action: () => this.selectAll() },
      { label: '選択を解除', kbd: 'Ctrl+D', disabled: !this.targets().length, action: () => { this.clearSelection(); this.renderAll(); } },
      '-',
      { label: 'IN を試写', action: () => this.playAnimation('in') },
      { label: 'OUT を試写', action: () => this.playAnimation('out') },
      { label: 'テンプレートのアニメーション設定', action: () => { this.clearSelection(); this.renderAll(); } },
      '-',
      {
        label: '表示',
        submenu: [
          { label: 'フィット', action: () => this.setZoomValue('fit') },
          { label: '100%', action: () => this.setZoomValue('1') },
          { label: '50%', action: () => this.setZoomValue('0.5') },
          '-',
          { label: 'セーフティゾーン (98%+95%)', checked: this.safetyMode !== 'off', action: () => { const c = document.getElementById('de-safety'); c.value = this.safetyMode === 'off' ? 'both' : 'off'; c.dispatchEvent(new Event('change')); } },
        ],
      },
    ];
  },

  /** テンプレート (ドキュメントタブ / 一覧) の右クリックメニュー */
  templateMenuItems(key) {
    return [
      { label: 'テンプレート名の変更…', action: () => this.renameTemplate() },
      { label: 'テンプレートを複製', action: () => this.duplicateTemplate(key) },
      { label: '新規テンプレート…', action: () => this.openTplDialog() },
      '-',
      { label: 'JP のレイアウトを EN へコピー', action: () => this.copyJpToEn() },
      { label: 'PNG で保存…', action: () => this.exportPng() },
      { label: '入力用 Excel テンプレを書き出し…', action: () => this.exportExcelTemplate(key) },
      '-',
      { label: 'テンプレートを削除', danger: true, disabled: Object.keys(this.project.templates).length <= 1, action: () => this.deleteTemplate() },
    ];
  },

  /** 入力用Excelテンプレ (列見出し+見本行)。未保存の変更を含めるため先に保存する */
  async exportExcelTemplate(key) {
    if (this.dirty) await this.save();
    const result = await window.api.downloadTemplate(key);
    if (!result) return;
    if (result.success) App.setStatus(`Excelテンプレを書き出しました: ${result.filePath}`, 'success');
    else if (result.error) App.setStatus(`Excelテンプレの書き出しエラー: ${result.error}`, 'error');
  },

  setZoomValue(v) {
    const sel = document.getElementById('de-zoom');
    sel.value = v;
    sel.dispatchEvent(new Event('change'));
  },

  selectAll() {
    const ids = this.layers().filter((l) => this.isShown(l) && !this.isLocked(l)).map((l) => l.id);
    if (!ids.length) return;
    this.selectedIds = ids;
    this.selectedId = ids[ids.length - 1];
    this.selectedGroupId = null;
    if (ids.length === 1) this.selectedIds = [ids[0]];
    this.refreshSelectionUI();
  },

  async renameLayer(layer) {
    const name = await AppModal.prompt('レイヤー名', { value: layer.name || '' });
    if (!name) return;
    this.beginChange();
    layer.name = name;
    this.renderLayerList();
    this.renderProps();
  },

  /** レイヤーのコピー (Ctrl+C): グループ選択時はグループごと */
  copyLayers() {
    const targets = this.targets();
    if (!targets.length) return;
    const group = this.activeGroup();
    this._layerClipboard = {
      templateKey: this.templateKey,
      lang: this.lang,
      layers: JSON.parse(JSON.stringify(targets)),
      group: group ? JSON.parse(JSON.stringify(group)) : null,
    };
    App.setStatus(`${targets.length}個のレイヤーをコピーしました`, 'success');
  },

  /** ペースト (Ctrl+V): 同じテンプレートなら少しずらし、別テンプレートなら同じ位置に */
  pasteLayers() {
    const clip = this._layerClipboard;
    if (!clip) return;
    this.beginChange();
    const offset = clip.templateKey === this.templateKey && clip.lang === this.lang ? 20 : 0;
    let gid = null;
    if (clip.group) {
      gid = `g${Date.now().toString(36)}`;
      this.groups().push({ ...JSON.parse(JSON.stringify(clip.group)), id: gid });
    }
    const layers = this.layers();
    const pasted = clip.layers.map((src) => {
      const l = JSON.parse(JSON.stringify(src));
      l.id = this.newLayerId();
      layers.push(l);
      l.x += offset;
      l.y += offset;
      if (gid) l.groupId = gid; else delete l.groupId;
      return l;
    });
    this.normalizeGroups();
    if (gid) this.selectGroup(gid);
    else if (pasted.length > 1) { this.selectedIds = pasted.map((l) => l.id); this.selectedId = pasted[pasted.length - 1].id; this.selectedGroupId = null; }
    else this.selectLayer(pasted[0].id);
    this.renderAll();
  },

  /** テンプレートを複製 (レイヤーIDは振り直す) */
  duplicateTemplate(key) {
    const src = this.project.templates[key];
    if (!src) return;
    this.beginChange();
    const copy = JSON.parse(JSON.stringify(src));
    Object.values(copy.variants || {}).forEach((v) => (v.layers || []).forEach((l) => { l.id = this.newLayerId(); }));
    copy.label = `${this.templateLabel(key)} コピー`;
    const newKey = `tpl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    this.project.templates[newKey] = copy;
    this.templateKey = newKey;
    this.clearSelection();
    this.refreshTemplateSelect();
    this.renderAll();
    App.setStatus(`テンプレート「${copy.label}」を作成しました`, 'success');
  },

  /** 図形ツール: 矩形を追加して形状を設定 */
  addShapeLayer(shape) {
    this.addLayer('rect');
    const layer = this.selected();
    if (!layer) return;
    layer.shape = shape;
    layer.name = { ellipse: '楕円', polygon: '多角形', star: '星形' }[shape] || layer.name;
    if (shape === 'ellipse' || shape === 'star' || shape === 'polygon') { layer.w = 300; layer.h = 300; layer.x = 810; layer.y = 390; }
    this.renderAll();
  },

  /** テンプレートを切り替える (ドキュメントタブ / テンプレート一覧から) */
  selectTemplate(key) {
    if (!this.project.templates[key] || key === this.templateKey) return;
    this.templateKey = key;
    this.clearSelection();
    document.getElementById('de-template').value = key;
    this.renderAll();
  },

  /** ドキュメントタブ + テンプレート一覧パネル */
  renderTemplateChrome() {
    const keys = Object.keys(this.project.templates);
    const zoomLabel = this.zoom ? `${Math.round(this.zoom * 100)}%` : '';
    const tabs = document.getElementById('de-doc-tabs');
    tabs.innerHTML = '';
    keys.forEach((key) => {
      const tab = document.createElement('button');
      tab.className = `de-doc-tab${key === this.templateKey ? ' active' : ''}`;
      tab.textContent = key === this.templateKey
        ? `${this.templateLabel(key)} @ ${zoomLabel} (${this.lang.toUpperCase()})${this.dirty ? ' *' : ''}`
        : this.templateLabel(key);
      tab.title = `${this.templateLabel(key)} (右クリックでメニュー)`;
      tab.dataset.tplKey = key;
      tab.addEventListener('click', () => this.selectTemplate(key));
      tabs.appendChild(tab);
    });

    const list = document.getElementById('de-tpl-list');
    list.innerHTML = '';
    keys.forEach((key) => {
      const tpl = this.project.templates[key];
      const ch = (App.channels || []).find((c) => c.region === tpl.region || c.id === tpl.region);
      const variant = (tpl.variants && (tpl.variants[this.lang] || tpl.variants.jp)) || { layers: [] };
      const row = document.createElement('button');
      row.className = `de-tpl-row${key === this.templateKey ? ' active' : ''}`;
      const name = document.createElement('span');
      name.className = 'de-tpl-name';
      name.textContent = this.templateLabel(key);
      const meta = document.createElement('span');
      meta.className = 'de-tpl-meta';
      meta.textContent = `${ch ? ch.label : tpl.region} · ${(variant.layers || []).length}レイヤー`;
      row.append(name, meta);
      row.dataset.tplKey = key;
      row.addEventListener('click', () => this.selectTemplate(key));
      list.appendChild(row);
    });

    // ステータスバー
    const info = document.getElementById('de-sb-info');
    if (info) {
      const tpl = this.project.templates[this.templateKey];
      const anim = (this.variant().animation || {});
      const fmt = (a) => (a ? `${this.ANIM_PRESET_LABELS[a.preset] || a.preset} ${a.duration || 0}ms` : '-');
      info.textContent = `${tpl ? tpl.region.toUpperCase() : ''}  ·  IN ${fmt(anim.in)} / OUT ${fmt(anim.out)}`;
    }
  },

  ANIM_PRESET_LABELS: {
    none: 'なし', fade: 'フェード', slide: 'スライド', wipe: 'ワイプ', zoom: 'ズーム', flip: 'フリップ', typewriter: '文字送り',
  },

  /** スタイルパネル: 登録済み装飾を見本付きで一覧 (クリックで選択中の文字レイヤーへ適用) */
  renderStylePanel() {
    const grid = document.getElementById('de-style-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const layer = this.selected();
    const canApply = !!(layer && layer.type === 'text');
    document.getElementById('de-style-hint').textContent = canApply
      ? 'クリックで適用 / 右クリックでメニュー' : '文字レイヤーを選択すると適用できます';
    document.getElementById('de-style-add').disabled = !canApply;
    if (!this.stylePresets.length) {
      const empty = document.createElement('div');
      empty.className = 'de-panel-empty';
      empty.textContent = 'スタイルは未登録です。文字レイヤーを選んで「＋ 登録」';
      grid.appendChild(empty);
      return;
    }
    this.stylePresets.forEach((preset) => {
      const cell = document.createElement('button');
      cell.className = 'de-style-cell';
      cell.title = preset.name;
      cell.disabled = !canApply;
      const sw = document.createElement('span');
      sw.className = 'de-style-swatch';
      const st = preset.style || {};
      const sample = document.createElement('span');
      sample.textContent = 'あA';
      const fill = st.fill;
      if (fill && fill.type === 'gradient') {
        sample.style.backgroundImage = `linear-gradient(${fill.angle !== undefined ? fill.angle : 180}deg, ${fill.from}, ${fill.to})`;
        sample.style.webkitBackgroundClip = 'text';
        sample.style.color = 'transparent';
      } else {
        sample.style.color = (fill && fill.color) || (st.font && st.font.color) || '#ffffff';
      }
      if (st.font && st.font.family) sample.style.fontFamily = st.font.family;
      // 縁取りは外側・ラウンド (出力と同じ多方向シャドウ方式)
      const shadows = TelopRenderer.edgeOffsets((st.strokes || []).map((k) => ({ width: Math.min(k.width, 4), color: k.color })))
        .map((o) => `${o.x}px ${o.y}px 0 ${o.color}`);
      if (st.shadow) shadows.push(`${st.shadow.x || 0}px ${st.shadow.y || 0}px ${Math.min(st.shadow.blur || 0, 8)}px ${st.shadow.color || 'rgba(0,0,0,0.5)'}`);
      if (shadows.length) sample.style.textShadow = shadows.join(', ');
      if (st.board && st.board.color) sw.style.background = st.board.color;
      sw.appendChild(sample);
      const name = document.createElement('span');
      name.className = 'de-style-name';
      name.textContent = preset.name;
      cell.append(sw, name);
      cell.addEventListener('click', () => {
        const target = this.selected();
        if (!target || target.type !== 'text') return;
        this.beginChange();
        this.applyStyle(target, preset.style);
        this.renderArtboard();
        this.renderProps();
        App.setStatus(`スタイル「${preset.name}」を適用しました`, 'success');
      });
      cell.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const target = this.selected();
        this.showContextMenu(e.clientX, e.clientY, [
          { label: '選択中のレイヤーに適用', disabled: !(target && target.type === 'text'), action: () => cell.click() },
          '-',
          {
            label: 'スタイルを削除', danger: true,
            action: async () => {
              if (!window.api.graphicsStylePresetDelete) return;
              if (!confirm(`スタイル「${preset.name}」を削除しますか?`)) return;
              await window.api.graphicsStylePresetDelete(preset.id);
              await this.refreshStylePresets();
              this.renderStylePanel();
            },
          },
        ]);
      });
      grid.appendChild(cell);
    });
  },

  async registerStylePreset() {
    const layer = this.selected();
    if (!layer || layer.type !== 'text' || !window.api.graphicsStylePresetAdd) return;
    const name = await AppModal.prompt('スタイル名を入力してください', { value: '' });
    if (!name) return;
    await window.api.graphicsStylePresetAdd(name, this.captureStyle(layer));
    await this.refreshStylePresets();
    this.renderStylePanel();
    App.setStatus(`スタイル「${name}」を登録しました`, 'success');
  },

  /** グループ / 複数グループ / 複数選択のプロパティ (名前・位置・整列・グループ化/解除) */
  renderGroupProps(panel, group, members, groupCount) {
    const mk = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const row = (label, ...inputs) => {
      const div = mk('div', 'de-prop-row');
      div.appendChild(mk('label', '', label));
      inputs.forEach((i) => div.appendChild(i));
      panel.appendChild(div);
    };
    const headTitle = group ? 'グループ'
      : groupCount ? `${groupCount}個のグループ (${members.length}個のレイヤー) を選択中`
        : `${members.length}個のレイヤーを選択中`;
    panel.appendChild(mk('div', 'de-props-section', headTitle));
    if (group) {
      const name = mk('input', 'input input--small');
      name.type = 'text';
      name.value = group.name;
      name.addEventListener('change', () => { this.beginChange(); group.name = name.value || group.name; this.renderLayerList(); });
      row('名前', name);
      row('メンバー', mk('span', 'de-prop-file', `${members.length}レイヤー`));
    }
    const b = this.boundsOf(members);
    const num = (val, prop, apply) => {
      const input = mk('input', 'input input--small de-prop-num');
      input.type = 'number';
      input.value = Math.round(val);
      input.dataset.gprop = prop;
      input.addEventListener('change', () => { this.beginChange(); apply(parseFloat(input.value) || 0); });
      return input;
    };
    const shift = (dx, dy) => { this.moveTargets(dx, dy); this.renderArtboard(); };
    row('X / Y',
      num(b.x, 'x', (v) => shift(v - this.boundsOf(members).x, 0)),
      num(b.y, 'y', (v) => shift(0, v - this.boundsOf(members).y)));
    row('W / H',
      num(b.w, 'w', (v) => {
        const bb = this.boundsOf(members);
        const newW = Math.max(10, v);
        const newH = this.aspectLocked && bb.w > 0 ? Math.max(10, Math.round(bb.h * (newW / bb.w))) : bb.h;
        this.scaleTargets(newW, newH);
      }),
      num(b.h, 'h', (v) => {
        const bb = this.boundsOf(members);
        const newH = Math.max(10, v);
        const newW = this.aspectLocked && bb.h > 0 ? Math.max(10, Math.round(bb.w * (newH / bb.h))) : bb.w;
        this.scaleTargets(newW, newH);
      }),
      this.aspectLockBtn(() => this.renderProps()));
    const alignBtn = (kind, title, fn) => {
      const btn = mk('button', 'btn btn--small de-align-btn');
      btn.innerHTML = this.alignIconSvg(kind);
      btn.title = title;
      btn.addEventListener('click', () => { this.beginChange(); const bb = this.boundsOf(members); fn(bb); this.renderArtboard(); this.renderProps(); });
      return btn;
    };
    row('整列 (横)',
      alignBtn('left', '左端へ', (bb) => shift(-bb.x, 0)),
      alignBtn('hcenter', '水平中央へ', (bb) => shift(Math.round((this.CANVAS_W - bb.w) / 2) - bb.x, 0)),
      alignBtn('right', '右端へ', (bb) => shift(this.CANVAS_W - bb.w - bb.x, 0)));
    row('整列 (縦)',
      alignBtn('top', '上端へ', (bb) => shift(0, -bb.y)),
      alignBtn('vcenter', '垂直中央へ', (bb) => shift(0, Math.round((this.CANVAS_H - bb.h) / 2) - bb.y)),
      alignBtn('bottom', '下端へ', (bb) => shift(0, this.CANVAS_H - bb.h - bb.y)));

    // オブジェクト同士を揃える (キャンバスではなく、選択内の他オブジェクトの位置が基準)
    if (members.length >= 2) {
      panel.appendChild(mk('div', 'de-props-section', 'オブジェクトを揃える (選択内の中央・端で揃う)'));
      const alignEachOtherBtn = (kind, title, fn) => {
        const btn = mk('button', 'btn btn--small de-align-btn');
        btn.innerHTML = this.alignIconSvg(kind);
        btn.title = title;
        btn.addEventListener('click', () => {
          this.beginChange();
          const bb = this.boundsOf(members);
          members.forEach((l) => fn(l, bb));
          this.renderArtboard();
          this.renderProps();
        });
        return btn;
      };
      row('揃える (横)',
        alignEachOtherBtn('left', '左端をお互いに揃える', (l, bb) => { l.x = Math.round(bb.x); }),
        alignEachOtherBtn('hcenter', '水平中央をお互いに揃える (シンメトリー)', (l, bb) => { l.x = Math.round(bb.x + (bb.w - l.w) / 2); }),
        alignEachOtherBtn('right', '右端をお互いに揃える', (l, bb) => { l.x = Math.round(bb.x + bb.w - l.w); }));
      row('揃える (縦)',
        alignEachOtherBtn('top', '上端をお互いに揃える', (l, bb) => { l.y = Math.round(bb.y); }),
        alignEachOtherBtn('vcenter', '垂直中央をお互いに揃える (シンメトリー)', (l, bb) => { l.y = Math.round(bb.y + (bb.h - l.h) / 2); }),
        alignEachOtherBtn('bottom', '下端をお互いに揃える', (l, bb) => { l.y = Math.round(bb.y + bb.h - l.h); }));
    }

    const actions = mk('div', 'de-prop-row');
    if (group) {
      const ungroup = mk('button', 'btn btn--small', 'グループ解除 (Ctrl+Shift+G)');
      ungroup.addEventListener('click', () => this.ungroupSelection());
      actions.appendChild(ungroup);
    } else {
      const grp = mk('button', 'btn btn--small btn--primary', groupCount ? 'グループを統合 (Ctrl+G)' : 'グループ化 (Ctrl+G)');
      grp.title = groupCount ? '選択中の複数グループを1つの新しいグループへまとめます' : '';
      grp.addEventListener('click', () => this.groupSelection());
      actions.appendChild(grp);
    }
    panel.appendChild(actions);
    panel.appendChild(mk('div', 'de-props-hint', group
      ? 'キャンバスでメンバーをクリックするとグループごと選択・移動します。Ctrl+クリックでメンバー単体を選択できます。'
      : groupCount
        ? 'レイヤーパネルやキャンバスで、グループをShift+クリックすると複数グループの選択に追加/解除できます。'
        : 'レイヤーパネルで Ctrl / Shift + クリック、キャンバスで Shift + クリックで選択を追加できます。'));
  },

  /**
   * グループのアニメーション (グループを1枚の絵として IN/OUT)。
   * Photoshopのグループ(フォルダ)と同じく、メンバーはグループの箱ごと一緒に動く。
   */
  renderGroupAnim(panel, group) {
    const mk = (tag, cls, text) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    panel.appendChild(mk('div', 'de-props-section', 'グループのアニメーション'));
    const row = mk('div', 'de-prop-row');
    row.appendChild(mk('label', '', '動き'));
    const sel = mk('select', 'input input--small');
    [['default', 'メンバーごとに動く (既定)'], ['custom', 'グループを1枚として動かす']].forEach(([v, l]) => {
      const o = mk('option', '', l);
      o.value = v;
      sel.appendChild(o);
    });
    sel.value = group.anim ? 'custom' : 'default';
    sel.addEventListener('change', () => {
      this.beginChange();
      if (sel.value === 'custom') {
        group.anim = {
          in: { preset: 'slide', direction: 'up', duration: 400, easing: 'ease-out', delay: 0 },
          out: { preset: 'fade', duration: 250, easing: 'ease-in', delay: 0 },
        };
      } else {
        delete group.anim;
      }
      this.renderArtboard();
      this.renderSelection();
      this.renderProps();
    });
    row.appendChild(sel);
    panel.appendChild(row);

    if (!group.anim) {
      panel.appendChild(mk('div', 'de-props-hint',
        '「グループを1枚として動かす」にすると、メンバー全体をまとめてスライド・ワイプ・ズームなどで出し入れできます。メンバーに個別設定があれば、グループの動きに重ねて動きます。'));
      return;
    }
    ['in', 'out'].forEach((dir) => {
      group.anim[dir] = group.anim[dir]
        || { preset: 'fade', duration: dir === 'in' ? 350 : 250, easing: dir === 'in' ? 'ease-out' : 'ease-in', delay: 0 };
      const head = mk('div', 'de-props-section de-anim-head');
      head.appendChild(mk('span', '', dir === 'in' ? 'IN (グループ)' : 'OUT (グループ)'));
      const play = mk('button', 'btn btn--small', '▶試写');
      play.addEventListener('click', () => this.playAnimation(dir));
      head.appendChild(play);
      panel.appendChild(head);
      this.renderAnimFields(panel, group.anim[dir], {
        includeDelay: true,
        defaultEasing: dir === 'in' ? 'ease-out' : 'ease-in',
      });
    });
    panel.appendChild(mk('div', 'de-props-hint', '「開始」はTAKEからの時間です。全体のタイミングは選択を解除するとタイムラインで確認できます。'));
  },

  /** プロパティパネルのタブ表示を反映 */
  showPropsTab(override) {
    const tab = override || this.propsTab;
    document.querySelectorAll('#de-props-tabs .de-ptab').forEach((t) => t.classList.toggle('active', t.dataset.ptab === tab));
    document.querySelectorAll('#de-props .de-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
  },

  systemFonts: [],
  systemFontsLoaded: false,

  /** デザインタブ表示時 (初回にプロジェクトを読み込む) */
  async onShow() {
    if (!this.loaded) {
      await this.refreshSets();
      await this.loadProject();
      await this.refreshStylePresets();
    }
    this.applyZoom();
    this.renderSelection();

    // インストール済みフォント一覧を取得 (初回のみ、Windowsでは1秒程度)
    if (!this.systemFontsLoaded) {
      this.systemFontsLoaded = true;
      this.systemFonts = await window.api.getSystemFonts();
      this.renderProps(); // フォントプルダウンに反映
    }
  },

  // ===== デザインセット管理 =====

  sets: { activeId: null, sets: [] },
  _setDialogMode: 'new',

  async refreshSets() {
    this.sets = await window.api.graphicsListSets();
    const select = document.getElementById('de-set-select');
    select.innerHTML = '';
    this.sets.sets.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === this.sets.activeId) opt.selected = true;
      select.appendChild(opt);
    });
  },

  async switchSet(id) {
    if (id === this.sets.activeId) return;
    if (this.dirty) {
      if (!confirm('デザインに未保存の変更があります。保存してから切り替えます。よろしいですか?')) {
        document.getElementById('de-set-select').value = this.sets.activeId; // 元に戻す
        return;
      }
      await this.save();
    }
    const result = await window.api.graphicsSwitchSet(id);
    if (!result.ok) {
      App.setStatus(`セット切替エラー: ${result.error}`, 'error');
      document.getElementById('de-set-select').value = this.sets.activeId;
      return;
    }
    this.sets = result;
    this.clearSelection();
    await this.loadProject();
    const name = result.sets.find((s) => s.id === id);
    App.setStatus(`デザインセット「${name ? name.name : id}」に切り替えました (出力にも反映されます)`, 'success');
  },

  openSetDialog(mode) {
    this._setDialogMode = mode;
    document.getElementById('de-set-dialog-title').textContent = mode === 'new' ? '新しいデザインセット' : 'セット名の変更';
    document.getElementById('de-set-base-row').classList.toggle('hidden', mode !== 'new');
    const nameInput = document.getElementById('de-set-name');
    if (mode === 'rename') {
      const current = this.sets.sets.find((s) => s.id === this.sets.activeId);
      nameInput.value = current ? current.name : '';
    } else {
      nameInput.value = '';
    }
    document.getElementById('de-set-dialog').showModal();
    nameInput.focus();
  },

  async submitSetDialog() {
    const name = document.getElementById('de-set-name').value.trim();
    if (!name) {
      App.setStatus('セット名を入力してください', 'error');
      return;
    }
    document.getElementById('de-set-dialog').close();

    if (this._setDialogMode === 'new') {
      // 未保存の変更は複製元に含めるため先に保存
      if (this.dirty) await this.save();
      const fromCurrent = document.getElementById('de-set-base').value === 'copy';
      const result = await window.api.graphicsCreateSet(name, fromCurrent);
      if (!result.ok) {
        App.setStatus(`セット作成エラー: ${result.error}`, 'error');
        return;
      }
      this.sets = result;
      this.clearSelection();
      await this.refreshSets();
      await this.loadProject();
      App.setStatus(`デザインセット「${name}」を作成しました`, 'success');
    } else {
      const result = await window.api.graphicsRenameSet(this.sets.activeId, name);
      if (!result.ok) {
        App.setStatus(`名前変更エラー: ${result.error}`, 'error');
        return;
      }
      this.sets = result;
      await this.refreshSets();
      App.setStatus(`セット名を「${name}」に変更しました`, 'success');
    }
  },

  /** 現在のセットを削除し、別のセットへ自動で切り替える */
  async deleteSet() {
    const id = this.sets.activeId;
    const entry = this.sets.sets.find((s) => s.id === id);
    if (!entry) return;
    const others = this.sets.sets.filter((s) => s.id !== id);
    if (others.length === 0) {
      App.setStatus('最後のデザインセットは削除できません。', 'error');
      return;
    }
    const warn = this.dirty ? '\n※未保存の変更も一緒に破棄されます' : '';
    if (!confirm(`デザインセット「${entry.name}」を削除し、「${others[0].name}」に切り替えます。よろしいですか?\n(この操作は元に戻せません)${warn}`)) return;

    const sw = await window.api.graphicsSwitchSet(others[0].id);
    if (!sw.ok) {
      App.setStatus(`切替エラー: ${sw.error}`, 'error');
      return;
    }
    const result = await window.api.graphicsDeleteSet(id);
    if (!result.ok) {
      App.setStatus(`削除エラー: ${result.error}`, 'error');
      return;
    }
    this.sets = result;
    this.clearSelection();
    await this.refreshSets();
    await this.loadProject();
    App.setStatus(`デザインセット「${entry.name}」を削除し、「${others[0].name}」に切り替えました`, 'success');
  },

  templateLabel(key) {
    const tpl = this.project && this.project.templates && this.project.templates[key];
    return (tpl && tpl.label) || this.TEMPLATE_LABELS[key] || key;
  },

  // ===== テンプレート管理 (追加/名前変更/削除) =====

  openTplDialog() {
    const chSel = document.getElementById('de-tpl-channel');
    chSel.innerHTML = '';
    (App.channels.length ? App.channels : [{ id: 'name', label: '名前', region: 'name' }, { id: 'side', label: 'サイド', region: 'side' }])
      .forEach((ch) => {
        const opt = document.createElement('option');
        opt.value = ch.region;
        opt.textContent = `${ch.label} (${ch.region})`;
        chSel.appendChild(opt);
      });
    const cur = this.region();
    if ([...chSel.options].some((o) => o.value === cur)) chSel.value = cur;
    document.getElementById('de-tpl-name').value = '';
    document.getElementById('de-tpl-dialog').showModal();
  },

  submitTplDialog() {
    const name = document.getElementById('de-tpl-name').value.trim();
    const region = document.getElementById('de-tpl-channel').value;
    const base = document.getElementById('de-tpl-base').value;
    if (!name) {
      App.setStatus('テンプレート名を入力してください', 'error');
      return;
    }
    document.getElementById('de-tpl-dialog').close();
    const key = `tpl_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
    this.beginChange();
    let template;
    if (base === 'copy') {
      template = JSON.parse(JSON.stringify(this.project.templates[this.templateKey]));
      // レイヤーIDを振り直す
      Object.values(template.variants).forEach((variant) => {
        (variant.layers || []).forEach((layer) => { layer.id = this.newLayerId(); });
      });
    } else {
      template = {
        variants: {
          jp: { layers: [], animation: { in: { preset: 'fade', duration: 350 }, out: { preset: 'fade', duration: 250 } } },
          en: { layers: [], animation: { in: { preset: 'fade', duration: 350 }, out: { preset: 'fade', duration: 250 } } },
        },
      };
    }
    template.region = region;
    template.label = name;
    this.project.templates[key] = template;
    this.templateKey = key;
    this.clearSelection();
    this.refreshTemplateSelect();
    this.renderAll();
    App.setStatus(`テンプレート「${name}」を追加しました (保存で送出タブでも使えます)`, 'success');
  },

  async renameTemplate() {
    // Electron では window.prompt が使えないためアプリ内モーダルを使う
    const name = await AppModal.prompt('テンプレート名', { value: this.templateLabel(this.templateKey) });
    if (!name) return;
    this.beginChange();
    this.project.templates[this.templateKey].label = name;
    this.refreshTemplateSelect();
    this.renderAll();
  },

  deleteTemplate() {
    const keys = Object.keys(this.project.templates);
    if (keys.length <= 1) {
      App.setStatus('最後のテンプレートは削除できません', 'error');
      return;
    }
    if (!confirm(`テンプレート「${this.templateLabel(this.templateKey)}」を削除しますか?\nこのテンプレートを使うページは送出できなくなります。`)) return;
    this.beginChange();
    delete this.project.templates[this.templateKey];
    this.templateKey = Object.keys(this.project.templates)[0];
    this.clearSelection();
    this.refreshTemplateSelect();
    this.renderAll();
  },

  refreshTemplateSelect() {
    const select = document.getElementById('de-template');
    select.innerHTML = '';
    Object.keys(this.project.templates).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = this.templateLabel(key);
      select.appendChild(opt);
    });
    select.value = this.templateKey;
  },

  async loadProject() {
    this.project = await window.api.graphicsGetProject();
    this.loaded = true;
    this.dirty = false;
    this.undoStack = [];
    this.redoStack = [];

    // テンプレート選択肢
    const select = document.getElementById('de-template');
    select.innerHTML = '';
    Object.keys(this.project.templates).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = this.templateLabel(key);
      if (key === this.templateKey) opt.selected = true;
      select.appendChild(opt);
    });
    if (!this.project.templates[this.templateKey]) {
      this.templateKey = Object.keys(this.project.templates)[0];
      select.value = this.templateKey;
    }
    this.applyImportedFonts();
    this.renderAll();
  },

  /** 持ち込みフォントを@font-face適用する (プルダウンには renderProps で反映) */
  applyImportedFonts() {
    const fonts = (this.project.assets && this.project.assets.fonts) || [];
    TelopRenderer.applyFonts(fonts, this.assetBase());
  },

  /** フォントファミリー選択プルダウン (持ち込み/システムフォントをグループ表示、各項目は実フォントでプレビュー) */
  fontFamilySelect(layer) {
    const sel = document.createElement('select');
    sel.className = 'input input--small de-font-select';

    const addOption = (parent, value, label, family) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (family) opt.style.fontFamily = `"${family}"`;
      parent.appendChild(opt);
      return opt;
    };

    const imported = (this.project.assets && this.project.assets.fonts) || [];
    if (imported.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '持ち込み / Webフォント';
      imported.forEach((f) => addOption(group, `"${f.family}"`, f.family, f.family));
      sel.appendChild(group);
    }

    if (this.systemFonts.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '日本語フォント (このPC)';
      this.systemFonts.forEach((name) => addOption(group, `"${name}"`, name, name));
      sel.appendChild(group);
    } else {
      addOption(sel, '"Yu Gothic UI", sans-serif', 'Yu Gothic UI (読込中...)');
    }

    // 現在値が一覧にない場合は先頭に「(現在)」として残す (既存テンプレートを壊さない)
    const current = (layer.font && layer.font.family) || '';
    const values = [...sel.querySelectorAll('option')].map((o) => o.value);
    if (current && !values.includes(current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = `(現在) ${current.replace(/"/g, '')}`;
      opt.style.fontFamily = current;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = current || values[0] || '';

    sel.addEventListener('change', () => {
      this.beginChange();
      layer.font.family = sel.value;
      this.renderArtboard();
      this.renderSelection();
    });
    return sel;
  },

  // ===== Webフォント取得 (Google Fonts) =====

  openGFontDialog() {
    const select = document.getElementById('de-gfont-family');
    if (select.options.length === 0) {
      this.GOOGLE_FONTS.forEach(([family, weights]) => {
        const opt = document.createElement('option');
        opt.value = family;
        opt.textContent = `${family} (${weights.join('/')})`;
        select.appendChild(opt);
      });
    }
    document.getElementById('de-gfont-status').textContent = '';
    document.getElementById('de-gfont-dialog').showModal();
  },

  async fetchGoogleFont() {
    const family = document.getElementById('de-gfont-family').value;
    const entry = this.GOOGLE_FONTS.find(([f]) => f === family);
    const weights = entry ? entry[1] : [400, 700];
    const fetchBtn = document.getElementById('de-gfont-fetch');
    const statusEl = document.getElementById('de-gfont-status');

    fetchBtn.disabled = true;
    statusEl.textContent = 'ダウンロード中... (数十秒かかる場合があります)';
    const result = await window.api.graphicsFetchGoogleFont(family, weights);
    fetchBtn.disabled = false;

    if (!result.ok) {
      statusEl.textContent = `取得エラー: ${result.error}`;
      return;
    }

    this.beginChange();
    this.project.assets = this.project.assets || { images: [], fonts: [] };
    this.project.assets.fonts = this.project.assets.fonts || [];
    // 同名ファミリーは差し替え
    this.project.assets.fonts = this.project.assets.fonts.filter((f) => f.family !== family);
    this.project.assets.fonts.push({ family: result.family, cssFile: result.cssFile, files: result.files });
    this.applyImportedFonts();
    this.renderProps();
    document.getElementById('de-gfont-dialog').close();
    App.setStatus(`Webフォント「${family}」を取り込みました (${result.files.length}ファイル)。保存で出力にも反映されます`, 'success');
  },

  async addFont() {
    const result = await window.api.graphicsImportFont();
    if (!result) return;
    if (!result.ok) {
      App.setStatus(`フォント取り込みエラー: ${result.error}`, 'error');
      return;
    }
    this.beginChange();
    this.project.assets = this.project.assets || { images: [], fonts: [] };
    this.project.assets.fonts = this.project.assets.fonts || [];
    this.project.assets.fonts.push({ family: result.family, file: result.file });
    this.applyImportedFonts();
    this.renderArtboard();
    App.setStatus(`フォント「${result.family}」を追加しました。テキストのファミリー欄で選択できます (保存で出力にも反映)`, 'success');
  },

  async exportDesign() {
    // 未保存の変更も含めて書き出すため、先に保存する
    await this.save();
    const result = await window.api.graphicsExportDesign();
    if (!result) return;
    if (result.ok) {
      App.setStatus(`デザインをエクスポートしました: ${result.filePath}`, 'success');
    } else {
      App.setStatus(`エクスポートエラー: ${result.error}`, 'error');
    }
  },

  async importDesign() {
    if (!confirm('デザインファイルを読み込みます。現在のテンプレート・素材は置き換えられます。よろしいですか?')) return;
    const result = await window.api.graphicsImportDesign();
    if (!result) return;
    if (result.ok) {
      this.clearSelection();
      await this.loadProject();
      App.setStatus('デザインをインポートし、出力へ反映しました', 'success');
    } else {
      App.setStatus(`インポートエラー: ${result.error}`, 'error');
    }
  },

  // ===== Canvas描画 (PNG書き出し / セットサムネイル) =====

  /** 現在のテンプレート(サンプル値)をCanvasに描画する。scale=1で1920x1080 */
  async renderToCanvas(scale) {
    return this.renderVariantToCanvas(this.variant(), null, scale);
  },

  /** 任意のバリアント+値をCanvasに描画する (送出タブのページサムネイル等) */
  async renderVariantToCanvas(variant, values, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(this.CANVAS_W * scale));
    canvas.height = Math.max(1, Math.round(this.CANVAS_H * scale));
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    const hiddenGroups = new Set(((variant && variant.groups) || []).filter((g) => g.visible === false).map((g) => g.id));
    for (const layer of (variant && variant.layers) || []) {
      if (layer.visible === false || (layer.groupId && hiddenGroups.has(layer.groupId))) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
      if (layer.rotation) {
        const cx = layer.x + layer.w / 2;
        const cy = layer.y + layer.h / 2;
        ctx.translate(cx, cy);
        ctx.rotate((layer.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }
      if (layer.type === 'rect') this.drawRectLayer(ctx, layer);
      else if (layer.type === 'image') await this.drawImageLayer(ctx, layer);
      else if (layer.type === 'text') this.drawTextLayer(ctx, layer, values);
      ctx.restore();
    }
    return canvas;
  },

  canvasGradient(ctx, fill, x, y, w, h) {
    // CSS linear-gradientの角度 (0deg=上向き, 180deg=下向き) をCanvasの線分へ変換
    const ang = ((fill.angle !== undefined ? fill.angle : 180) * Math.PI) / 180;
    const dx = Math.sin(ang);
    const dy = -Math.cos(ang);
    const L = (Math.abs(w * dx) + Math.abs(h * dy)) / 2 || 1;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const g = ctx.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
    g.addColorStop(0, fill.from || '#ffffff');
    g.addColorStop(1, fill.to || '#000000');
    return g;
  },

  drawRectLayer(ctx, layer) {
    const fill = layer.fill || {};
    const isPoly = layer.shape === 'polygon' || layer.shape === 'star' || layer.shape === 'polycustom';
    ctx.beginPath();
    if (layer.shape === 'ellipse') {
      ctx.ellipse(layer.x + layer.w / 2, layer.y + layer.h / 2, layer.w / 2, layer.h / 2, 0, 0, Math.PI * 2);
    } else if (isPoly) {
      TelopRenderer.shapePoints(layer).forEach(([px, py], i) => {
        const x = layer.x + px * layer.w;
        const y = layer.y + py * layer.h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
    } else {
      const r = Array.isArray(layer.radii) ? layer.radii : (layer.radius || 0);
      ctx.roundRect(layer.x, layer.y, layer.w, layer.h, r);
    }
    // 塗り (ドロップシャドウは矩形/楕円のみ。パスは保持されるので枠線は影なしで描く)
    ctx.save();
    if (layer.boxShadow && !isPoly) {
      const s = layer.boxShadow;
      ctx.shadowColor = s.color || 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = s.blur || 0;
      ctx.shadowOffsetX = s.x || 0;
      ctx.shadowOffsetY = s.y || 0;
    }
    ctx.fillStyle = fill.type === 'gradient'
      ? this.canvasGradient(ctx, fill, layer.x, layer.y, layer.w, layer.h)
      : (fill.color || '#000000');
    ctx.fill();
    ctx.restore();
    if (layer.border && layer.border.width) {
      ctx.lineWidth = layer.border.width;
      ctx.strokeStyle = layer.border.color || '#ffffff';
      ctx.stroke();
    }
  },

  /** ルビ記法 【文字|よみ】 を [{text, ruby?}] のトークン列にする */
  parseRubyTokens(line) {
    const tokens = [];
    const parts = line.split(/【([^【】|]+)\|([^【】]+)】/g);
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i]) tokens.push({ text: parts[i] });
      if (i + 2 < parts.length) tokens.push({ text: parts[i + 1], ruby: parts[i + 2] });
    }
    return tokens;
  },

  drawImageLayer(ctx, layer) {
    return new Promise((resolve) => {
      if (!layer.file) { resolve(); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous'; // サーバがCORS許可を返すのでCanvasを汚染しない
      img.onload = () => {
        const fit = layer.objectFit || 'fill';
        let sx = 0; let sy = 0; let sw = img.width; let sh = img.height;
        let dx = layer.x; let dy = layer.y; let dw = layer.w; let dh = layer.h;
        if (fit === 'contain') {
          const scale = Math.min(layer.w / img.width, layer.h / img.height);
          dw = img.width * scale; dh = img.height * scale;
          dx = layer.x + (layer.w - dw) / 2; dy = layer.y + (layer.h - dh) / 2;
        } else if (fit === 'cover') {
          const scale = Math.max(layer.w / img.width, layer.h / img.height);
          sw = layer.w / scale; sh = layer.h / scale;
          sx = (img.width - sw) / 2; sy = (img.height - sh) / 2;
        }
        try { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); } catch (_) { /* ignore */ }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = this.assetBase() + encodeURIComponent(layer.file);
    });
  },

  drawTextLayer(ctx, layer, boundValues) {
    if (layer.vertical) {
      this.drawVerticalTextLayer(ctx, layer, boundValues);
      return;
    }
    const font = layer.font || {};
    let size = font.size || 30;
    const family = font.family || 'sans-serif';
    const weight = font.weight || 700;
    const italic = font.italic ? 'italic ' : '';
    const lineHFactor = font.lineHeight || 1.25;
    let ls = font.letterSpacing || 0;
    const mSx = font.scaleX !== undefined ? font.scaleX : 1;
    const mSy = font.scaleY !== undefined ? font.scaleY : 1;
    const skewTan = font.skewX ? Math.tan((font.skewX * Math.PI) / 180) : 0;
    const value = layer.binding
      ? ((boundValues && boundValues[layer.binding]) || (boundValues ? '' : layer.sample) || '')
      : (layer.text || layer.sample || '');
    if (!value) return;
    const tokenLines = String(value).split('\n').map((l) => this.parseRubyTokens(l));
    const lines = tokenLines.map((ts) => ts.map((t) => t.text).join(''));
    const align = layer.align || 'left';
    const justify = align === 'justify';

    const setFont = (s) => {
      ctx.font = `${italic}${weight} ${s}px ${family}`;
      ctx.letterSpacing = `${ls * s}px`;
    };
    setFont(size);
    let widths = lines.map((l) => ctx.measureText(l).width);
    let blockW = Math.max(1, ...widths);
    let lineH = size * lineHFactor;
    let blockH = lines.length * lineH;

    // 自動調整 (DOM版fitTextと同等: tracking=字詰め / condense=長体 / shrink=縮小。変体率込みで判定)
    let sxScale = 1;
    if (!justify && layer.autoFit === 'tracking') {
      const trackMax = font.trackMax !== undefined ? font.trackMax : 0.35;
      const trackMin = font.trackMin !== undefined ? font.trackMin : -0.08;
      const idx = widths.indexOf(Math.max(...widths));
      const n = Math.max(1, [...(lines[idx] || '')].length);
      const availUn = layer.w / mSx;
      const gapEm = (availUn - blockW) / n / size; // 末尾にも字間が付く前提で n で割る
      const eff = gapEm > 0
        ? Math.min(ls + gapEm, Math.max(ls, trackMax)) // 短文: 上限つきで広げる
        : Math.max(trackMin, ls + gapEm); // 長文: 下限まで詰める
      if (eff !== ls) {
        ls = eff;
        setFont(size);
        widths = lines.map((l) => ctx.measureText(l).width);
        blockW = Math.max(1, ...widths);
      }
      if (blockW * mSx > layer.w) sxScale = layer.w / (blockW * mSx); // まだ溢れたら長体
    } else if (!justify && layer.autoFit === 'condense' && blockW * mSx > layer.w) {
      sxScale = layer.w / (blockW * mSx);
    } else if (!justify && layer.autoFit === 'shrink') {
      const ratio = Math.min(1, layer.w / (blockW * mSx), layer.h / (blockH * mSy));
      if (ratio < 1) {
        size = Math.max(8, Math.floor(size * ratio));
        setFont(size);
        widths = lines.map((l) => ctx.measureText(l).width);
        blockW = Math.max(1, ...widths);
        lineH = size * lineHFactor;
        blockH = lines.length * lineH;
      }
    }

    const b = layer.board && layer.board.enabled ? layer.board : null;
    const padX = b && b.mode !== 'fixed' ? (b.padX !== undefined ? b.padX : 18) : 0;
    const padY = b && b.mode !== 'fixed' ? (b.padY !== undefined ? b.padY : 6) : 0;
    const totalSx = mSx * sxScale;
    if (justify) blockW = Math.max(1, (layer.w - padX * 2) / totalSx);
    const boxW = justify ? layer.w : blockW * totalSx + padX * 2;
    const boxH = blockH + padY * 2;
    const vAlign = layer.vAlign || 'middle';
    const boxX = align === 'center' ? layer.x + (layer.w - boxW) / 2
      : align === 'right' ? layer.x + layer.w - boxW : layer.x;
    const boxY = vAlign === 'middle' ? layer.y + (layer.h - boxH) / 2
      : vAlign === 'bottom' ? layer.y + layer.h - boxH : layer.y;

    // 座布団
    if (b) {
      const bx = b.mode === 'fixed' ? layer.x : boxX;
      const by = b.mode === 'fixed' ? layer.y : boxY;
      const bw = b.mode === 'fixed' ? layer.w : boxW;
      const bh = b.mode === 'fixed' ? layer.h : boxH;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, b.radius || 0);
      ctx.fillStyle = b.fill && b.fill.type === 'gradient'
        ? this.canvasGradient(ctx, b.fill, bx, by, bw, bh)
        : ((b.fill && b.fill.color) || b.color || '#0d6ab7');
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(boxX + padX, boxY + padY);
    // 変体率・長体・歪みをDOMのtransform-origin (揃え基準×垂直中央) と同様に適用
    if (totalSx !== 1 || mSy !== 1 || skewTan) {
      const originX = align === 'center' ? blockW / 2 : align === 'right' ? blockW : 0;
      ctx.translate(originX, blockH / 2);
      ctx.transform(1, 0, -skewTan, 1, 0, 0);
      ctx.scale(totalSx, mSy);
      ctx.translate(-originX, -blockH / 2);
    }
    ctx.textBaseline = 'middle';

    const lineX = (i) => (align === 'center' ? (blockW - widths[i]) / 2
      : align === 'right' ? blockW - widths[i] : 0);
    const drawLine = (line, i, dx, dy) => {
      const y = lineH * (i + 0.5) + dy;
      if (justify) {
        const chars = [...line];
        if (chars.length <= 1) { ctx.fillText(line, dx, y); return; }
        const extra = (blockW - widths[i]) / (chars.length - 1);
        let x = dx;
        chars.forEach((ch) => {
          ctx.fillText(ch, x, y);
          x += ctx.measureText(ch).width + extra;
        });
      } else {
        ctx.fillText(line, lineX(i) + dx, y);
      }
    };
    const drawLines = (fillStyle, dx = 0, dy = 0) => {
      ctx.fillStyle = fillStyle;
      lines.forEach((line, i) => drawLine(line, i, dx, dy));
    };

    // 1) ドロップシャドウ (最背面)
    if (layer.shadow) {
      const s = layer.shadow;
      let dx = s.x || 0;
      let dy = s.y || 0;
      if (s.distance !== undefined) {
        const rad = ((s.angle !== undefined ? s.angle : 45) * Math.PI) / 180;
        dx = Math.cos(rad) * s.distance;
        dy = Math.sin(rad) * s.distance;
      }
      ctx.save();
      ctx.shadowColor = s.color || 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = s.blur || 0;
      ctx.shadowOffsetX = dx;
      ctx.shadowOffsetY = dy;
      drawLines(font.color || '#ffffff');
      ctx.restore();
    }

    // 2) 縁取り (外側の層から塗り重ねる → 内側の層が上に乗る)
    const strokes = Array.isArray(layer.strokes)
      ? layer.strokes.filter((s) => s && s.width > 0)
      : (layer.stroke && layer.stroke.width > 0 ? [layer.stroke] : []);
    TelopRenderer.edgeOffsets(strokes).reverse().forEach((o) => {
      drawLines(o.color, o.x, o.y);
    });

    // 3) 本体 (単色 / グラデーション)
    const grad = layer.fill && layer.fill.type === 'gradient' ? layer.fill : null;
    const bodyFill = grad ? this.canvasGradient(ctx, grad, 0, 0, blockW, blockH) : (font.color || '#ffffff');
    drawLines(bodyFill);

    // 4) ルビ (本体の上に小さく描画。均等割付時は省略)
    if (!justify && tokenLines.some((ts) => ts.some((t) => t.ruby))) {
      ctx.save();
      ctx.textAlign = 'center';
      tokenLines.forEach((tokens, i) => {
        let x = lineX(i);
        const y = lineH * (i + 0.5);
        tokens.forEach((t) => {
          setFont(size);
          const w = ctx.measureText(t.text).width;
          if (t.ruby) {
            setFont(size * 0.4);
            ctx.fillStyle = typeof bodyFill === 'string' ? bodyFill : ((grad && grad.from) || '#ffffff');
            ctx.fillText(t.ruby, x + w / 2, y - size * 0.72);
          }
          x += w;
        });
      });
      setFont(size);
      ctx.restore();
    }
    ctx.restore();
  },

  /** 縦書きテキストのCanvas描画 (PNG/サムネイル用の近似描画) */
  drawVerticalTextLayer(ctx, layer, boundValues) {
    const font = layer.font || {};
    let size = font.size || 30;
    const family = font.family || 'sans-serif';
    const weight = font.weight || 700;
    const italic = font.italic ? 'italic ' : '';
    const lineHFactor = font.lineHeight || 1.25;
    let ls = font.letterSpacing || 0;
    const mSx = font.scaleX !== undefined ? font.scaleX : 1;
    const mSy = font.scaleY !== undefined ? font.scaleY : 1;
    const value = layer.binding
      ? ((boundValues && boundValues[layer.binding]) || (boundValues ? '' : layer.sample) || '')
      : (layer.text || layer.sample || '');
    if (!value) return;
    const tcyOn = layer.tcy !== false;

    // 列 (改行区切り) → ユニット列 (1文字 or 縦中横の数字グループ)
    const unitsOf = (line) => {
      const stripped = line.replace(/【([^【】|]+)\|([^【】]+)】/g, '$1'); // ルビはbaseのみ
      const units = [];
      stripped.split(/(\d+)/).forEach((seg) => {
        if (!seg) return;
        if (tcyOn && /^\d{1,3}$/.test(seg)) units.push({ text: seg, tcy: true });
        else [...seg].forEach((ch) => units.push({ text: ch }));
      });
      return units;
    };
    const cols = String(value).split('\n').map(unitsOf);
    const setFont = (s) => { ctx.font = `${italic}${weight} ${s}px ${family}`; ctx.letterSpacing = '0px'; };
    setFont(size);

    let advance = size * (1 + ls);
    let colW = size * lineHFactor;
    let blockH = Math.max(1, ...cols.map((c) => c.length)) * advance;
    let blockW = cols.length * colW;

    // 自動調整 (縦書きは縦方向が進行方向)
    let syScale = 1;
    if (layer.autoFit === 'tracking') {
      const trackMax = font.trackMax !== undefined ? font.trackMax : 0.35;
      const trackMin = font.trackMin !== undefined ? font.trackMin : -0.08;
      const n = Math.max(1, ...cols.map((c) => c.length));
      const availUn = layer.h / mSy;
      const gapEm = (availUn - blockH) / n / size;
      const eff = gapEm > 0
        ? Math.min(ls + gapEm, Math.max(ls, trackMax)) // 短文: 上限つきで広げる
        : Math.max(trackMin, ls + gapEm); // 長文: 下限まで詰める
      if (eff !== ls) {
        ls = eff;
        advance = size * (1 + ls);
        blockH = Math.max(1, ...cols.map((c) => c.length)) * advance;
      }
      if (blockH * mSy > layer.h) syScale = layer.h / (blockH * mSy); // まだ溢れたら長体(縦)
    } else if (layer.autoFit === 'condense' && blockH * mSy > layer.h) {
      syScale = layer.h / (blockH * mSy);
    } else if (layer.autoFit === 'shrink') {
      const ratio = Math.min(1, layer.h / (blockH * mSy), layer.w / (blockW * mSx));
      if (ratio < 1) {
        size = Math.max(8, Math.floor(size * ratio));
        setFont(size);
        advance = size * (1 + ls);
        colW = size * lineHFactor;
        blockH = Math.max(1, ...cols.map((c) => c.length)) * advance;
        blockW = cols.length * colW;
      }
    }

    const b = layer.board && layer.board.enabled ? layer.board : null;
    const padX = b && b.mode !== 'fixed' ? (b.padX !== undefined ? b.padX : 18) : 0;
    const padY = b && b.mode !== 'fixed' ? (b.padY !== undefined ? b.padY : 6) : 0;
    const totalSy = mSy * syScale;
    const boxW = blockW * mSx + padX * 2;
    const boxH = blockH * totalSy + padY * 2;
    // 縦書きのflex論理方向: align=縦位置 / vAlign=横位置 (start=右)
    const align = layer.align || 'left';
    const vAlign = layer.vAlign || 'middle';
    const boxY = align === 'center' ? layer.y + (layer.h - boxH) / 2
      : align === 'right' ? layer.y + layer.h - boxH : layer.y;
    const boxX = vAlign === 'middle' ? layer.x + (layer.w - boxW) / 2
      : vAlign === 'bottom' ? layer.x : layer.x + layer.w - boxW;

    if (b) {
      const bx = b.mode === 'fixed' ? layer.x : boxX;
      const by = b.mode === 'fixed' ? layer.y : boxY;
      const bw = b.mode === 'fixed' ? layer.w : boxW;
      const bh = b.mode === 'fixed' ? layer.h : boxH;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, b.radius || 0);
      ctx.fillStyle = b.fill && b.fill.type === 'gradient'
        ? this.canvasGradient(ctx, b.fill, bx, by, bw, bh)
        : ((b.fill && b.fill.color) || b.color || '#0d6ab7');
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(boxX + padX, boxY + padY);
    ctx.scale(mSx, totalSy);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    const drawUnits = (fillStyle, dx = 0, dy = 0) => {
      ctx.fillStyle = fillStyle;
      cols.forEach((units, ci) => {
        const cx = blockW - colW * (ci + 0.5); // 右の列から
        units.forEach((u, ui) => {
          const y = advance * (ui + 0.5);
          if (u.tcy && u.text.length > 1) {
            // 縦中横: 列幅に収まるよう横に圧縮して描く
            const w = ctx.measureText(u.text).width;
            const fit = Math.min(1, (colW * 0.95) / w);
            ctx.save();
            ctx.translate(cx + dx, y + dy);
            ctx.scale(fit, 1);
            ctx.fillText(u.text, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(u.text, cx + dx, y + dy);
          }
        });
      });
    };

    if (layer.shadow) {
      const s = layer.shadow;
      let dx = s.x || 0;
      let dy = s.y || 0;
      if (s.distance !== undefined) {
        const rad = ((s.angle !== undefined ? s.angle : 45) * Math.PI) / 180;
        dx = Math.cos(rad) * s.distance;
        dy = Math.sin(rad) * s.distance;
      }
      ctx.save();
      ctx.shadowColor = s.color || 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = s.blur || 0;
      ctx.shadowOffsetX = dx;
      ctx.shadowOffsetY = dy;
      drawUnits(font.color || '#ffffff');
      ctx.restore();
    }
    const strokes = Array.isArray(layer.strokes)
      ? layer.strokes.filter((s) => s && s.width > 0)
      : (layer.stroke && layer.stroke.width > 0 ? [layer.stroke] : []);
    TelopRenderer.edgeOffsets(strokes).reverse().forEach((o) => {
      drawUnits(o.color, o.x, o.y);
    });
    const grad = layer.fill && layer.fill.type === 'gradient' ? layer.fill : null;
    drawUnits(grad ? this.canvasGradient(ctx, grad, 0, 0, blockW, blockH) : (font.color || '#ffffff'));
    ctx.restore();
  },

  async exportPng() {
    try {
      const canvas = await this.renderToCanvas(1);
      const dataUrl = canvas.toDataURL('image/png');
      const result = await window.api.graphicsExportPng(dataUrl, `${this.templateKey}-${this.lang}.png`);
      if (!result) return;
      if (result.ok) {
        App.setStatus(`PNGを書き出しました: ${result.filePath}`, 'success');
      } else {
        App.setStatus(`PNG書き出しエラー: ${result.error}`, 'error');
      }
    } catch (err) {
      App.setStatus(`PNG書き出しエラー: ${err.message}`, 'error');
    }
  },

  /** アクティブセットのサムネイルを更新する (保存成功時) */
  async updateSetThumb() {
    if (!window.api.graphicsSaveSetThumb) return;
    try {
      const canvas = await this.renderToCanvas(320 / this.CANVAS_W);
      await window.api.graphicsSaveSetThumb(canvas.toDataURL('image/png'));
    } catch (_) { /* サムネイル生成失敗は保存を妨げない */ }
  },

  // ===== デザインセットのサムネイル一覧 =====

  async openSetGallery() {
    await this.refreshSets();
    const thumbs = window.api.graphicsGetSetThumbs ? await window.api.graphicsGetSetThumbs() : {};
    const grid = document.getElementById('de-set-grid');
    grid.innerHTML = '';
    this.sets.sets.forEach((s) => {
      const card = document.createElement('div');
      card.className = `de-set-card${s.active ? ' active' : ''}`;
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'de-set-thumb';
      if (thumbs[s.id]) {
        const img = document.createElement('img');
        img.src = thumbs[s.id];
        thumbWrap.appendChild(img);
      } else {
        thumbWrap.textContent = 'サムネイル未生成 (保存すると作成されます)';
      }
      const nameEl = document.createElement('div');
      nameEl.className = 'de-set-card-name';
      nameEl.textContent = s.name + (s.active ? ' — 使用中' : '');
      card.appendChild(thumbWrap);
      card.appendChild(nameEl);
      card.addEventListener('click', async () => {
        document.getElementById('de-set-gallery').close();
        if (!s.active) await this.switchSet(s.id);
      });
      grid.appendChild(card);
    });
    document.getElementById('de-set-gallery').showModal();
  },

  // ===== フォント一括置換 =====

  usedFontFamilies() {
    const used = new Set();
    Object.values(this.project.templates).forEach((t) => {
      Object.values(t.variants).forEach((v) => {
        (v.layers || []).forEach((l) => {
          if (l.type === 'text' && l.font && l.font.family) used.add(l.font.family);
        });
      });
    });
    return [...used];
  },

  openFontReplaceDialog() {
    const from = document.getElementById('de-fr-from');
    from.innerHTML = '';
    this.usedFontFamilies().forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.replace(/"/g, '');
      opt.style.fontFamily = f;
      from.appendChild(opt);
    });

    const to = document.getElementById('de-fr-to');
    to.innerHTML = '';
    const addOption = (parent, value, label, previewFamily) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (previewFamily) opt.style.fontFamily = `"${previewFamily}"`;
      parent.appendChild(opt);
    };
    const imported = (this.project.assets && this.project.assets.fonts) || [];
    if (imported.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '持ち込み / Webフォント';
      imported.forEach((f) => addOption(group, `"${f.family}"`, f.family, f.family));
      to.appendChild(group);
    }
    if (this.systemFonts.length > 0) {
      const group = document.createElement('optgroup');
      group.label = '日本語フォント (このPC)';
      this.systemFonts.forEach((name) => addOption(group, `"${name}"`, name, name));
      to.appendChild(group);
    }
    document.getElementById('de-font-replace-dialog').showModal();
  },

  submitFontReplace() {
    const from = document.getElementById('de-fr-from').value;
    const to = document.getElementById('de-fr-to').value;
    document.getElementById('de-font-replace-dialog').close();
    if (!from || !to || from === to) return;
    this.beginChange();
    let count = 0;
    Object.values(this.project.templates).forEach((t) => {
      Object.values(t.variants).forEach((v) => {
        (v.layers || []).forEach((l) => {
          if (l.type === 'text' && l.font && l.font.family === from) {
            l.font.family = to;
            count += 1;
          }
        });
      });
    });
    this.renderAll();
    App.setStatus(`フォントを一括置換しました (${count}レイヤー)。保存で出力にも反映されます`, 'success');
  },

  // ===== スタイルパレット (装飾プリセット・全セット共通) =====

  stylePresets: [],

  async refreshStylePresets() {
    if (!window.api.graphicsStylePresets) return;
    try {
      this.stylePresets = await window.api.graphicsStylePresets();
    } catch (_) { this.stylePresets = []; }
  },

  /** レイヤーの装飾関連プロパティを抜き出す (コピー/プリセット共用) */
  captureStyle(layer) {
    return JSON.parse(JSON.stringify({
      font: layer.font || {},
      fill: layer.fill || null,
      strokes: layer.strokes || [],
      shadow: layer.shadow || null,
      board: layer.board || null,
    }));
  },

  applyStyle(layer, style) {
    const clip = JSON.parse(JSON.stringify(style));
    layer.font = Object.assign({}, layer.font, clip.font);
    layer.fill = clip.fill;
    layer.strokes = clip.strokes;
    layer.shadow = clip.shadow;
    layer.board = clip.board;
  },

  // ===== モデルアクセス =====

  variant() {
    return this.project.templates[this.templateKey].variants[this.lang];
  },

  layers() {
    return this.variant().layers;
  },

  selected() {
    return this.layers().find((l) => l.id === this.selectedId) || null;
  },

  // ===== グループ (layer.groupId で束ねる。バリアントの groups に名前・表示・ロック・折りたたみを保持) =====

  /** 選択中のグループID (レイヤー単体選択 selectedId が無いときのみ有効) */
  selectedGroupId: null,
  /** 複数選択中のレイヤーID (selectedId を含むときのみ有効) */
  selectedIds: [],
  /** 複数選択中のグループID (2個以上のグループをShift選択したときのみ使う。selectedGroupIdとは排他) */
  selectedGroupIds: [],

  groups() {
    const v = this.variant();
    if (!Array.isArray(v.groups)) v.groups = [];
    return v.groups;
  },

  groupById(id) {
    return id ? this.groups().find((g) => g.id === id) || null : null;
  },

  groupMembers(gid) {
    return this.layers().filter((l) => l.groupId === gid);
  },

  /** 表示判定 (レイヤー自身 + 所属グループ) */
  isShown(layer) {
    const g = this.groupById(layer.groupId);
    return layer.visible !== false && !(g && g.visible === false);
  },

  isLocked(layer) {
    const g = this.groupById(layer.groupId);
    return !!layer.locked || !!(g && g.locked);
  },

  activeGroup() {
    if (this.selectedId) return null;
    return this.groupById(this.selectedGroupId);
  },

  multiSelected() {
    if (!this.selectedId || this.selectedIds.length < 2 || !this.selectedIds.includes(this.selectedId)) return [];
    const ids = new Set(this.selectedIds);
    return this.layers().filter((l) => ids.has(l.id));
  },

  /** Shiftで2個以上選択中のグループ一覧 (selectedId/selectedGroupIdが無いときのみ有効) */
  multiGroups() {
    if (this.selectedId || this.selectedGroupIds.length < 2) return [];
    return this.selectedGroupIds.map((id) => this.groupById(id)).filter(Boolean);
  },

  /** グループをShift選択の多重選択に追加/解除する (単体のグループ選択中にShiftで別グループを押した場合も合流させる) */
  toggleGroupInMultiSelect(gid) {
    const current = new Set(this.selectedGroupIds.length ? this.selectedGroupIds : (this.selectedGroupId ? [this.selectedGroupId] : []));
    if (current.has(gid)) current.delete(gid); else current.add(gid);
    this.selectedId = null;
    this.selectedIds = [];
    if (current.size <= 1) {
      // 1個だけになったら単体のグループ選択に戻す (グループ名編集などの専用UIを使えるように)
      this.selectedGroupId = current.size ? [...current][0] : null;
      this.selectedGroupIds = [];
    } else {
      this.selectedGroupId = null;
      this.selectedGroupIds = [...current];
    }
  },

  /** 操作対象のレイヤー群 (複数グループ / グループ / 複数選択 / 単体) */
  targets() {
    const mg = this.multiGroups();
    if (mg.length) return mg.flatMap((g) => this.groupMembers(g.id));
    const g = this.activeGroup();
    if (g) return this.groupMembers(g.id);
    const multi = this.multiSelected();
    if (multi.length) return multi;
    const one = this.selected();
    return one ? [one] : [];
  },

  clearSelection() {
    this.selectedId = null;
    this.selectedGroupId = null;
    this.selectedGroupIds = [];
    this.selectedIds = [];
  },

  /** レイヤーを選択 (additive=true で複数選択に追加/解除) */
  selectLayer(id, additive) {
    if (additive) {
      const base = this.activeGroup() ? this.groupMembers(this.selectedGroupId).map((l) => l.id)
        : (this.multiSelected().length ? [...this.selectedIds] : (this.selectedId ? [this.selectedId] : []));
      const set = new Set(base);
      if (set.has(id)) set.delete(id); else set.add(id);
      this.selectedIds = [...set];
      this.selectedGroupId = null;
      this.selectedId = set.has(id) ? id : (this.selectedIds[this.selectedIds.length - 1] || null);
    } else {
      this.selectedId = id;
      this.selectedIds = id ? [id] : [];
      this.selectedGroupId = null;
    }
  },

  selectGroup(gid) {
    this.selectedId = null;
    this.selectedIds = [];
    this.selectedGroupId = gid;
  },

  refreshSelectionUI() {
    this.renderLayerList();
    this.renderProps();
    this.renderSelection();
  },

  /** 対象群の外接矩形 */
  boundsOf(layers) {
    const x = Math.min(...layers.map((l) => l.x));
    const y = Math.min(...layers.map((l) => l.y));
    const r = Math.max(...layers.map((l) => l.x + l.w));
    const b = Math.max(...layers.map((l) => l.y + l.h));
    return { x, y, w: r - x, h: b - y };
  },

  /** 空のグループを削除し、グループの並びを連続させる (重ね順は各グループの最前面メンバーの位置) */
  normalizeGroups() {
    const v = this.variant();
    const layers = v.layers;
    const ids = new Set(this.groups().map((g) => g.id));
    layers.forEach((l) => { if (l.groupId && !ids.has(l.groupId)) delete l.groupId; });
    v.groups = this.groups().filter((g) => layers.some((l) => l.groupId === g.id));
    // 連続化: 前面側から走査し、グループは最初に現れた位置へまとめる
    const out = [];
    const placed = new Set();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.groupId) { out.unshift(l); continue; }
      if (placed.has(l.groupId)) continue;
      placed.add(l.groupId);
      out.unshift(...layers.filter((m) => m.groupId === l.groupId));
    }
    layers.splice(0, layers.length, ...out);
  },

  /** 選択中のレイヤーをグループ化 (Ctrl+G) */
  groupSelection() {
    const members = this.targets();
    if (!members.length) return;
    if (this.activeGroup() && members.length === this.groupMembers(this.selectedGroupId).length) return;
    this.beginChange();
    const layers = this.layers();
    const topIdx = Math.max(...members.map((l) => layers.indexOf(l)));
    const n = this.groups().length + 1;
    let gid = `g${Date.now().toString(36)}`;
    while (this.groupById(gid)) gid += 'x';
    this.groups().push({ id: gid, name: `グループ ${n}`, visible: true, locked: false, collapsed: false });
    // メンバーを抜き出し、最前面メンバーの位置へまとめて挿入
    const set = new Set(members);
    const anchor = layers.slice(topIdx + 1).find((l) => !set.has(l)) || null;
    const rest = layers.filter((l) => !set.has(l));
    members.forEach((l) => { l.groupId = gid; });
    const at = anchor ? rest.indexOf(anchor) : rest.length;
    rest.splice(at, 0, ...layers.filter((l) => set.has(l)));
    layers.splice(0, layers.length, ...rest);
    this.normalizeGroups();
    this.selectGroup(gid);
    this.renderAll();
    App.setStatus(`${members.length}個のレイヤーをグループ化しました`, 'success');
  },

  /** グループ解除 (Ctrl+Shift+G) — 選択中のグループ、または選択レイヤーの所属グループ */
  ungroupSelection() {
    const g = this.activeGroup() || this.groupById((this.selected() || {}).groupId);
    if (!g) return;
    this.beginChange();
    const members = this.groupMembers(g.id);
    members.forEach((l) => { delete l.groupId; });
    this.variant().groups = this.groups().filter((x) => x.id !== g.id);
    this.selectedIds = members.map((l) => l.id);
    this.selectedId = members.length ? members[members.length - 1].id : null;
    this.selectedGroupId = null;
    this.renderAll();
    App.setStatus(`グループ「${g.name}」を解除しました`, 'success');
  },

  async renameGroup(g) {
    const name = await AppModal.prompt('グループ名', { value: g.name });
    if (!name) return;
    this.beginChange();
    g.name = name;
    this.renderLayerList();
    this.renderProps();
  },

  /** 対象群をまとめて移動 */
  moveTargets(dx, dy) {
    this.targets().forEach((l) => {
      l.x += dx;
      l.y += dy;
      this.updateLayerElement(l);
    });
    this.renderSelection();
    this.renderPropsValues();
  },

  /**
   * 操作対象(複数選択/グループ)の外接矩形の幅/高さを指定値に変更し、各メンバーの
   * 相対位置・サイズをその拡大率で追従させる (外接矩形の左上を基点に拡縮する)。
   * プロパティパネルのW/H数値入力から呼ばれる (ドラッグでのリサイズと同じ拡縮ロジック)。
   */
  scaleTargets(newW, newH) {
    const targets = this.targets();
    if (!targets.length) return;
    const bounds = this.boundsOf(targets);
    const scaleX = bounds.w > 0 && newW > 0 ? newW / bounds.w : 1;
    const scaleY = bounds.h > 0 && newH > 0 ? newH / bounds.h : 1;
    if (scaleX === 1 && scaleY === 1) return;
    targets.forEach((l) => {
      l.x = Math.round(bounds.x + (l.x - bounds.x) * scaleX);
      l.y = Math.round(bounds.y + (l.y - bounds.y) * scaleY);
      l.w = Math.round(Math.max(10, l.w * scaleX));
      l.h = Math.round(Math.max(10, l.h * scaleY));
      if (targets.length > 1 && l.type === 'text' && l.font) {
        const fsx = l.font.scaleX !== undefined ? l.font.scaleX : 1;
        const fsy = l.font.scaleY !== undefined ? l.font.scaleY : 1;
        l.font.scaleX = Math.max(0.1, fsx * scaleX);
        l.font.scaleY = Math.max(0.1, fsy * scaleY);
      }
      this.updateLayerElement(l);
    });
    this.renderSelection();
    this.renderPropsValues();
  },

  region() {
    return this.project.templates[this.templateKey].region;
  },

  /** 使用可能なバインドフィールド一覧 (リージョン既定候補 + テンプレート内で使用中のもの) */
  bindings() {
    let list;
    if (this.region() === 'side') {
      list = ['textJp', 'textEn'];
    } else if (this.region() === 'name') {
      list = [];
      ['', '2nd', '3rd', '4th'].forEach((prefix) => {
        ['Title', 'Name'].forEach((kind) => {
          ['Jp', 'En'].forEach((lng) => {
            list.push(prefix ? `${prefix}${kind}${lng}` : `${kind.toLowerCase()}${lng}`);
          });
        });
      });
    } else {
      // カスタムチャンネル: 汎用フィールド候補
      list = ['textJp', 'textEn', 'text2Jp', 'text2En', 'text3Jp', 'text3En'];
    }
    // テンプレート内で実際に使われているbindingを追加
    Object.values(this.project.templates[this.templateKey].variants).forEach((variant) => {
      (variant.layers || []).forEach((layer) => {
        if (layer.type === 'text' && layer.binding && !list.includes(layer.binding)) {
          list.push(layer.binding);
        }
      });
    });
    return list;
  },

  /** 新規バインドのデフォルト変数名 (レイヤー名から生成、既存と衝突しなければそのまま) */
  suggestBindingName(base) {
    const used = new Set(this.bindings());
    const slug = String(base || '').replace(/[^a-zA-Z0-9_]/g, '') || 'field';
    if (!used.has(slug)) return slug;
    let i = 2;
    while (used.has(`${slug}${i}`)) i += 1;
    return `${slug}${i}`;
  },

  /** 利用可能なプール一覧 (送出タブで取込済みのもの。Excelから取込んだ候補リスト) */
  availablePools() {
    return (App.rundown && App.rundown.pools) || {};
  },

  /** 整列ボタンのアイコン (Photoshop風の「ガイド線+バー」) */
  ALIGN_ICON_PATHS: {
    left: '<path d="M4 3v18"/><rect x="6" y="6" width="12" height="4"/><rect x="6" y="14" width="7" height="4"/>',
    hcenter: '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4"/><rect x="8" y="14" width="8" height="4"/>',
    right: '<path d="M20 3v18"/><rect x="6" y="6" width="12" height="4"/><rect x="11" y="14" width="7" height="4"/>',
    top: '<path d="M3 4h18"/><rect x="6" y="6" width="4" height="12"/><rect x="14" y="6" width="4" height="7"/>',
    vcenter: '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14"/><rect x="14" y="8" width="4" height="8"/>',
    bottom: '<path d="M3 20h18"/><rect x="6" y="6" width="4" height="12"/><rect x="14" y="11" width="4" height="7"/>',
  },
  alignIconSvg(kind) {
    const path = this.ALIGN_ICON_PATHS[kind] || '';
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  },

  /** W/H入力の横に置く「縦横比を固定」トグルボタン (南京錠アイコン、押すたびON/OFF) */
  aspectLockBtn(onToggle) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `de-icon-btn de-aspect-lock${this.aspectLocked ? ' active' : ''}`;
    btn.title = this.aspectLocked ? '縦横比を固定中 (クリックで解除)' : '縦横比を固定する (W/H入力に連動)';
    btn.innerHTML = this.aspectLocked
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7-2.6"/></svg>';
    btn.addEventListener('click', () => { this.aspectLocked = !this.aspectLocked; onToggle(); });
    return btn;
  },

  newLayerId() {
    return `ly_${Math.random().toString(36).slice(2, 9)}`;
  },

  // ===== Undo / Redo =====

  beginChange() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.updateStatus();
  },

  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.undoStack.pop());
    this.dirty = true;
    this.afterHistoryJump();
  },

  redo() {
    if (this.redoStack.length === 0) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.redoStack.pop());
    this.dirty = true;
    this.afterHistoryJump();
  },

  afterHistoryJump() {
    if (!this.project.templates[this.templateKey]) {
      this.templateKey = Object.keys(this.project.templates)[0];
    }
    if (!this.selected()) this.selectedId = null;
    if (!this.activeGroup()) this.selectedGroupId = null;
    this.renderAll();
  },

  // ===== 保存 / 再読込 =====

  async save() {
    const result = await window.api.graphicsSaveProject(this.project);
    if (result.ok) {
      this.dirty = false;
      this.updateStatus();
      App.setStatus('デザインを保存し、出力へ反映しました', 'success');
      this.updateSetThumb(); // セット一覧用サムネイルを更新 (非同期・失敗は無視)
      if (typeof RundownUI !== 'undefined' && RundownUI.loaded) RundownUI.refreshTemplates();
    } else {
      App.setStatus(`デザイン保存エラー: ${result.error}`, 'error');
    }
  },

  async reload() {
    if (this.dirty && !confirm('未保存の変更を破棄して再読込しますか?')) return;
    this.clearSelection();
    await this.loadProject();
    App.setStatus('デザインを再読込しました');
  },

  updateStatus() {
    const btn = document.getElementById('de-save');
    btn.textContent = this.dirty ? '● 未保存 — 保存して反映' : '保存して反映';
    btn.classList.toggle('de-save--dirty', this.dirty);
  },

  /** 出力サーバ停止中の警告バナー (画像・持ち込みフォントが表示されないため) */
  updateServerBanner(status) {
    const banner = document.getElementById('de-server-warning');
    if (banner) banner.classList.toggle('hidden', !!(status && status.running));
  },

  // ===== 表示 =====

  setLang(lang) {
    this.lang = lang;
    document.getElementById('de-lang-jp').classList.toggle('active', lang === 'jp');
    document.getElementById('de-lang-en').classList.toggle('active', lang === 'en');
    this.clearSelection();
    this.renderAll();

    // EN初回切替時: JPとは独立したレイアウトであることを案内
    if (lang === 'en' && !this._enHintShown) {
      this._enHintShown = true;
      App.setStatus('ENレイアウトはJPと独立しています。JPのデザインを流用する場合は「JP→ENコピー」を使ってください');
    }
  },

  assetBase() {
    const port = (GraphicsUI.status && GraphicsUI.status.port) || 8790;
    return `http://127.0.0.1:${port}/assets/`;
  },

  applyZoom() {
    const viewport = document.getElementById('de-viewport');
    if (this.zoomMode === 'fit') {
      const w = viewport.clientWidth - 40;
      const h = viewport.clientHeight - 40;
      this.zoom = Math.max(0.1, Math.min(w / this.CANVAS_W, h / this.CANVAS_H));
    } else {
      this.zoom = parseFloat(this.zoomMode);
    }
    const wrap = document.getElementById('de-canvas-wrap');
    wrap.style.width = `${this.CANVAS_W * this.zoom}px`;
    wrap.style.height = `${this.CANVAS_H * this.zoom}px`;
    document.getElementById('de-canvas').style.transform = `scale(${this.zoom})`;
    this.updateOverlayAids();
  },

  /** グリッド/セーフティエリアのオーバーレイ表示を更新 */
  updateOverlayAids() {
    const grid = document.getElementById('de-grid-layer');
    if (grid) {
      grid.classList.toggle('hidden', !(this.gridSize > 0));
      if (this.gridSize > 0) {
        const cell = this.gridSize * this.zoom;
        grid.style.backgroundSize = `${cell}px ${cell}px`;
      }
    }
    const safety98 = document.getElementById('de-safety-box-98');
    if (safety98) safety98.classList.toggle('hidden', !(this.safetyMode === '98' || this.safetyMode === 'both'));
    const safety95 = document.getElementById('de-safety-box-95');
    if (safety95) safety95.classList.toggle('hidden', !(this.safetyMode === '95' || this.safetyMode === 'both'));
  },

  renderAll() {
    if (!this.project) return;
    this.applyZoom();
    this.renderArtboard();
    this.renderLayerList();
    this.renderProps();
    this.renderSelection();
    this.updateStatus();
    this.renderTemplateChrome();
    this.renderStylePanel();
    this.updateServerBanner(typeof GraphicsUI !== 'undefined' ? GraphicsUI.status : null);
  },

  renderArtboard() {
    const canvas = document.getElementById('de-canvas');
    TelopRenderer.renderVariant(canvas, this.variant(), {}, {
      useSample: true,
      assetBase: this.assetBase(),
    });
  },

  /** レイヤーパネル (上=前面)。グループはフォルダ行 + インデントしたメンバー */
  renderLayerList() {
    const list = document.getElementById('de-layer-list');
    list.innerHTML = '';
    const layers = this.layers();
    const multi = new Set(this.multiSelected().map((l) => l.id));
    const activeGroup = this.activeGroup();
    const multiGroupIds = new Set(this.multiGroups().map((g) => g.id));
    const renderedGroups = new Set();

    const toggleBtn = (on, onLabel, offLabel, onTitle, offTitle, handler) => {
      const b = document.createElement('button');
      b.className = `de-layer-toggle${on ? '' : ' de-layer-toggle--off'}`;
      b.textContent = on ? onLabel : offLabel;
      b.title = on ? onTitle : offTitle;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.beginChange(); handler(); this.renderAll(); });
      return b;
    };

    // レイヤー/グループ行のドラッグ&ドロップ並べ替え (重ね順)
    const attachDrag = (el, key) => {
      el.draggable = true;
      el.addEventListener('dragstart', (e) => {
        this._dragKey = key;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });
      el.addEventListener('dragend', () => {
        el.classList.remove('dragging');
        list.querySelectorAll('.drag-over-above, .drag-over-below').forEach((n) => n.classList.remove('drag-over-above', 'drag-over-below'));
        this._dragKey = null;
      });
      el.addEventListener('dragover', (e) => {
        if (!this._dragKey) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        list.querySelectorAll('.drag-over-above, .drag-over-below').forEach((n) => n.classList.remove('drag-over-above', 'drag-over-below'));
        el.classList.add(above ? 'drag-over-above' : 'drag-over-below');
      });
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const above = el.classList.contains('drag-over-above');
        el.classList.remove('drag-over-above', 'drag-over-below');
        if (this._dragKey) this.dropReorder(this._dragKey, key, above);
        this._dragKey = null;
      });
    };

    [...layers].reverse().forEach((layer) => {
      const g = this.groupById(layer.groupId);
      if (g && !renderedGroups.has(g.id)) {
        renderedGroups.add(g.id);
        const gi = document.createElement('li');
        gi.className = 'de-layer-item de-layer-group';
        gi.classList.toggle('selected', (!!activeGroup && activeGroup.id === g.id) || multiGroupIds.has(g.id));
        const caret = document.createElement('button');
        caret.className = 'de-layer-caret';
        caret.textContent = g.collapsed ? '▸' : '▾';
        caret.title = g.collapsed ? '展開' : '折りたたむ';
        caret.addEventListener('click', (e) => { e.stopPropagation(); g.collapsed = !g.collapsed; this.renderLayerList(); });
        const vis = toggleBtn(g.visible !== false, '👁', '‐', '表示中 — クリックでグループを非表示', '非表示中 — クリックで表示',
          () => { g.visible = g.visible === false; });
        const icon = document.createElement('span');
        icon.className = 'de-layer-type de-layer-type--group';
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6h7l2 2h9v11H3z"/></svg>';
        const name = document.createElement('span');
        name.className = 'de-layer-name';
        name.textContent = g.name;
        name.title = 'ダブルクリックで名前を変更';
        name.addEventListener('dblclick', (e) => { e.stopPropagation(); this.renameGroup(g); });
        const lock = toggleBtn(!!g.locked, '🔒', '🔓', 'グループをロック中 — クリックで解除', 'クリックでグループをロック',
          () => { g.locked = !g.locked; });
        gi.append(caret, vis, icon, name, lock);
        gi.addEventListener('click', (e) => {
          if (e.shiftKey) this.toggleGroupInMultiSelect(g.id);
          else this.selectGroup(g.id);
          this.refreshSelectionUI();
        });
        gi.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const alreadyTargeted = (this.activeGroup() && this.activeGroup().id === g.id) || multiGroupIds.has(g.id);
          if (!alreadyTargeted) { this.selectGroup(g.id); this.refreshSelectionUI(); }
          this.showContextMenu(e.clientX, e.clientY, this.layerMenuItems());
        });
        attachDrag(gi, { kind: 'group', id: g.id });
        list.appendChild(gi);
      }
      if (g && g.collapsed) return;

      const li = document.createElement('li');
      li.className = 'de-layer-item';
      if (g) li.classList.add('de-layer-member');
      li.classList.toggle('selected', layer.id === this.selectedId || multi.has(layer.id));
      li.classList.toggle('in-group-selected', (!!activeGroup && layer.groupId === activeGroup.id) || (!!layer.groupId && multiGroupIds.has(layer.groupId)));

      const visBtn = toggleBtn(layer.visible !== false, '👁', '‐', '表示中 — クリックで非表示', '非表示中 — クリックで表示',
        () => { layer.visible = layer.visible === false; });

      const name = document.createElement('span');
      name.className = 'de-layer-name';
      name.textContent = layer.name || layer.id;

      const typeBadge = document.createElement('span');
      typeBadge.className = 'de-layer-type';
      typeBadge.textContent = { text: 'T', rect: '■', image: '🖼' }[layer.type] || '?';
      typeBadge.title = { text: 'テキストレイヤー', rect: '図形レイヤー', image: '画像レイヤー' }[layer.type] || 'レイヤー';

      const lockBtn = toggleBtn(!!layer.locked, '🔒', '🔓', 'ロック中 — クリックで解除', 'クリックでロック (編集不可にする)',
        () => { layer.locked = !layer.locked; });

      li.append(visBtn, typeBadge, name, lockBtn);
      li.title = 'クリックでグループごと選択 / Ctrl+クリックでメンバー単体 / Shift+クリックで複数選択';
      li.addEventListener('click', (e) => {
        if (e.shiftKey) {
          if (layer.groupId) this.toggleGroupInMultiSelect(layer.groupId);
          else this.selectLayer(layer.id, true);
        } else if (layer.groupId && !(e.ctrlKey || e.metaKey)) {
          this.selectGroup(layer.groupId);
        } else {
          this.selectLayer(layer.id);
        }
        this.refreshSelectionUI();
      });
      li.addEventListener('dblclick', (e) => {
        if (e.target.closest('.de-layer-name')) this.renameLayer(layer);
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        // 複数選択中のレイヤー上なら選択を保ったまま、それ以外はグループごと(または単体)選択
        if (!this.targets().includes(layer) || this.activeGroup()) {
          if (layer.groupId && !(e.ctrlKey || e.metaKey)) this.selectGroup(layer.groupId);
          else this.selectLayer(layer.id);
          this.refreshSelectionUI();
        }
        this.showContextMenu(e.clientX, e.clientY, this.layerMenuItems());
      });
      attachDrag(li, { kind: 'layer', id: layer.id });
      list.appendChild(li);
    });
  },

  // ===== レイヤー操作 =====

  addLayer(type) {
    if (type === 'image') {
      this.addImageLayer();
      return;
    }
    this.beginChange();
    const id = this.newLayerId();
    let layer;
    if (type === 'text') {
      layer = {
        id, name: 'テキスト', type: 'text',
        binding: '', text: 'テキスト', sample: '',
        x: 760, y: 490, w: 400, h: 100,
        align: 'center', vAlign: 'middle',
        autoFit: 'tracking', // 既定で字詰め (短文=字間広げ / 長文=詰め+長体)
        font: { family: '"Yu Gothic UI", sans-serif', size: 40, weight: 700, color: '#ffffff', letterSpacing: 0, lineHeight: 1.25 },
        shadow: null, visible: true, locked: false, opacity: 1,
      };
    } else {
      layer = {
        id, name: '矩形', type: 'rect',
        x: 710, y: 440, w: 500, h: 200,
        fill: { type: 'solid', color: '#0d6ab7' },
        border: { width: 0, color: '#ffffff' },
        radius: 0, visible: true, locked: false, opacity: 1,
      };
    }
    this.layers().push(layer);
    this.selectedId = id;
    this.renderAll();
  },

  async addImageLayer() {
    const result = await window.api.graphicsImportAsset();
    if (!result) return;
    if (!result.ok) {
      App.setStatus(`画像取り込みエラー: ${result.error}`, 'error');
      return;
    }
    this.beginChange();
    const id = this.newLayerId();
    const layer = {
      id, name: result.file.replace(/^\d+_/, ''), type: 'image',
      file: result.file,
      x: 660, y: 390, w: 600, h: 300,
      objectFit: 'fill', visible: true, locked: false, opacity: 1,
    };
    this.layers().push(layer);
    this.selectedId = id;
    this.renderAll();

    // 実画像サイズに合わせる (アスペクト比維持、最大800px)
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
      layer.w = Math.round(img.naturalWidth * scale);
      layer.h = Math.round(img.naturalHeight * scale);
      this.renderAll();
    };
    img.src = this.assetBase() + encodeURIComponent(result.file);
  },

  duplicateLayer() {
    const srcs = this.targets();
    if (!srcs.length) return;
    this.beginChange();
    const layers = this.layers();
    const group = this.activeGroup();
    let newGid = null;
    if (group) {
      newGid = `g${Date.now().toString(36)}`;
      this.groups().push({ ...JSON.parse(JSON.stringify(group)), id: newGid, name: `${group.name} コピー` });
    }
    const topIdx = Math.max(...srcs.map((l) => layers.indexOf(l)));
    const copies = srcs.map((src) => {
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = this.newLayerId();
      layers.push(copy); // newLayerId の重複回避のため一旦末尾へ
      copy.name = `${src.name || src.id} コピー`;
      copy.x += 20;
      copy.y += 20;
      if (newGid) copy.groupId = newGid;
      return copy;
    });
    copies.forEach((c) => layers.splice(layers.indexOf(c), 1));
    layers.splice(topIdx + 1, 0, ...copies);
    this.normalizeGroups();
    if (newGid) this.selectGroup(newGid);
    else if (copies.length > 1) { this.selectedIds = copies.map((c) => c.id); this.selectedId = copies[copies.length - 1].id; this.selectedGroupId = null; }
    else this.selectLayer(copies[0].id);
    this.renderAll();
  },

  deleteLayer() {
    const targets = new Set(this.targets());
    if (!targets.size) return;
    this.beginChange();
    const layers = this.layers();
    const rest = layers.filter((l) => !targets.has(l));
    layers.splice(0, layers.length, ...rest);
    this.normalizeGroups();
    this.clearSelection();
    this.renderAll();
  },

  /**
   * 重ね順の単位: グループに属さないレイヤーは1枚、グループはメンバー一式で1単位。
   * グループ内の単体レイヤーはグループ内でのみ移動する。
   */
  reorderUnits(list) {
    const units = [];
    list.forEach((l) => {
      const last = units[units.length - 1];
      if (l.groupId && last && last[0].groupId === l.groupId) last.push(l);
      else units.push([l]);
    });
    return units;
  },

  /** 重ね順変更 (+1=前面へ / -1=背面へ) */
  moveLayer(direction) {
    this.reorder((arr, i) => {
      const to = i + direction;
      if (to < 0 || to >= arr.length) return false;
      const [u] = arr.splice(i, 1);
      arr.splice(to, 0, u);
      return true;
    });
  },

  /** 最前面/最背面へ移動 */
  moveLayerEnd(front) {
    this.reorder((arr, i) => {
      if ((front && i === arr.length - 1) || (!front && i === 0)) return false;
      const [u] = arr.splice(i, 1);
      if (front) arr.push(u); else arr.unshift(u);
      return true;
    });
  },

  reorder(op) {
    const layers = this.layers();
    const group = this.activeGroup();
    const layer = this.selected();
    if (!group && !layer) return;
    if (!group && layer.groupId) {
      // グループ内の並べ替え
      const members = this.groupMembers(layer.groupId);
      const i = members.indexOf(layer);
      if (!op(members, i)) return;
      this.beginChange();
      const start = layers.findIndex((l) => l.groupId === layer.groupId);
      layers.splice(start, members.length, ...members);
    } else {
      const units = this.reorderUnits(layers);
      const i = units.findIndex((u) => (group ? u[0].groupId === group.id : u[0] === layer));
      if (i < 0 || !op(units, i)) return;
      this.beginChange();
      layers.splice(0, layers.length, ...units.flat());
    }
    this.renderAll();
  },

  /**
   * レイヤーパネルのドラッグ&ドロップで重ね順を変更する。
   * key: { kind: 'layer'|'group', id }。above: ドロップ先行の上半分(=前面側)にドロップしたか。
   * グループ内のレイヤーは同じグループ内でのみ移動できる (グループを跨いだ移動は不可)。
   */
  dropReorder(draggedKey, targetKey, above) {
    if (draggedKey.kind === targetKey.kind && draggedKey.id === targetKey.id) return;
    const layers = this.layers();

    if (draggedKey.kind === 'layer') {
      const draggedLayer = layers.find((l) => l.id === draggedKey.id);
      if (!draggedLayer) return;
      if (draggedLayer.groupId) {
        if (targetKey.kind !== 'layer') return; // グループ内メンバーはグループの外へドロップできない
        const targetLayer = layers.find((l) => l.id === targetKey.id);
        if (!targetLayer || targetLayer.groupId !== draggedLayer.groupId) return;
        const members = this.groupMembers(draggedLayer.groupId);
        if (!this.moveWithinArray(members, draggedLayer, targetLayer, above)) return;
        this.beginChange();
        const start = layers.findIndex((l) => l.groupId === draggedLayer.groupId);
        layers.splice(start, members.length, ...members);
        this.renderAll();
        return;
      }
    } else if (targetKey.kind === 'layer') {
      const targetLayer = layers.find((l) => l.id === targetKey.id);
      if (targetLayer && targetLayer.groupId) return; // グループメンバーへの直接ドロップは不可 (グループ全体として扱う)
    }

    // トップレベル (素のレイヤー/グループ) 同士の並べ替え
    const units = this.reorderUnits(layers);
    const unitKey = (u) => (u[0].groupId ? { kind: 'group', id: u[0].groupId } : { kind: 'layer', id: u[0].id });
    const draggedUnit = units.find((u) => { const k = unitKey(u); return k.kind === draggedKey.kind && k.id === draggedKey.id; });
    const targetUnit = units.find((u) => { const k = unitKey(u); return k.kind === targetKey.kind && k.id === targetKey.id; });
    if (!draggedUnit || !targetUnit || draggedUnit === targetUnit) return;
    if (!this.moveWithinArray(units, draggedUnit, targetUnit, above)) return;
    this.beginChange();
    layers.splice(0, layers.length, ...units.flat());
    this.renderAll();
  },

  /**
   * 配列(添字0=背面, 末尾=前面)内で dragged を target の位置へ移動する。
   * above: 画面表示(上=前面)で target の上半分にドロップしたか。
   */
  moveWithinArray(arr, dragged, target, above) {
    const from = arr.indexOf(dragged);
    const targetIdx = arr.indexOf(target);
    if (from < 0 || targetIdx < 0) return false;
    let to = above ? targetIdx + 1 : targetIdx;
    if (from < to) to -= 1;
    if (from === to) return false;
    arr.splice(from, 1);
    arr.splice(to, 0, dragged);
    return true;
  },

  // ===== アートボード操作 =====

  canvasPoint(e) {
    const rect = document.getElementById('de-canvas-wrap').getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / this.zoom,
      y: (e.clientY - rect.top) / this.zoom,
    };
  },

  /** 最前面からヒットテスト */
  hitTest(pt) {
    const layers = this.layers();
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!this.isShown(l) || this.isLocked(l)) continue;
      if (pt.x >= l.x && pt.x <= l.x + l.w && pt.y >= l.y && pt.y <= l.y + l.h) return l;
    }
    return null;
  },

  onCanvasMouseDown(e) {
    if (e.button !== 0) return;
    const pt = this.canvasPoint(e);
    const layer = this.hitTest(pt);
    if (!layer) {
      this.clearSelection();
      this.refreshSelectionUI();
      return;
    }
    const inTargets = this.targets().includes(layer);
    if (e.shiftKey) {
      if (layer.groupId) this.toggleGroupInMultiSelect(layer.groupId); // Shift: グループごと複数選択に追加/解除
      else this.selectLayer(layer.id, true);   // Shift: 複数選択に追加/解除
    } else if (inTargets && this.targets().length > 1) {
      // 選択中の複数/グループをそのままドラッグ
    } else if (layer.groupId && !(e.ctrlKey || e.metaKey)) {
      this.selectGroup(layer.groupId);          // グループのメンバーはグループごと選択 (Ctrl+クリックで単体)
    } else {
      this.selectLayer(layer.id);
    }
    this.refreshSelectionUI();

    const targets = this.targets();
    if (!targets.includes(layer)) return;
    this.beginChange();
    const bounds = this.boundsOf(targets);
    this.drag = {
      kind: 'move',
      layers: targets,
      origs: targets.map((l) => ({ x: l.x, y: l.y })),
      bounds,
      startX: pt.x, startY: pt.y,
      moved: false,
    };
    e.preventDefault();
  },

  /** リサイズ開始 (単体/複数選択/グループいずれも対応。各レイヤーの元の位置・サイズ・文字変体率を記録) */
  startResize(e, handle) {
    const targets = this.targets();
    if (!targets.length) return;
    const pt = this.canvasPoint(e);
    this.beginChange();
    this.drag = {
      kind: 'resize', handle,
      layers: targets,
      groupOrig: this.boundsOf(targets),
      origs: targets.map((l) => ({
        x: l.x, y: l.y, w: l.w, h: l.h,
        fontScaleX: l.font ? (l.font.scaleX !== undefined ? l.font.scaleX : 1) : 1,
        fontScaleY: l.font ? (l.font.scaleY !== undefined ? l.font.scaleY : 1) : 1,
      })),
      startX: pt.x, startY: pt.y,
    };
    e.preventDefault();
    e.stopPropagation();
  },

  onMouseMove(e) {
    if (!this.drag) return;
    const pt = this.canvasPoint(e);
    const dx = pt.x - this.drag.startX;
    const dy = pt.y - this.drag.startY;

    if (this.drag.kind === 'move') {
      // 複数/グループは外接矩形でスナップし、全メンバーを同じ量だけ動かす
      const { layers, origs, bounds } = this.drag;
      const nx = Math.round(bounds.x + dx);
      const ny = Math.round(bounds.y + dy);
      const snapped = this.applySnap({ ...bounds }, nx, ny, new Set(layers));
      let bx = snapped.x;
      let by = snapped.y;
      if (this.gridSize > 0 && !snapped.guided) {
        bx = Math.round(bx / this.gridSize) * this.gridSize;
        by = Math.round(by / this.gridSize) * this.gridSize;
      }
      layers.forEach((l, i) => {
        l.x = origs[i].x + (bx - bounds.x);
        l.y = origs[i].y + (by - bounds.y);
        this.updateLayerElement(l);
      });
      this.drag.moved = true;
      this.renderSelection();
    } else {
      // リサイズ: 外接矩形(groupOrig)をハンドル方向に伸縮し、各レイヤーをその拡大率で
      // 相対位置・サイズを保ったまま追従させる (対象が1枚のときは従来通りの単体リサイズと同じ結果になる)
      const { handle, layers, groupOrig, origs } = this.drag;
      let { x, y, w, h } = groupOrig;
      if (handle.includes('e')) w = groupOrig.w + dx;
      if (handle.includes('s')) h = groupOrig.h + dy;
      if (handle.includes('w')) { x = groupOrig.x + dx; w = groupOrig.w - dx; }
      if (handle.includes('n')) { y = groupOrig.y + dy; h = groupOrig.h - dy; }

      // Shift: 角ハンドルは元の縦横比を保ったまま拡大縮小 (大きく動かした辺を基準にする)
      const isCorner = handle.length === 2;
      if (e.shiftKey && isCorner && groupOrig.w > 0 && groupOrig.h > 0) {
        const ratio = groupOrig.w / groupOrig.h;
        if (Math.abs(w - groupOrig.w) / ratio > Math.abs(h - groupOrig.h)) h = w / ratio;
        else w = h * ratio;
        if (handle.includes('w')) x = groupOrig.x + groupOrig.w - w;
        if (handle.includes('n')) y = groupOrig.y + groupOrig.h - h;
      }

      const newX = w < 10 ? groupOrig.x : x;
      const newY = h < 10 ? groupOrig.y : y;
      const newW = Math.max(10, w);
      const newH = Math.max(10, h);
      const scaleX = groupOrig.w > 0 ? newW / groupOrig.w : 1;
      const scaleY = groupOrig.h > 0 ? newH / groupOrig.h : 1;

      layers.forEach((l, i) => {
        const o = origs[i];
        l.x = Math.round(newX + (o.x - groupOrig.x) * scaleX);
        l.y = Math.round(newY + (o.y - groupOrig.y) * scaleY);
        l.w = Math.round(Math.max(10, o.w * scaleX));
        l.h = Math.round(Math.max(10, o.h * scaleY));
        // 複数/グループのリサイズのみ、文字の変体率も箱の拡縮に追従させる
        // (単体レイヤーの従来のリサイズ挙動は変えない)
        if (layers.length > 1 && l.type === 'text' && l.font) {
          l.font.scaleX = Math.max(0.1, o.fontScaleX * scaleX);
          l.font.scaleY = Math.max(0.1, o.fontScaleY * scaleY);
        }
        this.updateLayerElement(l);
      });
      this.renderSelection();
      this.renderPropsValues();
    }
  },

  onMouseUp() {
    if (!this.drag) return;
    const wasNoopMove = this.drag.kind === 'move' && !this.drag.moved;
    this.drag = null;
    this.hideGuides();
    if (wasNoopMove) {
      // クリックのみ (移動なし): 履歴に積まない
      this.undoStack.pop();
    }
    this.renderAll();
  },

  /** キャンバス中央・端 + 他レイヤーの端/中央へのスナップ */
  applySnap(layer, nx, ny, exclude) {
    const threshold = this.SNAP_PX / this.zoom;
    const guideV = document.getElementById('de-guide-v');
    const guideH = document.getElementById('de-guide-h');
    let snapV = null;
    let snapH = null;

    // スナップ先: キャンバスの端/中央 + 他レイヤーの端/中央
    const xTargets = [0, this.CANVAS_W / 2, this.CANVAS_W];
    const yTargets = [0, this.CANVAS_H / 2, this.CANVAS_H];
    this.layers().forEach((other) => {
      if (other === layer || (exclude && exclude.has(other)) || !this.isShown(other)) return;
      xTargets.push(other.x, other.x + other.w / 2, other.x + other.w);
      yTargets.push(other.y, other.y + other.h / 2, other.y + other.h);
    });

    for (const t of xTargets) {
      if (Math.abs(nx - t) < threshold) { nx = Math.round(t); snapV = t; break; }
      if (Math.abs(nx + layer.w / 2 - t) < threshold) { nx = Math.round(t - layer.w / 2); snapV = t; break; }
      if (Math.abs(nx + layer.w - t) < threshold) { nx = Math.round(t - layer.w); snapV = t; break; }
    }
    for (const t of yTargets) {
      if (Math.abs(ny - t) < threshold) { ny = Math.round(t); snapH = t; break; }
      if (Math.abs(ny + layer.h / 2 - t) < threshold) { ny = Math.round(t - layer.h / 2); snapH = t; break; }
      if (Math.abs(ny + layer.h - t) < threshold) { ny = Math.round(t - layer.h); snapH = t; break; }
    }

    guideV.classList.toggle('hidden', snapV === null);
    guideH.classList.toggle('hidden', snapH === null);
    if (snapV !== null) guideV.style.left = `${snapV * this.zoom}px`;
    if (snapH !== null) guideH.style.top = `${snapH * this.zoom}px`;

    return { x: nx, y: ny, guided: snapV !== null || snapH !== null };
  },

  hideGuides() {
    document.getElementById('de-guide-v').classList.add('hidden');
    document.getElementById('de-guide-h').classList.add('hidden');
  },

  /** ドラッグ中の軽量更新 (全再描画せずスタイルのみ) */
  updateLayerElement(layer) {
    const el = document.querySelector(`#de-canvas [data-layer-id="${layer.id}"]`);
    if (!el) return;
    // グループアニメーションの箱 (.tl-group) の中は箱の原点からの相対座標
    const box = el.parentElement && el.parentElement.classList.contains('tl-group') ? el.parentElement : null;
    el.style.left = `${layer.x - (box ? Number(box.dataset.bx) : 0)}px`;
    el.style.top = `${layer.y - (box ? Number(box.dataset.by) : 0)}px`;
    el.style.width = `${layer.w}px`;
    el.style.height = `${layer.h}px`;
  },

  renderSelection() {
    const box = document.getElementById('de-selection');
    const targets = this.targets();
    if (!targets.length) {
      box.classList.add('hidden');
      return;
    }
    const layer = targets.length === 1 ? targets[0] : this.boundsOf(targets);
    box.classList.remove('hidden');
    box.classList.toggle('de-selection--multi', targets.length > 1);
    box.style.left = `${layer.x * this.zoom}px`;
    box.style.top = `${layer.y * this.zoom}px`;
    box.style.width = `${layer.w * this.zoom}px`;
    box.style.height = `${layer.h * this.zoom}px`;

    if (box.children.length === 0) {
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((handle) => {
        const h = document.createElement('div');
        h.className = `de-handle de-handle-${handle}`;
        h.dataset.handle = handle;
        h.addEventListener('mousedown', (e) => this.startResize(e, handle));
        box.appendChild(h);
      });
    }
  },

  onKeyDown(e) {
    // デザインタブが非表示、または入力中は無視
    if (!document.getElementById('tab-design').classList.contains('active')) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); return; }

    // Photoshop互換ショートカット
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); this.copyLayers(); return; }
    if (mod && !e.shiftKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); this.pasteLayers(); return; }
    if (mod && !e.shiftKey && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); this.duplicateLayer(); return; }
    if (mod && !e.shiftKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); this.selectAll(); return; }
    if (mod && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); this.clearSelection(); this.renderAll(); return; }
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
      e.preventDefault();
      const front = e.code === 'BracketRight';
      if (e.shiftKey) this.moveLayerEnd(front); else this.moveLayer(front ? 1 : -1);
      return;
    }

    // グループ化 / 解除
    if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      if (e.shiftKey) this.ungroupSelection(); else this.groupSelection();
      return;
    }

    // Escで選択解除 (アニメーション設定パネルに戻る)
    if (e.key === 'Escape' && (this.selectedId || this.selectedGroupId || this.selectedGroupIds.length)) {
      e.preventDefault();
      this.clearSelection();
      this.renderAll();
      return;
    }

    if (!this.targets().length) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.deleteLayer();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      this.beginChange();
      this.moveTargets(moves[e.key][0], moves[e.key][1]);
    }
  },

  // ===== 試写 =====

  playAnimation(direction) {
    const canvas = document.getElementById('de-canvas');
    if (direction === 'in') {
      TelopAnimator.play(canvas, this.variant(), 'in');
    } else {
      TelopAnimator.play(canvas, this.variant(), 'out').then(() => {
        // OUT後は少し待ってから元の表示に戻す
        setTimeout(() => this.renderArtboard(), 400);
      });
    }
  },

  // ===== JP→ENコピー =====

  copyJpToEn() {
    if (!confirm(`「${this.templateLabel(this.templateKey)}」のJPレイアウトをENへコピーします。\nENの現在のレイアウトは上書きされます。よろしいですか?`)) return;
    this.beginChange();
    const template = this.project.templates[this.templateKey];
    const copy = JSON.parse(JSON.stringify(template.variants.jp));
    // バインドをEN側フィールドへ変換 (titleJp→titleEn, textJp→textEn など)。
    // 自由入力の変数名 (末尾が大文字のJP等) にも対応するため大小文字を区別せず判定し、
    // 変換後も元の大小文字のパターンを保つ。「Jp」系で終わらない変数名はJPと同じ
    // binding になって区別できなくなるのを避けるため、末尾に _en を付けて区別する。
    copy.layers.forEach((layer) => {
      if (layer.type !== 'text' || !layer.binding) return;
      const b = layer.binding;
      if (/jp$/i.test(b)) {
        const suffix = b.slice(-2);
        const replacement = suffix === suffix.toUpperCase() ? 'EN' : (suffix === suffix.toLowerCase() ? 'en' : 'En');
        layer.binding = b.slice(0, -2) + replacement;
      } else {
        layer.binding = `${b}_en`;
      }
    });
    template.variants.en = copy;
    if (this.lang === 'en') this.renderAll();
    App.setStatus('JPレイアウトをENへコピーしました (バインドはEN側フィールドに変換)', 'success');
    this.updateStatus();
  },

  // ===== プロパティパネル =====

  renderProps() {
    const root = document.getElementById('de-props');
    const layer = this.selected();
    root.innerHTML = '';
    // タブごとのペイン (プロパティ / 文字 / アニメーション)
    const panes = {};
    ['props', 'text', 'anim'].forEach((key) => {
      const pane = document.createElement('div');
      pane.className = 'de-pane';
      pane.dataset.pane = key;
      root.appendChild(pane);
      panes[key] = pane;
    });
    const emptyMsg = (pane, msg) => {
      const el = document.createElement('div');
      el.className = 'de-props-empty';
      el.textContent = msg;
      pane.appendChild(el);
    };
    const textTab = document.querySelector('#de-props-tabs [data-ptab="text"]');
    if (textTab) textTab.classList.toggle('dim', !(layer && layer.type === 'text'));

    // グループ / 複数グループ / 複数選択
    const group = this.activeGroup();
    const multiGroups = this.multiGroups();
    const multi = this.multiSelected();
    if (group || multiGroups.length || multi.length) {
      const members = group ? this.groupMembers(group.id)
        : multiGroups.length ? multiGroups.flatMap((g) => this.groupMembers(g.id))
          : multi;
      this.renderGroupProps(panes.props, group, members, multiGroups.length);
      emptyMsg(panes.text, '文字レイヤーを1つ選択すると、フォント・塗り・縁取りなどを編集できます');
      if (group) this.renderGroupAnim(panes.anim, group);
      else emptyMsg(panes.anim, 'グループ化するとグループ単位のアニメーションを設定できます');
      this.showPropsTab(this.propsTab === 'text' || (!group && this.propsTab === 'anim') ? 'props' : null);
      return;
    }

    if (!layer) {
      // レイヤー未選択時はテンプレートのアニメーション設定を表示
      emptyMsg(panes.props, 'レイヤーを選択してください');
      emptyMsg(panes.text, '文字レイヤーを選択すると、フォント・塗り・縁取りなどを編集できます');
      this.renderAnimationProps(panes.anim);
      this.showPropsTab('anim'); // 未選択時はテンプレートのアニメーション設定を表示 (ユーザーのタブ選択は保持)
      return;
    }
    if (layer.type !== 'text') emptyMsg(panes.text, '文字レイヤーを選択すると、フォント・塗り・縁取りなどを編集できます');

    // セクションの振り分け先 (文字の装飾系は「文字」タブ、アニメーションは「アニメーション」タブ)
    const TEXT_SECTIONS = ['フォント', '塗り', '縁取り (外側・内→外の順)', '影 (ドロップシャドウ)', '座布団 (文字の背景)', '装飾スタイル'];
    let panel = panes.props;
    const section = (title) => {
      if (title === 'アニメーション') panel = panes.anim;
      else if (layer.type === 'text' && TEXT_SECTIONS.includes(title)) panel = panes.text;
      else panel = panes.props;
      const h = document.createElement('div');
      h.className = 'de-props-section';
      h.textContent = title;
      panel.appendChild(h);
      return h;
    };

    const row = (label, ...inputs) => {
      const div = document.createElement('div');
      div.className = 'de-prop-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      div.appendChild(lab);
      inputs.forEach((i) => div.appendChild(i));
      panel.appendChild(div);
      return div;
    };

    // 変更をモデルへ書き戻す共通ハンドラ
    const bind = (input, getter, setter, opts = {}) => {
      input.addEventListener('change', () => {
        this.beginChange();
        setter(input);
        this.renderArtboard();
        this.renderSelection();
        if (opts.refreshList) this.renderLayerList();
      });
      getter(input);
      return input;
    };

    const num = (getter, setter, attrs = {}) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'input input--small de-prop-num';
      Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
      return bind(input, (i) => { i.value = getter(); }, (i) => setter(parseFloat(i.value) || 0));
    };

    const text = (getter, setter, opts = {}) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input input--small';
      if (opts.list) input.setAttribute('list', opts.list);
      return bind(input, (i) => { i.value = getter() || ''; }, (i) => setter(i.value), opts);
    };

    /** 複数行テキスト入力 (固定テキスト・見本など、改行を含められる項目用) */
    const textarea = (getter, setter, opts = {}) => {
      const input = document.createElement('textarea');
      input.className = 'input de-prop-textarea';
      input.rows = opts.rows || 2;
      if (opts.placeholder) input.placeholder = opts.placeholder;
      return bind(input, (i) => { i.value = getter() || ''; }, (i) => setter(i.value), opts);
    };

    const color = (getter, setter) => {
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'de-prop-color';
      return bind(input, (i) => { i.value = getter() || '#ffffff'; }, (i) => setter(i.value));
    };

    const select = (options, getter, setter) => {
      const sel = document.createElement('select');
      sel.className = 'input input--small';
      options.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
      });
      return bind(sel, (i) => { i.value = getter(); }, (i) => setter(i.value));
    };

    // --- 共通 ---
    section('レイヤー');
    row('名前', text(() => layer.name, (v) => { layer.name = v; }, { refreshList: true }));
    row('X / Y',
      num(() => layer.x, (v) => { layer.x = v; }, { 'data-prop': 'x' }),
      num(() => layer.y, (v) => { layer.y = v; }, { 'data-prop': 'y' }));
    row('W / H',
      num(() => layer.w, (v) => {
        const newW = Math.max(10, v);
        if (this.aspectLocked && layer.w > 0) layer.h = Math.max(10, Math.round(layer.h * (newW / layer.w)));
        layer.w = newW;
        this.renderPropsValues();
      }, { 'data-prop': 'w' }),
      num(() => layer.h, (v) => {
        const newH = Math.max(10, v);
        if (this.aspectLocked && layer.h > 0) layer.w = Math.max(10, Math.round(layer.w * (newH / layer.h)));
        layer.h = newH;
        this.renderPropsValues();
      }, { 'data-prop': 'h' }),
      this.aspectLockBtn(() => this.renderProps()));
    row('回転 / 不透明',
      num(() => layer.rotation || 0, (v) => { layer.rotation = v; }),
      num(() => Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100), (v) => { layer.opacity = Math.max(0, Math.min(100, v)) / 100; }, { min: 0, max: 100 }));

    // キャンバス基準の整列ボタン
    const alignBtn = (kind, title, apply) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--small de-align-btn';
      btn.innerHTML = this.alignIconSvg(kind);
      btn.title = title;
      btn.addEventListener('click', () => {
        this.beginChange();
        apply();
        this.renderArtboard();
        this.renderSelection();
        this.renderPropsValues();
      });
      return btn;
    };
    row('整列 (横)',
      alignBtn('left', '左端へ', () => { layer.x = 0; }),
      alignBtn('hcenter', '水平中央へ', () => { layer.x = Math.round((this.CANVAS_W - layer.w) / 2); }),
      alignBtn('right', '右端へ', () => { layer.x = this.CANVAS_W - layer.w; }));
    row('整列 (縦)',
      alignBtn('top', '上端へ', () => { layer.y = 0; }),
      alignBtn('vcenter', '垂直中央へ', () => { layer.y = Math.round((this.CANVAS_H - layer.h) / 2); }),
      alignBtn('bottom', '下端へ', () => { layer.y = this.CANVAS_H - layer.h; }));

    // --- テキスト ---
    if (layer.type === 'text') {
      section('テキスト');
      // 固定テキスト / データ連動(変数) の切替
      const modeRow = row('内容');
      const modeSeg = document.createElement('div');
      modeSeg.className = 'de-seg';
      const fixedBtn = document.createElement('button');
      fixedBtn.type = 'button';
      fixedBtn.className = `de-seg-btn${layer.binding ? '' : ' active'}`;
      fixedBtn.textContent = '固定テキスト';
      fixedBtn.addEventListener('click', () => {
        if (!layer.binding) return;
        this.beginChange();
        layer.binding = '';
        layer.poolKey = '';
        layer.poolColumn = '';
        this.renderProps();
      });
      const bindBtn = document.createElement('button');
      bindBtn.type = 'button';
      bindBtn.className = `de-seg-btn${layer.binding ? ' active' : ''}`;
      bindBtn.textContent = 'データ連動(変数)';
      bindBtn.addEventListener('click', () => {
        if (layer.binding) return;
        this.beginChange();
        layer.binding = this.suggestBindingName(layer.name);
        this.renderProps();
      });
      modeSeg.append(fixedBtn, bindBtn);
      modeRow.appendChild(modeSeg);

      if (!layer.binding) {
        row('固定テキスト', textarea(() => layer.text, (v) => { layer.text = v; }, { placeholder: 'テキストを入力 (Enterで改行できます)' }));
      } else {
        row('変数名', text(() => layer.binding, (v) => { layer.binding = v.trim() || layer.binding; }, { list: 'de-binding-suggest' }));
        row('見本', textarea(() => layer.sample, (v) => { layer.sample = v; }, { placeholder: '送出前に確認するための見本テキスト' }));

        const pools = this.availablePools();
        const poolOptions = [['', 'なし (直接入力)']].concat(Object.entries(pools).map(([k, p]) => [k, p.label || k]));
        row('プール連携', select(poolOptions, () => layer.poolKey || '', (v) => {
          layer.poolKey = v;
          const cols = v && pools[v] ? Object.keys(pools[v].columns || {}) : [];
          layer.poolColumn = cols[0] || '';
          this.renderProps();
        }));
        if (layer.poolKey && pools[layer.poolKey]) {
          const colOptions = Object.entries(pools[layer.poolKey].columns || {});
          row('プールの列', select(colOptions, () => layer.poolColumn || (colOptions[0] && colOptions[0][0]) || '', (v) => { layer.poolColumn = v; }));
          const poolHint = document.createElement('div');
          poolHint.className = 'de-props-hint';
          poolHint.textContent = '送出のページ編集で、このプールからプルダウン選択できるようになります。同じプールを指定した他の変数とは1つのプルダウンにまとまります。';
          panel.appendChild(poolHint);
        }
      }

      // バインドの変数名サジェスト (既存テンプレート内で使われている名前)
      let bindingSuggestList = document.getElementById('de-binding-suggest');
      if (!bindingSuggestList) {
        bindingSuggestList = document.createElement('datalist');
        bindingSuggestList.id = 'de-binding-suggest';
        document.body.appendChild(bindingSuggestList);
      }
      bindingSuggestList.innerHTML = '';
      this.bindings().forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b;
        bindingSuggestList.appendChild(opt);
      });
      row('縦書き', select([['off', '横書き'], ['on', '縦書き']],
        () => (layer.vertical ? 'on' : 'off'),
        (v) => { layer.vertical = v === 'on'; this.renderProps(); }));
      if (layer.vertical) {
        row('縦中横', select([['on', '数字を横組み (1〜3桁)'], ['off', 'なし']],
          () => (layer.tcy === false ? 'off' : 'on'), (v) => { layer.tcy = v !== 'off'; }));
        const vHint = document.createElement('div');
        vHint.className = 'de-props-hint';
        vHint.textContent = '※縦書きは縦書き対応フォント (メイリオ / 游ゴシック / Noto Sans JP 等) を使用してください。非対応フォントでは文字が重なることがあります';
        panel.appendChild(vHint);
      }
      const rubyHint = document.createElement('div');
      rubyHint.className = 'de-props-hint';
      rubyHint.textContent = 'ルビ: 【文字|よみ】 と入力すると振り仮名が付きます';
      panel.appendChild(rubyHint);

      layer.font = layer.font || {};
      section('フォント');
      row('ファミリー', this.fontFamilySelect(layer));
      row('サイズ / 太さ',
        num(() => layer.font.size || 30, (v) => { layer.font.size = Math.max(4, v); }),
        select([['400', '標準'], ['500', '中'], ['700', '太字'], ['800', '極太'], ['900', '最太']],
          () => String(layer.font.weight || 700), (v) => { layer.font.weight = parseInt(v, 10); }));
      row('字間 / 行間',
        num(() => layer.font.letterSpacing || 0, (v) => { layer.font.letterSpacing = v; }, { step: '0.01' }),
        num(() => layer.font.lineHeight || 1.25, (v) => { layer.font.lineHeight = Math.max(0.5, v); }, { step: '0.05' }));
      row('斜体 / 歪み(°)',
        select([['off', 'なし'], ['on', '斜体']],
          () => (layer.font.italic ? 'on' : 'off'), (v) => { layer.font.italic = v === 'on'; }),
        num(() => layer.font.skewX || 0, (v) => { layer.font.skewX = Math.max(-45, Math.min(45, v)); }));
      row('横幅率/縦幅率(%)',
        num(() => Math.round((layer.font.scaleX !== undefined ? layer.font.scaleX : 1) * 100),
          (v) => { layer.font.scaleX = Math.max(10, Math.min(400, v || 100)) / 100; }, { step: '5' }),
        num(() => Math.round((layer.font.scaleY !== undefined ? layer.font.scaleY : 1) * 100),
          (v) => { layer.font.scaleY = Math.max(10, Math.min(400, v || 100)) / 100; }, { step: '5' }));
      row('揃え',
        select([['left', '左'], ['center', '中央'], ['right', '右'], ['justify', '均等割付']], () => layer.align || 'left', (v) => { layer.align = v; }),
        select([['top', '上'], ['middle', '中央'], ['bottom', '下']], () => layer.vAlign || 'middle', (v) => { layer.vAlign = v; }));
      row('自動調整', select(
        [['none', 'なし'],
          ['tracking', '字詰め (短文=字間広げ / 長文=詰め+長体)'],
          ['condense', '長体 (横に圧縮して収める)'],
          ['shrink', '縮小 (フォントを小さくして収める)']],
        () => layer.autoFit || 'none', (v) => { layer.autoFit = v; this.renderProps(); }));
      if (layer.autoFit === 'tracking') {
        row('最大/最小字間(em)',
          num(() => (layer.font.trackMax !== undefined ? layer.font.trackMax : 0.35),
            (v) => { layer.font.trackMax = Math.max(0, Math.min(2, v)); }, { step: '0.05' }),
          num(() => (layer.font.trackMin !== undefined ? layer.font.trackMin : -0.08),
            (v) => { layer.font.trackMin = Math.max(-0.4, Math.min(0, v)); }, { step: '0.01' }));
      }

      // --- 塗り (単色 / グラデーション) ---
      section('塗り');
      row('種類', select([['solid', '単色'], ['gradient', 'グラデーション']],
        () => (layer.fill && layer.fill.type === 'gradient' ? 'gradient' : 'solid'),
        (v) => {
          layer.fill = v === 'gradient'
            ? { type: 'gradient', from: layer.font.color || '#ffffff', to: '#ffd54a', angle: 180 }
            : null;
          this.renderProps();
        }));
      if (layer.fill && layer.fill.type === 'gradient') {
        row('開始色 / 終了色',
          color(() => layer.fill.from || '#ffffff', (v) => { layer.fill.from = v; }),
          color(() => layer.fill.to || '#ffd54a', (v) => { layer.fill.to = v; }));
        row('角度', num(() => (layer.fill.angle !== undefined ? layer.fill.angle : 180), (v) => { layer.fill.angle = v; }));
      } else {
        row('色', color(() => layer.font.color, (v) => { layer.font.color = v; }));
      }

      // --- 縁取り (多重エッジ・外側) ---
      section('縁取り (外側・内→外の順)');
      if (!Array.isArray(layer.strokes)) {
        layer.strokes = (layer.stroke && layer.stroke.width > 0)
          ? [{ width: layer.stroke.width, color: layer.stroke.color || '#000000' }]
          : [];
        delete layer.stroke;
      }
      layer.strokes.forEach((st, si) => {
        const del = document.createElement('button');
        del.className = 'btn btn--small';
        del.textContent = '✕';
        del.title = 'このエッジを削除';
        del.addEventListener('click', () => {
          this.beginChange();
          layer.strokes.splice(si, 1);
          this.renderArtboard();
          this.renderProps();
        });
        row(`エッジ${si + 1} 太さ/色`,
          num(() => st.width, (v) => { st.width = Math.max(0, v); }, { step: '0.5' }),
          color(() => st.color, (v) => { st.color = v; }),
          del);
      });
      if (layer.strokes.length < 4) {
        const addEdge = document.createElement('button');
        addEdge.className = 'btn btn--small';
        addEdge.textContent = '＋エッジ追加';
        addEdge.title = '縁取りを1層追加 (最大4層。内側から順に重なります)';
        addEdge.addEventListener('click', () => {
          this.beginChange();
          layer.strokes.push({ width: 3, color: layer.strokes.length % 2 === 0 ? '#000000' : '#ffffff' });
          this.renderArtboard();
          this.renderProps();
        });
        row('', addEdge);
      }

      // --- 影 (ドロップシャドウ: 角度+距離+ぼかし) ---
      section('影 (ドロップシャドウ)');
      // 旧形式 (x/y指定) は角度/距離へ変換
      if (layer.shadow && layer.shadow.distance === undefined) {
        const dx = layer.shadow.x || 0;
        const dy = layer.shadow.y || 0;
        layer.shadow.distance = Math.round(Math.hypot(dx, dy) * 10) / 10;
        layer.shadow.angle = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
        delete layer.shadow.x;
        delete layer.shadow.y;
      }
      row('影', select([['off', 'なし'], ['on', 'あり']], () => (layer.shadow ? 'on' : 'off'), (v) => {
        layer.shadow = v === 'on'
          ? (layer.shadow || { angle: 45, distance: 4, blur: 6, color: 'rgba(0,0,0,0.6)' })
          : null;
        this.renderProps();
      }));
      if (layer.shadow) {
        const angleInput = num(() => (layer.shadow.angle !== undefined ? layer.shadow.angle : 45),
          (v) => { layer.shadow.angle = ((v % 360) + 360) % 360; }, { min: 0, max: 360 });
        angleInput.title = '0°=右 / 90°=下 / 180°=左 / 270°=上';
        row('角度 / 距離',
          angleInput,
          num(() => (layer.shadow.distance !== undefined ? layer.shadow.distance : 4), (v) => { layer.shadow.distance = Math.max(0, v); }, { step: '0.5' }));
        row('ぼかし', num(() => layer.shadow.blur || 0, (v) => { layer.shadow.blur = Math.max(0, v); }));
        row('影 色', text(() => layer.shadow.color, (v) => { layer.shadow.color = v; }));
      }

      // --- 座布団 (文字にフィットする背景) ---
      section('座布団 (文字の背景)');
      row('モード', select(
        [['off', 'なし'], ['fit', '文字にフィット'], ['fixed', 'レイヤー枠全体']],
        () => (layer.board && layer.board.enabled ? (layer.board.mode || 'fit') : 'off'),
        (v) => {
          if (v === 'off') {
            layer.board = null;
          } else {
            layer.board = layer.board || { color: '#0d6ab7', radius: 6, padX: 18, padY: 6 };
            layer.board.enabled = true;
            layer.board.mode = v;
          }
          this.renderProps();
        }));
      if (layer.board && layer.board.enabled) {
        row('色 / 角丸',
          color(() => layer.board.color || '#0d6ab7', (v) => { layer.board.color = v; }),
          num(() => layer.board.radius || 0, (v) => { layer.board.radius = Math.max(0, v); }));
        if (layer.board.mode !== 'fixed') {
          row('余白 横/縦',
            num(() => (layer.board.padX !== undefined ? layer.board.padX : 18), (v) => { layer.board.padX = Math.max(0, v); }),
            num(() => (layer.board.padY !== undefined ? layer.board.padY : 6), (v) => { layer.board.padY = Math.max(0, v); }));
        }
      }

      // --- 装飾スタイルのコピー/貼り付け・スタイルパレット ---
      section('装飾スタイル');
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn--small';
      copyBtn.textContent = '装飾コピー';
      copyBtn.title = 'フォント・塗り・縁取り・影・座布団の設定をコピー (テキスト内容や位置はコピーしません)';
      copyBtn.addEventListener('click', () => {
        this._styleClipboard = this.captureStyle(layer);
        App.setStatus('装飾スタイルをコピーしました。他のテキストレイヤーを選んで「貼り付け」してください', 'success');
        this.renderProps();
      });
      const pasteBtn = document.createElement('button');
      pasteBtn.className = 'btn btn--small';
      pasteBtn.textContent = '貼り付け';
      pasteBtn.disabled = !this._styleClipboard;
      pasteBtn.title = this._styleClipboard ? 'コピーした装飾スタイルをこのレイヤーへ適用' : '先に「装飾コピー」を実行してください';
      pasteBtn.addEventListener('click', () => {
        if (!this._styleClipboard) return;
        this.beginChange();
        this.applyStyle(layer, this._styleClipboard);
        this.renderArtboard();
        this.renderProps();
        App.setStatus('装飾スタイルを貼り付けました', 'success');
      });
      row('', copyBtn, pasteBtn);

      const styleHint = document.createElement('div');
      styleHint.className = 'de-props-hint';
      styleHint.textContent = '登録済みの装飾は右の「スタイル」パネルから適用・登録できます';
      panel.appendChild(styleHint);
    }

    // --- 矩形 ---
    if (layer.type === 'rect') {
      layer.fill = layer.fill || { type: 'solid', color: '#0d6ab7' };
      layer.border = layer.border || { width: 0, color: '#ffffff' };
      section('塗り');
      row('種類', select([['solid', '単色'], ['gradient', 'グラデーション']],
        () => layer.fill.type || 'solid',
        (v) => { layer.fill.type = v; this.renderProps(); }));
      if (layer.fill.type === 'gradient') {
        row('開始色 / 終了色',
          color(() => layer.fill.from || '#0d6ab7', (v) => { layer.fill.from = v; }),
          color(() => layer.fill.to || '#083d7a', (v) => { layer.fill.to = v; }));
        row('角度', num(() => layer.fill.angle !== undefined ? layer.fill.angle : 180, (v) => { layer.fill.angle = v; }));
      } else {
        row('色', color(() => layer.fill.color || '#0d6ab7', (v) => { layer.fill.color = v; }));
      }
      section('形状');
      row('種類', select([['rect', '四角形'], ['ellipse', '円 / 楕円'], ['polygon', '正多角形'], ['star', '星形']],
        () => layer.shape || 'rect',
        (v) => { if (v === 'rect') delete layer.shape; else layer.shape = v; this.renderProps(); }));
      if (layer.shape === 'polygon' || layer.shape === 'star') {
        row('頂点数', num(() => layer.sides || 5, (v) => { layer.sides = Math.max(3, Math.min(24, Math.round(v) || 5)); }, { min: 3, max: 24 }));
      }
      if (layer.shape === 'star') {
        row('谷の深さ(%)', num(() => Math.round((layer.starInset !== undefined ? layer.starInset : 0.5) * 100),
          (v) => { layer.starInset = Math.max(10, Math.min(90, v || 50)) / 100; }, { step: '5' }));
      }
      section('枠線 / 角丸');
      row('枠線 太さ/色',
        num(() => layer.border.width || 0, (v) => { layer.border.width = Math.max(0, v); }),
        color(() => layer.border.color, (v) => { layer.border.color = v; }));
      row('角丸', num(() => layer.radius || 0, (v) => { layer.radius = Math.max(0, v); }));
    }

    // --- 画像 ---
    if (layer.type === 'image') {
      section('画像');
      const fileLabel = document.createElement('span');
      fileLabel.className = 'de-prop-file';
      fileLabel.textContent = layer.file || '(未設定)';
      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn btn--small';
      changeBtn.textContent = '変更...';
      changeBtn.addEventListener('click', async () => {
        const result = await window.api.graphicsImportAsset();
        if (!result || !result.ok) return;
        this.beginChange();
        layer.file = result.file;
        this.renderAll();
      });
      row('ファイル', fileLabel, changeBtn);
      row('フィット', select([['fill', '引き伸ばし'], ['contain', '全体表示'], ['cover', '切り抜き']],
        () => layer.objectFit || 'fill', (v) => { layer.objectFit = v; }));
    }

    // --- アニメーション (レイヤー個別設定 — PowerPointの個別アニメーション相当) ---
    section('アニメーション');
    row('動き', select(
      [['default', 'テンプレートの既定に従う'], ['custom', 'このレイヤーだけ個別設定']],
      () => (layer.anim ? 'custom' : 'default'),
      (v) => {
        if (v === 'custom') {
          layer.anim = layer.anim || {
            in: { preset: 'fade', duration: 350, easing: 'ease-out', delay: 0 },
            out: { preset: 'fade', duration: 250, easing: 'ease-in', delay: 0 },
          };
        } else {
          delete layer.anim;
        }
        this.renderProps();
      }));

    if (layer.anim) {
      ['in', 'out'].forEach((dir) => {
        layer.anim[dir] = layer.anim[dir]
          || { preset: 'fade', duration: dir === 'in' ? 350 : 250, easing: dir === 'in' ? 'ease-out' : 'ease-in', delay: 0 };

        const head = document.createElement('div');
        head.className = 'de-props-section de-anim-head';
        const title = document.createElement('span');
        title.textContent = dir === 'in' ? 'IN (このレイヤー)' : 'OUT (このレイヤー)';
        const playBtn = document.createElement('button');
        playBtn.className = 'btn btn--small';
        playBtn.textContent = '▶試写';
        playBtn.addEventListener('click', () => this.playAnimation(dir));
        head.append(title, playBtn);
        panel.appendChild(head);

        this.renderAnimFields(panel, layer.anim[dir], {
          includeDelay: true,
          defaultEasing: dir === 'in' ? 'ease-out' : 'ease-in',
        });
      });

      const hint = document.createElement('div');
      hint.className = 'de-props-hint';
      hint.textContent = '「開始」はTAKEからの時間です。全レイヤーのタイミングは、選択を解除するとタイムラインで確認できます。';
      panel.appendChild(hint);
    }
    this.showPropsTab();
  },

  /**
   * アニメーション設定フィールド群 (テンプレート既定/レイヤー個別 共通)
   * @param {HTMLElement} panel
   * @param {Object} anim 設定オブジェクト (直接書き換える)
   * @param {Object} opts { includeStagger, includeDelay, defaultEasing }
   */
  renderAnimFields(panel, anim, opts = {}) {
    const row = (label, ...inputs) => {
      const div = document.createElement('div');
      div.className = 'de-prop-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      div.appendChild(lab);
      inputs.forEach((i) => div.appendChild(i));
      panel.appendChild(div);
    };
    const bind = (input, getter, setter, rerender) => {
      input.addEventListener('change', () => {
        this.beginChange();
        setter(input);
        if (rerender) this.renderProps();
      });
      getter(input);
      return input;
    };
    const num = (getter, setter, attrs = {}) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'input input--small de-prop-num';
      Object.entries(attrs).forEach(([k, v]) => input.setAttribute(k, v));
      return bind(input, (i) => { i.value = getter(); }, (i) => setter(parseFloat(i.value) || 0));
    };
    const select = (options, getter, setter, rerender) => {
      const sel = document.createElement('select');
      sel.className = 'input input--small';
      options.forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
      });
      return bind(sel, (i) => { i.value = getter(); }, (i) => setter(i.value), rerender);
    };

    // プリセット: 単語ボタンのグリッド (変更時はパネルを再描画して関連パラメータを出し分け)
    const presetGrid = document.createElement('div');
    presetGrid.className = 'de-preset-grid';
    const current = anim.preset || 'fade';
    this.ANIM_PRESETS.forEach(([value, label]) => {
      const btn = document.createElement('button');
      btn.className = `de-preset-btn${value === current ? ' active' : ''}`;
      btn.textContent = label.replace(/ \(.*\)$/, '');
      btn.title = label;
      btn.addEventListener('click', () => {
        if (anim.preset === value) return;
        this.beginChange();
        anim.preset = value;
        this.renderProps();
        this.renderTemplateChrome();
      });
      presetGrid.appendChild(btn);
    });
    const presetHead = document.createElement('div');
    presetHead.className = 'de-prop-label';
    presetHead.textContent = 'プリセット';
    panel.append(presetHead, presetGrid);

    // 開始タイミング (レイヤー個別設定ではカット=「指定時刻に出現」なので常に表示)
    if (opts.includeDelay) {
      row('開始 (ms後)', num(() => anim.delay || 0, (v) => { anim.delay = Math.max(0, v); }, { step: '50' }));
    }

    if (anim.preset !== 'cut') {
      row('時間 (ms)', num(() => anim.duration !== undefined ? anim.duration : 350, (v) => { anim.duration = Math.max(0, v); }, { step: '50' }));
      row('イージング', select(this.ANIM_EASINGS, () => anim.easing || opts.defaultEasing || 'ease-out', (v) => { anim.easing = v; }));

      if (anim.preset === 'slide' || anim.preset === 'push') {
        row('方向', select(this.ANIM_DIRECTIONS, () => anim.direction || 'up', (v) => { anim.direction = v; }));
        row('距離 (px)', num(() => anim.distance !== undefined ? anim.distance : (anim.preset === 'push' ? 80 : 60), (v) => { anim.distance = v; }, { step: '10' }));
      }
      if (anim.preset === 'wipe') {
        row('拭き出し方向', select(this.ANIM_DIRECTIONS, () => anim.direction || 'right', (v) => { anim.direction = v; }));
      }
      if (anim.preset === 'pop' || anim.preset === 'zoom') {
        row('開始スケール', num(() => anim.scaleFrom !== undefined ? anim.scaleFrom : (anim.preset === 'zoom' ? 1.25 : 0.6), (v) => { anim.scaleFrom = v; }, { step: '0.05' }));
      }
      if (anim.preset === 'blur') {
        row('ぼかし量 (px)', num(() => anim.blurFrom !== undefined ? anim.blurFrom : 14, (v) => { anim.blurFrom = Math.max(0, v); }));
      }
      if (anim.preset === 'chars') {
        row('文字間隔 (ms)', num(() => anim.charDelay !== undefined ? anim.charDelay : 40, (v) => { anim.charDelay = Math.max(0, v); }, { step: '10' }));
        row('表示順', select([['forward', '先頭から順に'], ['random', 'ランダム']],
          () => anim.charOrder || 'forward', (v) => { anim.charOrder = v; }));
      }
    }

    if (opts.includeStagger) {
      row('順次ディレイ (ms)', num(() => anim.stagger || 0, (v) => { anim.stagger = Math.max(0, v); }, { step: '10' }));
    }
  },

  /**
   * 再生タイムライン (PowerPointのアニメーションウィンドウ相当)
   * 各レイヤーの開始タイミングと長さを横棒で可視化。行クリックでレイヤー選択。
   */
  renderTimeline(panel, dir) {
    const layers = this.layers().filter((l) => this.isShown(l));
    if (layers.length === 0) return;

    // アニメーション単位 (出力の TelopAnimator.units と同じ規則):
    // グループアニメーションを持つグループは1行、そのメンバーは個別設定があるものだけ行を持つ
    const units = [];
    const seen = new Set();
    let idx = 0;
    layers.forEach((layer) => {
      const g = this.groupById(layer.groupId);
      if (g && g.anim) {
        if (!seen.has(g.id)) {
          seen.add(g.id);
          units.push({ layer: g, index: idx++, isGroup: true });
          this.groupMembers(g.id).filter((m) => this.isShown(m) && m.anim)
            .forEach((m) => units.push({ layer: m, index: 0, member: true }));
        }
        return;
      }
      units.push({ layer, index: idx++ });
    });
    const items = units.map((u) => {
      const r = TelopAnimator.resolve(this.variant(), u.layer, u.index, dir);
      return {
        ...u,
        delay: r.delay,
        duration: r.anim.preset === 'cut' ? 0 : (r.anim.duration || 0),
        custom: r.custom,
      };
    });
    const total = Math.max(500, ...items.map((it) => it.delay + it.duration));

    const wrap = document.createElement('div');
    wrap.className = 'de-timeline';

    items.forEach((it) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'de-tl-row' + (it.isGroup ? ' de-tl-row--group' : '') + (it.member ? ' de-tl-row--member' : '');
      rowEl.title = `${it.layer.name || it.layer.id}: ${(it.delay / 1000).toFixed(2)}秒後に開始`
        + (it.duration ? ` / ${it.duration}ms` : ' (出現)') + (it.custom ? ' [個別設定]' : ' [既定]');

      const name = document.createElement('span');
      name.className = 'de-tl-name';
      name.textContent = (it.isGroup ? '▣ ' : '') + (it.layer.name || it.layer.id);

      // 既定/個別バッジ (個別はクリックで既定に戻せる)
      const badge = document.createElement('span');
      badge.className = 'de-tl-badge' + (it.custom ? ' de-tl-badge--custom' : '');
      badge.textContent = it.custom ? '個別' : '既定';
      badge.title = it.custom
        ? 'このレイヤーは個別設定です。クリックでテンプレートの既定に戻します'
        : 'テンプレートの既定設定で動きます (バーをドラッグすると個別設定になります)';
      if (it.custom) {
        badge.addEventListener('click', (e) => {
          e.stopPropagation();
          this.beginChange();
          delete it.layer.anim[dir];
          if (!it.layer.anim.in && !it.layer.anim.out) delete it.layer.anim;
          this.renderArtboard();
          this.renderProps();
          App.setStatus(`${it.layer.name || it.layer.id} の${dir.toUpperCase()}を既定に戻しました`, 'success');
        });
      }

      const track = document.createElement('div');
      track.className = 'de-tl-track';
      const bar = document.createElement('div');
      bar.className = 'de-tl-bar' + (it.custom ? ' de-tl-bar--custom' : '');
      bar.style.left = `${(it.delay / total) * 100}%`;
      bar.style.width = it.duration ? `${Math.max(2, (it.duration / total) * 100)}%` : '6px';
      bar.textContent = `${(it.delay / 1000).toFixed(2)}s`;
      track.appendChild(bar);

      // バー本体ドラッグ = 開始タイミング変更
      const index = it.index;
      bar.addEventListener('mousedown', (e) => {
        this.startTimelineDrag(e, { dir, layer: it.layer, index, bar, track, total, mode: 'move' });
      });

      // 右端グリップ = 長さ(時間)変更 (カット=出現のみは長さなし)
      if (it.duration > 0) {
        const grip = document.createElement('div');
        grip.className = 'de-tl-grip';
        grip.addEventListener('mousedown', (e) => {
          this.startTimelineDrag(e, { dir, layer: it.layer, index, bar, track, total, mode: 'resize' });
        });
        bar.appendChild(grip);
      }

      rowEl.append(name, badge, track);
      rowEl.addEventListener('click', () => {
        if (this._tlDragged) return; // ドラッグ直後のクリックは選択しない
        if (it.isGroup) this.selectGroup(it.layer.id); else this.selectLayer(it.layer.id);
        this.renderLayerList();
        this.renderProps();
        this.renderSelection();
      });
      wrap.appendChild(rowEl);
    });

    panel.appendChild(wrap);
  },

  /**
   * タイムラインバーのドラッグ (move=開始タイミング / resize=長さ)。
   * 既定設定のレイヤーをドラッグした場合は、実効値をコピーして個別設定へ自動変換する。
   */
  startTimelineDrag(e, ctx) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const pxPerMs = ctx.track.getBoundingClientRect().width / ctx.total;
    let started = false;
    let anim = null;
    let origDelay = 0;
    let origDuration = 0;
    let converted = false;

    const onMove = (ev) => {
      const dms = (ev.clientX - startX) / pxPerMs;
      if (!started) {
        if (Math.abs(ev.clientX - startX) < 3) return; // クリックと区別
        started = true;
        this._tlDragged = true;
        this.beginChange();

        // 既定レイヤーは実効値をコピーして個別設定に変換
        if (!ctx.layer.anim || !ctx.layer.anim[ctx.dir]) {
          const r = TelopAnimator.resolve(this.variant(), null, ctx.index, ctx.dir);
          const copied = Object.assign({}, r.anim, { delay: r.delay });
          delete copied.stagger;
          ctx.layer.anim = ctx.layer.anim || {};
          ctx.layer.anim[ctx.dir] = copied;
          converted = true;
        }
        anim = ctx.layer.anim[ctx.dir];
        origDelay = anim.delay || 0;
        origDuration = anim.duration !== undefined ? anim.duration : 350;
        ctx.bar.classList.add('de-tl-bar--custom');
      }

      // 10ms単位に丸める
      if (ctx.mode === 'move') {
        anim.delay = Math.max(0, Math.round((origDelay + dms) / 10) * 10);
      } else {
        anim.duration = Math.max(50, Math.round((origDuration + dms) / 10) * 10);
      }

      const dur = anim.preset === 'cut' ? 0 : (anim.duration || 0);
      ctx.bar.style.left = `${((anim.delay || 0) / ctx.total) * 100}%`;
      ctx.bar.style.width = dur ? `${Math.max(2, (dur / ctx.total) * 100)}%` : '6px';
      ctx.bar.firstChild.textContent = `${((anim.delay || 0) / 1000).toFixed(2)}s`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      if (started) {
        // 直後に発火するclickイベントの選択を抑止してからフラグを戻す
        setTimeout(() => { this._tlDragged = false; }, 0);
        this.renderProps(); // スケールを再計算してタイムラインを引き直す
        const label = ctx.layer.name || ctx.layer.id;
        App.setStatus(
          `${label}: ${ctx.mode === 'move' ? `開始 ${((anim.delay || 0) / 1000).toFixed(2)}秒` : `時間 ${anim.duration}ms`}`
          + (converted ? ' (個別設定に切り替えました)' : ''), 'success');
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  },

  /** アニメーション設定パネル (レイヤー未選択時) */
  renderAnimationProps(panel) {
    const variant = this.variant();
    variant.animation = variant.animation || {};

    const intro = document.createElement('div');
    intro.className = 'de-props-hint';
    intro.textContent = 'テンプレート全体のIN/OUTアニメーション設定です。タイムラインはバーをドラッグして開始タイミング、右端をドラッグして長さを調整できます (自動で個別設定に切り替わります)。行クリックでそのレイヤーの詳細設定へ。';
    panel.appendChild(intro);

    ['in', 'out'].forEach((dir) => {
      const anim = variant.animation[dir] = variant.animation[dir]
        || { preset: 'fade', duration: dir === 'in' ? 350 : 250, easing: dir === 'in' ? 'ease-out' : 'ease-in' };

      // セクション見出し + 試写ボタン
      const head = document.createElement('div');
      head.className = 'de-props-section de-anim-head';
      const title = document.createElement('span');
      title.textContent = dir === 'in' ? 'IN アニメーション (既定)' : 'OUT アニメーション (既定)';
      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn--small';
      playBtn.textContent = '▶試写';
      playBtn.addEventListener('click', () => this.playAnimation(dir));
      head.append(title, playBtn);
      panel.appendChild(head);

      this.renderAnimFields(panel, anim, {
        includeStagger: true,
        defaultEasing: dir === 'in' ? 'ease-out' : 'ease-in',
      });

      // 再生タイムライン
      const tlLabel = document.createElement('div');
      tlLabel.className = 'de-tl-label';
      tlLabel.textContent = `タイムライン (${dir.toUpperCase()})`;
      panel.appendChild(tlLabel);
      this.renderTimeline(panel, dir);
    });
  },

  /** ドラッグ中のX/Y/W/H入力欄だけ更新 */
  renderPropsValues() {
    if (this.targets().length > 1) {
      const b = this.boundsOf(this.targets());
      ['x', 'y', 'w', 'h'].forEach((prop) => {
        const input = document.querySelector(`#de-props [data-gprop="${prop}"]`);
        if (input && document.activeElement !== input) input.value = Math.round(b[prop]);
      });
      return;
    }
    const layer = this.selected();
    if (!layer) return;
    ['x', 'y', 'w', 'h'].forEach((prop) => {
      const input = document.querySelector(`#de-props [data-prop="${prop}"]`);
      if (input && document.activeElement !== input) input.value = layer[prop];
    });
  },
};

document.addEventListener('DOMContentLoaded', () => DesignEditor.init());
