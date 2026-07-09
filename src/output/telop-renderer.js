/**
 * テロップレンダラー (共通モジュール)
 *
 * テンプレートのレイヤー定義をDOMに描画する。
 * 出力ページと(Phase 2以降の)デザインエディタの両方から使用し、
 * 「編集画面で見えるもの = 出力に出るもの」のWYSIWYGを保証する。
 */
(function (global) {
  /**
   * バリアント(言語ごとのレイアウト)をコンテナへ描画する
   * @param {HTMLElement} container 描画先 (中身はクリアされる)
   * @param {Object} variant  { layers: [...] }
   * @param {Object} values   テキストレイヤーのbindingに対する値 { titleJp: '...', ... }
   * @param {Object} [options] { assetBase: '/assets/', useSample: false }
   */
  function renderVariant(container, variant, values, options) {
    const opts = options || {};
    const assetBase = opts.assetBase || '/assets/';
    container.innerHTML = '';
    if (!variant || !variant.layers) return;

    const fitQueue = [];
    variant.layers.forEach((layer) => {
      if (layer.visible === false) return;
      const el = buildLayer(layer, values || {}, assetBase, opts);
      if (!el) return;
      container.appendChild(el);
      if (layer.type === 'text' && layer.autoFit && layer.autoFit !== 'none') {
        fitQueue.push([el, layer]);
      }
    });

    // 自動調整 (縮小/長体) — DOM接続後に計測する
    fitQueue.forEach(([el, layer]) => fitText(el, layer));

    // Webフォント読込後に文字幅が変わるため再調整
    if (fitQueue.length && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(() => {
        fitQueue.forEach(([el, layer]) => {
          if (el.isConnected) fitText(el, layer);
        });
      });
    }
  }

  function buildLayer(layer, values, assetBase, opts) {
    const el = document.createElement('div');
    el.className = 'tl-layer';
    el.dataset.layerId = layer.id;
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.width = `${layer.w}px`;
    el.style.height = `${layer.h}px`;
    if (layer.opacity !== undefined && layer.opacity !== 1) el.style.opacity = layer.opacity;
    if (layer.rotation) el.style.transform = `rotate(${layer.rotation}deg)`;

    if (layer.type === 'rect') {
      applyRect(el, layer);
    } else if (layer.type === 'image') {
      applyImage(el, layer, assetBase);
    } else if (layer.type === 'text') {
      applyText(el, layer, values, opts);
    }
    return el;
  }

  function applyRect(el, layer) {
    const fill = layer.fill || {};
    if (fill.type === 'gradient') {
      el.style.background = `linear-gradient(${fill.angle !== undefined ? fill.angle : 180}deg, ${fill.from}, ${fill.to})`;
    } else {
      el.style.background = fill.color || '#000000';
    }
    if (layer.border && layer.border.width) {
      el.style.border = `${layer.border.width}px solid ${layer.border.color || '#ffffff'}`;
    }
    if (layer.radius) el.style.borderRadius = `${layer.radius}px`;
  }

  function applyImage(el, layer, assetBase) {
    const img = document.createElement('img');
    img.src = layer.file ? assetBase + encodeURIComponent(layer.file) : '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = layer.objectFit || 'fill';
    img.draggable = false;
    el.appendChild(img);
  }

  function applyText(el, layer, values, opts) {
    el.classList.add('tl-text');

    let value = layer.binding ? values[layer.binding] : layer.text;
    if ((value === undefined || value === null || value === '') && opts.useSample) {
      value = layer.sample || '';
    }
    // 自動調整の計測用に内側spanへ入れる
    const inner = document.createElement('span');
    inner.className = 'tl-text-inner';
    inner.textContent = value || '';
    // 自動調整時は折り返しを禁止 (折り返すと横のはみ出しを検出できない。改行は明示的な改行のみ)
    if (layer.autoFit && layer.autoFit !== 'none') inner.style.whiteSpace = 'pre';
    el.appendChild(inner);

    const font = layer.font || {};
    el.style.fontFamily = font.family || 'sans-serif';
    el.style.fontSize = `${font.size || 30}px`;
    el.style.fontWeight = font.weight || 700;
    el.style.color = font.color || '#ffffff';
    if (font.letterSpacing) el.style.letterSpacing = `${font.letterSpacing}em`;
    el.style.lineHeight = font.lineHeight || 1.25;

    // 揃え (flexで水平/垂直とも制御)
    const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
    const vAlignMap = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
    el.style.justifyContent = alignMap[layer.align] || 'flex-start';
    el.style.alignItems = vAlignMap[layer.vAlign] || 'center';
    el.style.textAlign = layer.align || 'left';

    // 縁取り(外側)と影は text-shadow を重ねて表現する
    // (-webkit-text-stroke は中央基準で文字の内側に食い込むため使用しない)
    const shadows = [];
    if (layer.stroke && layer.stroke.width > 0) {
      shadows.push(...outlineShadows(layer.stroke.width, layer.stroke.color || '#000000'));
    }
    if (layer.shadow) {
      const s = layer.shadow;
      shadows.push(`${s.x || 0}px ${s.y || 0}px ${s.blur || 0}px ${s.color || 'rgba(0,0,0,0.6)'}`);
    }
    if (shadows.length) el.style.textShadow = shadows.join(', ');
  }

  /**
   * 外側縁取り用のtext-shadow群を生成する。
   * 文字の周囲に多方向のシャドウ(ぼかしなし)を並べてアウトラインを作る。
   * 文字本体はシャドウの手前に描画されるため、線は外側にのみ付く。
   */
  function outlineShadows(width, color) {
    const shadows = [];
    const radii = width > 3 ? [width, width * 0.6] : [width];
    radii.forEach((r) => {
      const steps = Math.min(48, Math.max(16, Math.round(r * 10)));
      for (let i = 0; i < steps; i++) {
        const angle = (Math.PI * 2 * i) / steps;
        const x = (Math.cos(angle) * r).toFixed(2);
        const y = (Math.sin(angle) * r).toFixed(2);
        shadows.push(`${x}px ${y}px 0 ${color}`);
      }
    });
    return shadows;
  }

  /**
   * テキストの自動調整
   *   shrink:   枠に収まるまでフォントサイズを縮小
   *   condense: 長体 (横方向のみ圧縮 — 放送テロップの定番)
   */
  function fitText(el, layer) {
    const inner = el.querySelector('.tl-text-inner');
    if (!inner || !inner.textContent) return;

    // リセットしてから計測
    inner.style.transform = '';
    el.style.fontSize = `${(layer.font && layer.font.size) || 30}px`;
    const contentW = inner.scrollWidth;
    if (!contentW || !el.clientWidth) return;

    if (layer.autoFit === 'condense') {
      const ratio = el.clientWidth / contentW;
      if (ratio < 1) {
        const originMap = { left: 'left center', center: 'center center', right: 'right center' };
        inner.style.transformOrigin = originMap[layer.align] || 'left center';
        inner.style.transform = `scaleX(${ratio})`;
      }
      return;
    }

    // shrink: 幅と高さの両方が収まる倍率にフォントサイズを縮小
    const ratioW = el.clientWidth / contentW;
    const ratioH = el.clientHeight / (inner.scrollHeight || 1);
    const ratio = Math.min(1, ratioW, ratioH);
    if (ratio < 1) {
      const size = (layer.font && layer.font.size) || 30;
      el.style.fontSize = `${Math.max(8, Math.floor(size * ratio))}px`;
    }
  }

  /**
   * 持ち込み/Webフォントをドキュメントへ適用する
   * @param {Array<{family: string, file?: string, cssFile?: string}>} fonts
   *   file: フォントファイル単体 (@font-faceを生成)
   *   cssFile: Google Fonts等から取得したCSS (unicode-range分割等をそのまま<link>で読込)
   * @param {string} assetBase 素材の配信ベースURL
   */
  function applyFonts(fonts, assetBase) {
    // 前回適用分を除去
    document.querySelectorAll('link.tl-font-node').forEach((n) => n.remove());
    let style = document.getElementById('tl-fonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'tl-fonts';
      document.head.appendChild(style);
    }
    style.textContent = (fonts || [])
      .filter((f) => f.family && f.file)
      .map((f) => `@font-face { font-family: ${JSON.stringify(f.family)}; src: url("${assetBase}${encodeURIComponent(f.file)}"); }`)
      .join('\n');

    (fonts || []).filter((f) => f.cssFile).forEach((f) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.className = 'tl-font-node';
      link.href = assetBase + encodeURIComponent(f.cssFile);
      document.head.appendChild(link);
    });
  }

  global.TelopRenderer = { renderVariant, applyFonts };
})(typeof window !== 'undefined' ? window : globalThis);
