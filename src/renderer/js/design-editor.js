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
  gridSize: 0,         // グリッド間隔 (px, 0=非表示)
  safety: false,       // セーフティエリア表示
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
      this.selectedId = null;
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
      this.safety = e.target.checked;
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
    this.selectedId = null;
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
      this.selectedId = null;
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
    this.selectedId = null;
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
    this.selectedId = null;
    this.refreshTemplateSelect();
    this.renderAll();
    App.setStatus(`テンプレート「${name}」を追加しました (保存で送出タブでも使えます)`, 'success');
  },

  renameTemplate() {
    const name = prompt('テンプレート名', this.templateLabel(this.templateKey));
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
    this.selectedId = null;
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
    for (const layer of (variant && variant.layers) || []) {
      if (layer.visible === false) continue;
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
      group.label = 'システムフォント';
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
      this.updateSetThumb(); // セット一覧用サムネイルを更新 (非同期・失敗は無視)
      if (typeof RundownUI !== 'undefined' && RundownUI.loaded) RundownUI.refreshTemplates();
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
    const safety = document.getElementById('de-safety-box');
    if (safety) safety.classList.toggle('hidden', !this.safety);
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
      visBtn.title = layer.visible === false ? '非表示中 — クリックで表示' : '表示中 — クリックで非表示';
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
      typeBadge.title = { text: 'テキストレイヤー', rect: '図形レイヤー', image: '画像レイヤー' }[layer.type] || 'レイヤー';

      const lockBtn = document.createElement('button');
      lockBtn.className = `de-layer-toggle${layer.locked ? '' : ' de-layer-toggle--off'}`;
      lockBtn.textContent = layer.locked ? '🔒' : '🔓';
      lockBtn.title = layer.locked ? 'ロック中 — クリックで解除' : 'クリックでロック (編集不可にする)';
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

  /** 最前面/最背面へ移動 */
  moveLayerEnd(front) {
    const layer = this.selected();
    if (!layer) return;
    const layers = this.layers();
    const idx = layers.indexOf(layer);
    if (idx < 0 || (front && idx === layers.length - 1) || (!front && idx === 0)) return;
    this.beginChange();
    layers.splice(idx, 1);
    if (front) layers.push(layer); else layers.unshift(layer);
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
      if (this.gridSize > 0 && !snapped.guided) {
        layer.x = Math.round(layer.x / this.gridSize) * this.gridSize;
        layer.y = Math.round(layer.y / this.gridSize) * this.gridSize;
      }
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
    if (!confirm(`「${this.templateLabel(this.templateKey)}」のJPレイアウトをENへコピーします。\nENの現在のレイアウトは上書きされます。よろしいですか?`)) return;
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

      // スタイルパレット: 名前を付けて保存し、どのデザインセットでも使い回せる
      const presetSel = document.createElement('select');
      presetSel.className = 'input input--small de-style-preset-select';
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = this.stylePresets.length ? '(スタイルを選択)' : '(登録なし)';
      presetSel.appendChild(noneOpt);
      this.stylePresets.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        presetSel.appendChild(opt);
      });
      const applyPresetBtn = document.createElement('button');
      applyPresetBtn.className = 'btn btn--small';
      applyPresetBtn.textContent = '適用';
      applyPresetBtn.title = '選択したスタイルをこのレイヤーへ適用';
      applyPresetBtn.addEventListener('click', () => {
        const preset = this.stylePresets.find((p) => p.id === presetSel.value);
        if (!preset) return;
        this.beginChange();
        this.applyStyle(layer, preset.style);
        this.renderArtboard();
        this.renderProps();
        App.setStatus(`スタイル「${preset.name}」を適用しました`, 'success');
      });
      row('スタイル集', presetSel, applyPresetBtn);

      const regBtn = document.createElement('button');
      regBtn.className = 'btn btn--small';
      regBtn.textContent = 'このレイヤーの装飾を登録...';
      regBtn.title = '現在の装飾をスタイル集に登録 (全デザインセット共通で使えます)';
      regBtn.addEventListener('click', async () => {
        if (!window.api.graphicsStylePresetAdd) return;
        const name = prompt('スタイル名を入力してください (例: 金グラデ二重縁)');
        if (!name) return;
        await window.api.graphicsStylePresetAdd(name, this.captureStyle(layer));
        await this.refreshStylePresets();
        this.renderProps();
        App.setStatus(`スタイル「${name}」を登録しました`, 'success');
      });
      const delPresetBtn = document.createElement('button');
      delPresetBtn.className = 'btn btn--small';
      delPresetBtn.textContent = '削除';
      delPresetBtn.title = '選択中のスタイルをスタイル集から削除';
      delPresetBtn.addEventListener('click', async () => {
        const preset = this.stylePresets.find((p) => p.id === presetSel.value);
        if (!preset || !window.api.graphicsStylePresetDelete) return;
        if (!confirm(`スタイル「${preset.name}」を削除しますか?`)) return;
        await window.api.graphicsStylePresetDelete(preset.id);
        await this.refreshStylePresets();
        this.renderProps();
      });
      row('', regBtn, delPresetBtn);
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
