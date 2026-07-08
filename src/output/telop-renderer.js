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

    variant.layers.forEach((layer) => {
      if (layer.visible === false) return;
      const el = buildLayer(layer, values || {}, assetBase, opts);
      if (el) container.appendChild(el);
    });
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
    el.textContent = value || '';

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

    if (layer.shadow) {
      const s = layer.shadow;
      el.style.textShadow = `${s.x || 0}px ${s.y || 0}px ${s.blur || 0}px ${s.color || 'rgba(0,0,0,0.6)'}`;
    }
    if (layer.stroke && layer.stroke.width) {
      el.style.webkitTextStroke = `${layer.stroke.width}px ${layer.stroke.color || '#000000'}`;
    }
  }

  global.TelopRenderer = { renderVariant };
})(typeof window !== 'undefined' ? window : globalThis);
