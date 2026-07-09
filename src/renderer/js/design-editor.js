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
    ['pop', 'ポップ'], ['blur', 'ブラー'], ['chars', '文字送り'],
  ],
  ANIM_EASINGS: [
    ['ease-out', 'イーズアウト'], ['ease-in', 'イーズイン'], ['ease-in-out', 'イーズ両端'],
    ['ease', 'イーズ'], ['linear', 'リニア'], ['cubic-bezier(0.34,1.56,0.64,1)', 'バウンス'],
  ],
  ANIM_DIRECTIONS: [['up', '上へ'], ['down', '下へ'], ['left', '左へ'], ['right', '右へ']],

  /** Webフォント取得の候補 (Google Fontsの日本語対応+定番、[ファミリー, 取得ウェイト]) */
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
    ['Roboto', [400, 700]],
    ['Oswald', [400, 700]],
    ['Montserrat', [400, 700, 800]],
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
  loaded: false,

  init() {
    // ツールバー
    document.getElementById('de-template').addEventListener('change', (e) => {
      this.templateKey = e.target.value;
      this.selectedId = null;
      this.renderAll();
    });
    document.getElementById('de-lang-jp').addEventListener('click', () => this.setLang('jp'));
    document.getElementById('de-lang-en').addEventListener('click', () => this.setLang('en'));
    document.getElementById('de-zoom').addEventListener('change', (e) => {
      this.zoomMode = e.target.value;
      this.applyZoom();
      this.renderSelection();
    });
    document.getElementById('de-anim-settings').addEventListener('click', () => {
      this.selectedId = null;
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
    document.getElementById('de-undo').addEventListener('click', () => this.undo());
    document.getElementById('de-redo').addEventListener('click', () => this.redo());
    document.getElementById('de-reload').addEventListener('click', () => this.reload());
    document.getElementById('de-save').addEventListener('click', () => this.save());

    // レイヤー操作
    document.getElementById('de-layer-up').addEventListener('click', () => this.moveLayer(1));
    document.getElementById('de-layer-down').addEventListener('click', () => this.moveLayer(-1));
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
  },

  systemFonts: [],
  systemFontsLoaded: false,

  /** デザインタブ表示時 (初回にプロジェクトを読み込む) */
  async onShow() {
    if (!this.loaded) {
      await this.loadProject();
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
      opt.textContent = this.TEMPLATE_LABELS[key] || key;
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
      group.label = 'システムフォント';
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
      this.selectedId = null;
      await this.loadProject();
      App.setStatus('デザインをインポートし、出力へ反映しました', 'success');
    } else {
      App.setStatus(`インポートエラー: ${result.error}`, 'error');
    }
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

  region() {
    return this.project.templates[this.templateKey].region;
  },

  /** リージョンで使用可能なバインドフィールド一覧 */
  bindings() {
    if (this.region() === 'side') return ['textJp', 'textEn'];
    const list = [];
    ['', '2nd', '3rd', '4th'].forEach((prefix) => {
      ['Title', 'Name'].forEach((kind) => {
        ['Jp', 'En'].forEach((lng) => {
          list.push(prefix ? `${prefix}${kind}${lng}` : `${kind.toLowerCase()}${lng}`);
        });
      });
    });
    return list;
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
    this.renderAll();
  },

  // ===== 保存 / 再読込 =====

  async save() {
    const result = await window.api.graphicsSaveProject(this.project);
    if (result.ok) {
      this.dirty = false;
      this.updateStatus();
      App.setStatus('デザインを保存し、出力へ反映しました', 'success');
    } else {
      App.setStatus(`デザイン保存エラー: ${result.error}`, 'error');
    }
  },

  async reload() {
    if (this.dirty && !confirm('未保存の変更を破棄して再読込しますか?')) return;
    this.selectedId = null;
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
    this.selectedId = null;
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
  },

  renderAll() {
    if (!this.project) return;
    this.applyZoom();
    this.renderArtboard();
    this.renderLayerList();
    this.renderProps();
    this.renderSelection();
    this.updateStatus();
    this.updateServerBanner(typeof GraphicsUI !== 'undefined' ? GraphicsUI.status : null);
  },

  renderArtboard() {
    const canvas = document.getElementById('de-canvas');
    TelopRenderer.renderVariant(canvas, this.variant(), {}, {
      useSample: true,
      assetBase: this.assetBase(),
    });
  },

  /** レイヤーパネル (上=前面) */
  renderLayerList() {
    const list = document.getElementById('de-layer-list');
    list.innerHTML = '';
    const layers = this.layers();
    [...layers].reverse().forEach((layer) => {
      const li = document.createElement('li');
      li.className = 'de-layer-item';
      li.classList.toggle('selected', layer.id === this.selectedId);

      const visBtn = document.createElement('button');
      visBtn.className = 'de-layer-toggle';
      visBtn.textContent = layer.visible === false ? '‐' : '👁';
      visBtn.title = '表示/非表示';
      visBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.beginChange();
        layer.visible = layer.visible === false;
        this.renderAll();
      });

      const name = document.createElement('span');
      name.className = 'de-layer-name';
      name.textContent = layer.name || layer.id;

      const typeBadge = document.createElement('span');
      typeBadge.className = 'de-layer-type';
      typeBadge.textContent = { text: 'T', rect: '■', image: '🖼' }[layer.type] || '?';

      const lockBtn = document.createElement('button');
      lockBtn.className = 'de-layer-toggle';
      lockBtn.textContent = layer.locked ? '🔒' : '　';
      lockBtn.title = 'ロック';
      lockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.beginChange();
        layer.locked = !layer.locked;
        this.renderAll();
      });

      li.append(visBtn, typeBadge, name, lockBtn);
      li.addEventListener('click', () => {
        this.selectedId = layer.id;
        this.renderLayerList();
        this.renderProps();
        this.renderSelection();
      });
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
    const src = this.selected();
    if (!src) return;
    this.beginChange();
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = this.newLayerId();
    copy.name = `${src.name || src.id} コピー`;
    copy.x += 20;
    copy.y += 20;
    const idx = this.layers().indexOf(src);
    this.layers().splice(idx + 1, 0, copy);
    this.selectedId = copy.id;
    this.renderAll();
  },

  deleteLayer() {
    const layer = this.selected();
    if (!layer) return;
    this.beginChange();
    const layers = this.layers();
    layers.splice(layers.indexOf(layer), 1);
    this.selectedId = null;
    this.renderAll();
  },

  /** 重ね順変更 (+1=前面へ / -1=背面へ) */
  moveLayer(direction) {
    const layer = this.selected();
    if (!layer) return;
    const layers = this.layers();
    const idx = layers.indexOf(layer);
    const to = idx + direction;
    if (to < 0 || to >= layers.length) return;
    this.beginChange();
    layers.splice(idx, 1);
    layers.splice(to, 0, layer);
    this.renderAll();
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
      if (l.visible === false || l.locked) continue;
      if (pt.x >= l.x && pt.x <= l.x + l.w && pt.y >= l.y && pt.y <= l.y + l.h) return l;
    }
    return null;
  },

  onCanvasMouseDown(e) {
    if (e.button !== 0) return;
    const pt = this.canvasPoint(e);
    const layer = this.hitTest(pt);
    this.selectedId = layer ? layer.id : null;
    this.renderLayerList();
    this.renderProps();
    this.renderSelection();

    if (layer) {
      this.beginChange();
      this.drag = {
        kind: 'move',
        layer,
        startX: pt.x, startY: pt.y,
        origX: layer.x, origY: layer.y,
        moved: false,
      };
      e.preventDefault();
    }
  },

  startResize(e, handle) {
    const layer = this.selected();
    if (!layer) return;
    const pt = this.canvasPoint(e);
    this.beginChange();
    this.drag = {
      kind: 'resize', handle, layer,
      startX: pt.x, startY: pt.y,
      orig: { x: layer.x, y: layer.y, w: layer.w, h: layer.h },
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
      const layer = this.drag.layer;
      let nx = Math.round(this.drag.origX + dx);
      let ny = Math.round(this.drag.origY + dy);
      const snapped = this.applySnap(layer, nx, ny);
      layer.x = snapped.x;
      layer.y = snapped.y;
      this.drag.moved = true;
      this.updateLayerElement(layer);
      this.renderSelection();
    } else {
      const { handle, layer, orig } = this.drag;
      let { x, y, w, h } = orig;
      if (handle.includes('e')) w = orig.w + dx;
      if (handle.includes('s')) h = orig.h + dy;
      if (handle.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
      if (handle.includes('n')) { y = orig.y + dy; h = orig.h - dy; }
      layer.x = Math.round(w < 10 ? orig.x : x);
      layer.y = Math.round(h < 10 ? orig.y : y);
      layer.w = Math.round(Math.max(10, w));
      layer.h = Math.round(Math.max(10, h));
      this.updateLayerElement(layer);
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
  applySnap(layer, nx, ny) {
    const threshold = this.SNAP_PX / this.zoom;
    const guideV = document.getElementById('de-guide-v');
    const guideH = document.getElementById('de-guide-h');
    let snapV = null;
    let snapH = null;

    // スナップ先: キャンバスの端/中央 + 他レイヤーの端/中央
    const xTargets = [0, this.CANVAS_W / 2, this.CANVAS_W];
    const yTargets = [0, this.CANVAS_H / 2, this.CANVAS_H];
    this.layers().forEach((other) => {
      if (other === layer || other.visible === false) return;
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

    return { x: nx, y: ny };
  },

  hideGuides() {
    document.getElementById('de-guide-v').classList.add('hidden');
    document.getElementById('de-guide-h').classList.add('hidden');
  },

  /** ドラッグ中の軽量更新 (全再描画せずスタイルのみ) */
  updateLayerElement(layer) {
    const el = document.querySelector(`#de-canvas [data-layer-id="${layer.id}"]`);
    if (!el) return;
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.width = `${layer.w}px`;
    el.style.height = `${layer.h}px`;
  },

  renderSelection() {
    const box = document.getElementById('de-selection');
    const layer = this.selected();
    if (!layer) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
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

    // Escで選択解除 (アニメーション設定パネルに戻る)
    if (e.key === 'Escape' && this.selectedId) {
      e.preventDefault();
      this.selectedId = null;
      this.renderAll();
      return;
    }

    const layer = this.selected();
    if (!layer) return;

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
      layer.x += moves[e.key][0];
      layer.y += moves[e.key][1];
      this.updateLayerElement(layer);
      this.renderSelection();
      this.renderPropsValues();
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
    if (!confirm(`「${this.TEMPLATE_LABELS[this.templateKey] || this.templateKey}」のJPレイアウトをENへコピーします。\nENの現在のレイアウトは上書きされます。よろしいですか?`)) return;
    this.beginChange();
    const template = this.project.templates[this.templateKey];
    const copy = JSON.parse(JSON.stringify(template.variants.jp));
    // バインドをEN側フィールドへ変換 (titleJp→titleEn, textJp→textEn など)
    copy.layers.forEach((layer) => {
      if (layer.type === 'text' && layer.binding) {
        layer.binding = layer.binding.replace(/Jp$/, 'En');
      }
    });
    template.variants.en = copy;
    if (this.lang === 'en') this.renderAll();
    App.setStatus('JPレイアウトをENへコピーしました (バインドはEN側フィールドに変換)', 'success');
    this.updateStatus();
  },

  // ===== プロパティパネル =====

  renderProps() {
    const panel = document.getElementById('de-props');
    const layer = this.selected();
    panel.innerHTML = '';
    if (!layer) {
      // レイヤー未選択時はテンプレートのアニメーション設定を表示
      this.renderAnimationProps(panel);
      return;
    }

    const section = (title) => {
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
      num(() => layer.w, (v) => { layer.w = Math.max(10, v); }, { 'data-prop': 'w' }),
      num(() => layer.h, (v) => { layer.h = Math.max(10, v); }, { 'data-prop': 'h' }));
    row('回転 / 不透明',
      num(() => layer.rotation || 0, (v) => { layer.rotation = v; }),
      num(() => Math.round((layer.opacity !== undefined ? layer.opacity : 1) * 100), (v) => { layer.opacity = Math.max(0, Math.min(100, v)) / 100; }, { min: 0, max: 100 }));

    // キャンバス基準の整列ボタン
    const alignBtn = (label, title, apply) => {
      const btn = document.createElement('button');
      btn.className = 'btn btn--small de-align-btn';
      btn.textContent = label;
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
      alignBtn('左', '左端へ', () => { layer.x = 0; }),
      alignBtn('中央', '水平中央へ', () => { layer.x = Math.round((this.CANVAS_W - layer.w) / 2); }),
      alignBtn('右', '右端へ', () => { layer.x = this.CANVAS_W - layer.w; }));
    row('整列 (縦)',
      alignBtn('上', '上端へ', () => { layer.y = 0; }),
      alignBtn('中央', '垂直中央へ', () => { layer.y = Math.round((this.CANVAS_H - layer.h) / 2); }),
      alignBtn('下', '下端へ', () => { layer.y = this.CANVAS_H - layer.h; }));

    // --- テキスト ---
    if (layer.type === 'text') {
      section('テキスト');
      const bindOptions = [['', '(固定テキスト)']].concat(this.bindings().map((b) => [b, b]));
      row('バインド', select(bindOptions, () => layer.binding || '', (v) => { layer.binding = v; }));
      row('固定テキスト', text(() => layer.text, (v) => { layer.text = v; }));
      row('サンプル', text(() => layer.sample, (v) => { layer.sample = v; }));

      layer.font = layer.font || {};
      section('フォント');
      row('ファミリー', this.fontFamilySelect(layer));
      row('サイズ / 太さ',
        num(() => layer.font.size || 30, (v) => { layer.font.size = Math.max(4, v); }),
        select([['400', '標準'], ['500', '中'], ['700', '太字'], ['800', '極太'], ['900', '最太']],
          () => String(layer.font.weight || 700), (v) => { layer.font.weight = parseInt(v, 10); }));
      row('色', color(() => layer.font.color, (v) => { layer.font.color = v; }));
      row('字間 / 行間',
        num(() => layer.font.letterSpacing || 0, (v) => { layer.font.letterSpacing = v; }, { step: '0.01' }),
        num(() => layer.font.lineHeight || 1.25, (v) => { layer.font.lineHeight = Math.max(0.5, v); }, { step: '0.05' }));
      row('揃え',
        select([['left', '左'], ['center', '中央'], ['right', '右']], () => layer.align || 'left', (v) => { layer.align = v; }),
        select([['top', '上'], ['middle', '中央'], ['bottom', '下']], () => layer.vAlign || 'middle', (v) => { layer.vAlign = v; }));
      row('自動調整', select(
        [['none', 'なし'], ['condense', '長体 (横に圧縮して収める)'], ['shrink', '縮小 (フォントを小さくして収める)']],
        () => layer.autoFit || 'none', (v) => { layer.autoFit = v; }));

      section('縁取り / 影');
      layer.stroke = layer.stroke || { width: 0, color: '#000000' };
      row('縁取り 太さ/色',
        num(() => layer.stroke.width || 0, (v) => { layer.stroke.width = Math.max(0, v); }, { step: '0.5' }),
        color(() => layer.stroke.color, (v) => { layer.stroke.color = v; }));
      const hasShadow = !!layer.shadow;
      row('影', select([['off', 'なし'], ['on', 'あり']], () => (hasShadow ? 'on' : 'off'), (v) => {
        layer.shadow = v === 'on' ? (layer.shadow || { x: 2, y: 2, blur: 6, color: 'rgba(0,0,0,0.6)' }) : null;
        this.renderProps();
      }));
      if (layer.shadow) {
        row('影 X/Y/ぼかし',
          num(() => layer.shadow.x, (v) => { layer.shadow.x = v; }),
          num(() => layer.shadow.y, (v) => { layer.shadow.y = v; }),
          num(() => layer.shadow.blur, (v) => { layer.shadow.blur = Math.max(0, v); }));
        row('影 色', text(() => layer.shadow.color, (v) => { layer.shadow.color = v; }));
      }
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

    // プリセット (変更時はパネルを再描画して関連パラメータを出し分け)
    row('プリセット', select(this.ANIM_PRESETS, () => anim.preset || 'fade', (v) => { anim.preset = v; }, true));

    // 開始タイミング (レイヤー個別設定ではカット=「指定時刻に出現」なので常に表示)
    if (opts.includeDelay) {
      row('開始 (ms後)', num(() => anim.delay || 0, (v) => { anim.delay = Math.max(0, v); }, { step: '50' }));
    }

    if (anim.preset !== 'cut') {
      row('時間 (ms)', num(() => anim.duration !== undefined ? anim.duration : 350, (v) => { anim.duration = Math.max(0, v); }, { step: '50' }));
      row('イージング', select(this.ANIM_EASINGS, () => anim.easing || opts.defaultEasing || 'ease-out', (v) => { anim.easing = v; }));

      if (anim.preset === 'slide') {
        row('方向', select(this.ANIM_DIRECTIONS, () => anim.direction || 'up', (v) => { anim.direction = v; }));
        row('距離 (px)', num(() => anim.distance !== undefined ? anim.distance : 60, (v) => { anim.distance = v; }, { step: '10' }));
      }
      if (anim.preset === 'wipe') {
        row('拭き出し方向', select(this.ANIM_DIRECTIONS, () => anim.direction || 'right', (v) => { anim.direction = v; }));
      }
      if (anim.preset === 'pop') {
        row('開始スケール', num(() => anim.scaleFrom !== undefined ? anim.scaleFrom : 0.6, (v) => { anim.scaleFrom = v; }, { step: '0.1' }));
      }
      if (anim.preset === 'blur') {
        row('ぼかし量 (px)', num(() => anim.blurFrom !== undefined ? anim.blurFrom : 14, (v) => { anim.blurFrom = Math.max(0, v); }));
      }
      if (anim.preset === 'chars') {
        row('文字間隔 (ms)', num(() => anim.charDelay !== undefined ? anim.charDelay : 40, (v) => { anim.charDelay = Math.max(0, v); }, { step: '10' }));
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
    const layers = this.layers().filter((l) => l.visible !== false);
    if (layers.length === 0) return;

    const items = layers.map((layer, i) => {
      const r = TelopAnimator.resolve(this.variant(), layer, i, dir);
      return {
        layer,
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
      rowEl.className = 'de-tl-row';
      rowEl.title = `${it.layer.name || it.layer.id}: ${(it.delay / 1000).toFixed(2)}秒後に開始`
        + (it.duration ? ` / ${it.duration}ms` : ' (出現)') + (it.custom ? ' [個別設定]' : ' [既定]');

      const name = document.createElement('span');
      name.className = 'de-tl-name';
      name.textContent = it.layer.name || it.layer.id;

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
      const index = layers.indexOf(it.layer);
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
        this.selectedId = it.layer.id;
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
    const layer = this.selected();
    if (!layer) return;
    ['x', 'y', 'w', 'h'].forEach((prop) => {
      const input = document.querySelector(`#de-props [data-prop="${prop}"]`);
      if (input && document.activeElement !== input) input.value = layer[prop];
    });
  },
};

document.addEventListener('DOMContentLoaded', () => DesignEditor.init());
