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

    // 図形の種類 (rect以外はclip-path/角丸で切り抜く)
    if (layer.shape === 'ellipse') {
      el.style.borderRadius = '50%';
    } else if (layer.shape === 'polygon' || layer.shape === 'star') {
      const pts = shapePoints(layer)
        .map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
      el.style.clipPath = `polygon(${pts.join(', ')})`;
    }
  }

  /**
   * 正多角形/星形の頂点座標 (0..1正規化) を返す
   * layer.sides=頂点数(3..24), layer.starInset=星の谷の深さ(0.2..0.9, 既定0.5)
   */
  function shapePoints(layer) {
    const n = Math.max(3, Math.min(24, layer.sides || 5));
    const pts = [];
    if (layer.shape === 'star') {
      const inner = Math.max(0.1, Math.min(0.9, layer.starInset !== undefined ? layer.starInset : 0.5)) * 0.5;
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? 0.5 : inner;
        const a = -Math.PI / 2 + (Math.PI * i) / n;
        pts.push([0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
        pts.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
      }
    }
    return pts;
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
    const richOpts = { vertical: !!layer.vertical, tcy: !!layer.vertical && layer.tcy !== false };
    const rich = fillRichText(inner, value || '', richOpts);
    if (rich) inner.dataset.noSplit = '1'; // ルビ/縦中横はcharsアニメの分割不可
    // 自動調整時は折り返しを禁止 (折り返すと横のはみ出しを検出できない。改行は明示的な改行のみ)
    if (layer.autoFit && layer.autoFit !== 'none') inner.style.whiteSpace = 'pre';
    el.appendChild(inner);

    const font = layer.font || {};
    el.style.fontFamily = font.family || 'sans-serif';
    el.style.fontSize = `${font.size || 30}px`;
    el.style.fontWeight = font.weight || 700;
    el.style.color = font.color || '#ffffff';
    if (font.italic) el.style.fontStyle = 'italic';
    if (font.letterSpacing) el.style.letterSpacing = `${font.letterSpacing}em`;
    el.style.lineHeight = font.lineHeight || 1.25;

    // 縦書き (縦中横はfillRichTextで数字連続をspan化済み)
    if (layer.vertical) {
      el.style.writingMode = 'vertical-rl';
      inner.dataset.noSplit = '1';
    }

    // 揃え (flexで水平/垂直とも制御。縦書き時は論理方向に従う)
    const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'flex-start' };
    const vAlignMap = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
    el.style.justifyContent = alignMap[layer.align] || 'flex-start';
    el.style.alignItems = vAlignMap[layer.vAlign] || 'center';
    el.style.textAlign = layer.align === 'justify' ? 'justify' : (layer.align || 'left');

    // 均等割り付け: 行を枠幅いっぱいに割り付ける
    if (layer.align === 'justify') {
      if (layer.vertical) inner.style.height = '100%';
      else inner.style.width = '100%';
      inner.style.textAlignLast = 'justify';
    }

    // 変体率 (横幅率/縦幅率) と歪み (transformで表現。長体autoFitはfitTextで合成)
    const baseT = innerBaseTransform(layer);
    if (baseT) {
      inner.style.transform = baseT;
      inner.style.transformOrigin = transformOrigin(layer);
    }

    // 縁取り(外側)と影は text-shadow を重ねて表現する
    // (-webkit-text-stroke は中央基準で文字の内側に食い込むため使用しない)
    const strokes = Array.isArray(layer.strokes)
      ? layer.strokes.filter((s) => s && s.width > 0)
      : (layer.stroke && layer.stroke.width > 0 ? [layer.stroke] : []);
    const shadows = edgeShadows(strokes);
    if (layer.shadow) {
      const s = layer.shadow;
      let dx = s.x || 0;
      let dy = s.y || 0;
      if (s.distance !== undefined) {
        const rad = ((s.angle !== undefined ? s.angle : 45) * Math.PI) / 180;
        dx = Math.cos(rad) * s.distance;
        dy = Math.sin(rad) * s.distance;
      }
      shadows.push(`${(+dx).toFixed(1)}px ${(+dy).toFixed(1)}px ${s.blur || 0}px ${s.color || 'rgba(0,0,0,0.6)'}`);
    }

    // 座布団 (文字にフィットする背景) — fitは文字サイズ追従、fixedはレイヤー枠全体
    if (layer.board && layer.board.enabled) {
      const b = layer.board;
      const bg = b.fill && b.fill.type === 'gradient'
        ? `linear-gradient(${b.fill.angle !== undefined ? b.fill.angle : 180}deg, ${b.fill.from}, ${b.fill.to})`
        : ((b.fill && b.fill.color) || b.color || '#0d6ab7');
      const target = b.mode === 'fixed' ? el : inner;
      target.style.background = bg;
      if (b.radius) target.style.borderRadius = `${b.radius}px`;
      if (b.mode !== 'fixed') {
        inner.style.padding = `${b.padY !== undefined ? b.padY : 6}px ${b.padX !== undefined ? b.padX : 18}px`;
      }
    }

    // 文字のグラデーション塗り (background-clip: text)
    // 縁取り/影と併用する場合、透明文字にはシャドウが透けるため
    // 下層(縁取り担当)+上層(グラデーション担当)の二層構造にする
    const gradCss = layer.fill && layer.fill.type === 'gradient'
      ? `linear-gradient(${layer.fill.angle !== undefined ? layer.fill.angle : 180}deg, ${layer.fill.from}, ${layer.fill.to})`
      : null;
    if (gradCss) {
      // 常に二層構造にする: inner直体にclipを掛けると座布団背景まで
      // 文字型に切り抜かれ、透明文字にはシャドウが透けるため
      inner.dataset.noSplit = '1'; // charsアニメの文字分割はグラデーションを壊すため不可
      inner.textContent = '';
      const under = document.createElement('span');
      under.className = 'tl-txt-under';
      fillRichText(under, value || '', richOpts);
      if (shadows.length) under.style.textShadow = shadows.join(', ');
      const fillSpan = document.createElement('span');
      fillSpan.className = 'tl-txt-fill';
      fillRichText(fillSpan, value || '', richOpts);
      applyTextGradient(fillSpan, gradCss);
      inner.appendChild(under);
      inner.appendChild(fillSpan);
    } else if (shadows.length) {
      el.style.textShadow = shadows.join(', ');
    }
  }

  function applyTextGradient(node, gradCss) {
    node.style.backgroundImage = gradCss;
    node.style.webkitBackgroundClip = 'text';
    node.style.backgroundClip = 'text';
    node.style.webkitTextFillColor = 'transparent';
  }

  /**
   * ルビ記法・縦中横を解釈してテキストをノードに流し込む。
   *   ルビ:   【文字|よみ】 → <ruby>文字<rt>よみ</rt></ruby>
   *   縦中横: 縦書き時、1〜3桁の数字を横組みにする (<span class="tl-tcy">)
   * @returns {boolean} リッチ要素 (ruby/tcy) を使ったか
   */
  function fillRichText(node, value, opts) {
    node.textContent = '';
    let rich = false;
    const appendPlain = (text) => {
      if (!text) return;
      if (opts && opts.tcy) {
        text.split(/(\d+)/).forEach((seg) => {
          if (!seg) return;
          if (/^\d{1,3}$/.test(seg)) {
            const tcy = document.createElement('span');
            tcy.className = 'tl-tcy';
            tcy.textContent = seg;
            node.appendChild(tcy);
            rich = true;
          } else {
            node.appendChild(document.createTextNode(seg));
          }
        });
      } else {
        node.appendChild(document.createTextNode(text));
      }
    };
    const parts = String(value).split(/【([^【】|]+)\|([^【】]+)】/g);
    for (let i = 0; i < parts.length; i += 3) {
      appendPlain(parts[i]);
      if (i + 2 < parts.length) {
        const ruby = document.createElement('ruby');
        ruby.appendChild(document.createTextNode(parts[i + 1]));
        const rt = document.createElement('rt');
        rt.textContent = parts[i + 2];
        ruby.appendChild(rt);
        node.appendChild(ruby);
        rich = true;
      }
    }
    return rich;
  }

  /** 変体率 (scaleX/scaleY) と歪み (skewX) のtransform文字列 */
  function innerBaseTransform(layer) {
    const font = layer.font || {};
    const parts = [];
    if (font.skewX) parts.push(`skewX(${-font.skewX}deg)`);
    const sx = font.scaleX !== undefined ? font.scaleX : 1;
    const sy = font.scaleY !== undefined ? font.scaleY : 1;
    if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
    return parts.join(' ');
  }

  function transformOrigin(layer) {
    if (layer.vertical) {
      const map = { left: 'center top', center: 'center center', right: 'center bottom' };
      return map[layer.align] || 'center top';
    }
    const map = { left: 'left center', center: 'center center', right: 'right center' };
    return map[layer.align] || 'left center';
  }

  /**
   * 外側縁取り用のtext-shadow群を生成する (多重エッジ対応)。
   * 文字の周囲に多方向のシャドウ(ぼかしなし)を並べてアウトラインを作る。
   * 文字本体はシャドウの手前に描画されるため、線は外側にのみ付く。
   * 複数エッジは内側から順に指定し、先に並べたシャドウが手前に描画される
   * 性質を使って「内側エッジが外側エッジの上に重なる」層構造を作る。
   * @param {Array<{width: number, color: string}>} strokes 内側→外側の順
   */
  function edgeOffsets(strokes) {
    const offsets = [];
    let cum = 0;
    (strokes || []).forEach((s) => {
      const prev = cum;
      cum += s.width;
      const color = s.color || '#000000';
      const band = cum - prev;
      const radii = band > 3 ? [cum, prev + band * 0.6] : [cum];
      radii.forEach((r) => {
        const steps = Math.min(48, Math.max(16, Math.round(r * 10)));
        for (let i = 0; i < steps; i++) {
          const angle = (Math.PI * 2 * i) / steps;
          offsets.push({
            x: +(Math.cos(angle) * r).toFixed(2),
            y: +(Math.sin(angle) * r).toFixed(2),
            color,
          });
        }
      });
    });
    return offsets;
  }

  function edgeShadows(strokes) {
    return edgeOffsets(strokes).map((o) => `${o.x}px ${o.y}px 0 ${o.color}`);
  }

  /** 字詰め (tracking) の既定パラメータ */
  const TRACK_MAX_DEFAULT = 0.35; // 短文時に広げる字間の上限 (em, 最終値)
  const TRACK_MIN_DEFAULT = -0.08; // 長文時に詰める字間の下限 (em, 最終値)

  /**
   * テキストの自動調整
   *   shrink:   枠に収まるまでフォントサイズを縮小
   *   condense: 長体 (横方向のみ圧縮 — 放送テロップの定番)
   *   tracking: 字詰め — 短文は字間を広げ (上限あり・均等割付とは異なり端まで強制しない)、
   *             長文は字間を詰めてから長体で収める
   */
  function fitText(el, layer) {
    const inner = el.querySelector('.tl-text-inner');
    if (!inner || !inner.textContent) return;
    if (layer.align === 'justify') return; // 均等割り付けは常に枠幅いっぱい

    const font = layer.font || {};
    const sx = font.scaleX !== undefined ? font.scaleX : 1;
    const sy = font.scaleY !== undefined ? font.scaleY : 1;
    const vertical = !!layer.vertical;
    const baseLs = font.letterSpacing || 0;

    // 変体率のみ・基準字間の状態にリセットしてから計測
    inner.style.transform = innerBaseTransform(layer);
    el.style.fontSize = `${font.size || 30}px`;
    el.style.letterSpacing = baseLs ? `${baseLs}em` : '';
    const measure = () => (vertical ? inner.scrollHeight : inner.scrollWidth);
    const main = measure(); // 文字の進行方向のサイズ
    const avail = vertical ? el.clientHeight : el.clientWidth;
    if (!main || !avail) return;
    const mainScale = vertical ? sy : sx; // 進行方向に効く変体率
    const visualMain = main * mainScale;

    const applyCondense = (m) => {
      const ratio = avail / (m * mainScale);
      if (ratio >= 1) return;
      inner.style.transformOrigin = transformOrigin(layer);
      const skew = font.skewX ? `skewX(${-font.skewX}deg) ` : '';
      const csx = vertical ? sx : sx * ratio;
      const csy = vertical ? sy * ratio : sy;
      inner.style.transform = `${skew}scale(${csx}, ${csy})`;
    };

    if (layer.autoFit === 'tracking') {
      const size = font.size || 30;
      const n = Math.max(1, inner.textContent.length);
      const trackMax = font.trackMax !== undefined ? font.trackMax : TRACK_MAX_DEFAULT;
      const trackMin = font.trackMin !== undefined ? font.trackMin : TRACK_MIN_DEFAULT;
      const availUnscaled = avail / mainScale; // 変体率を除いた実測系での枠サイズ
      // letter-spacingは末尾文字の後ろにも付くため n で割る (端まで届かない=均等割付と異なる意図)
      const gapEm = (availUnscaled - main) / n / size;
      if (gapEm > 0) {
        // 短文: 上限つきで字間を広げる
        const ls = Math.min(baseLs + gapEm, Math.max(baseLs, trackMax));
        if (ls > baseLs) el.style.letterSpacing = `${ls.toFixed(4)}em`;
        return;
      }
      // 長文: まず字間を下限まで詰める
      const ls = Math.max(trackMin, baseLs + gapEm);
      if (ls < baseLs) el.style.letterSpacing = `${ls.toFixed(4)}em`;
      const m2 = measure();
      // それでも収まらなければ長体 (横幅圧縮) で収める
      applyCondense(m2);
      return;
    }

    if (layer.autoFit === 'condense') {
      applyCondense(main);
      return;
    }

    // shrink: 進行方向と直交方向の両方が収まる倍率にフォントサイズを縮小
    const cross = (vertical ? inner.scrollWidth : inner.scrollHeight) * (vertical ? sx : sy);
    const availCross = vertical ? el.clientWidth : el.clientHeight;
    const ratio = Math.min(1, avail / visualMain, availCross / (cross || 1));
    if (ratio < 1) {
      const size = font.size || 30;
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

  global.TelopRenderer = { renderVariant, applyFonts, edgeOffsets, shapePoints };
})(typeof window !== 'undefined' ? window : globalThis);
