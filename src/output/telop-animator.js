/**
 * テロップアニメーションエンジン (共通モジュール)
 *
 * Web Animations API でレイヤーのIN/OUTアニメーションを再生する。
 * 出力ページとデザインエディタの試写の両方から使用する。
 *
 * アニメーション設定 (variant.animation.in / .out):
 *   preset:    'cut' | 'fade' | 'slide' | 'wipe' | 'pop' | 'blur' | 'chars'
 *              | 'push' | 'zoom' | 'flip'
 *   duration:  再生時間 (ms)
 *   easing:    CSSイージング
 *   direction: 'up'|'down'|'left'|'right' (slide/push=進入方向, wipe=拭き出し方向)
 *   distance:  slideの移動距離 (px)
 *   scaleFrom: pop/zoomの開始スケール (pop既定0.6, zoom既定1.25)
 *   blurFrom:  blurのぼかし量 (px, 既定14)
 *   charDelay: charsの1文字ごとの遅れ (ms, 既定40)
 *   charOrder: charsの表示順 'forward'(既定) | 'random'
 *   stagger:   レイヤーごとの順次ディレイ (ms, 背面レイヤーから順に)
 *
 * レイヤー個別設定 (layer.anim.in / .out):
 *   上記と同じ項目 + delay (再生開始からの遅れms)。
 *   設定されたレイヤーはテンプレート既定より優先される (PowerPointの個別アニメーション相当)。
 */
(function (global) {
  const DEFAULTS = { preset: 'fade', duration: 350 };

  /**
   * レイヤーの実効アニメーション設定を解決する
   * @param {Object} variant テンプレートのバリアント
   * @param {Object|null} layer レイヤー定義 (個別設定の参照用)
   * @param {number} index 表示レイヤー中のインデックス (既定のstagger計算用)
   * @param {'in'|'out'} direction
   * @returns {{anim: Object, delay: number, custom: boolean}}
   */
  function resolve(variant, layer, index, direction) {
    const own = layer && layer.anim && layer.anim[direction];
    if (own) {
      return { anim: Object.assign({}, DEFAULTS, own), delay: own.delay || 0, custom: true };
    }
    const tpl = Object.assign({}, DEFAULTS, (variant && variant.animation && variant.animation[direction]) || {});
    return { anim: tpl, delay: (tpl.stagger || 0) * index, custom: false };
  }

  /** プリセットごとの「隠れた状態」のフレームを作る (INは→表示, OUTは表示→) */
  function hiddenFrame(anim, baseTransform) {
    const base = baseTransform && baseTransform !== 'none' ? ` ${baseTransform}` : '';
    switch (anim.preset) {
      case 'slide': {
        const d = anim.distance !== undefined ? anim.distance : 60;
        const map = { up: [0, d], down: [0, -d], left: [d, 0], right: [-d, 0] };
        const [x, y] = map[anim.direction] || map.up;
        return { opacity: 0, transform: `translate(${x}px, ${y}px)${base}` };
      }
      case 'wipe': {
        const map = {
          right: 'inset(0 100% 0 0)', // 左→右へ拭き出し
          left: 'inset(0 0 0 100%)',
          down: 'inset(0 0 100% 0)',
          up: 'inset(100% 0 0 0)',
        };
        return { clipPath: map[anim.direction] || map.right };
      }
      case 'pop': {
        const from = anim.scaleFrom !== undefined ? anim.scaleFrom : 0.6;
        return { opacity: 0, transform: `scale(${from})${base}` };
      }
      case 'blur': {
        const blur = anim.blurFrom !== undefined ? anim.blurFrom : 14;
        return { opacity: 0, filter: `blur(${blur}px)` };
      }
      case 'push': {
        // スライド+ワイプの複合: 自分の枠から押し出されるように出入りする
        const d = anim.distance !== undefined ? anim.distance : 80;
        const map = {
          up: [[0, d], 'inset(100% 0 0 0)'],
          down: [[0, -d], 'inset(0 0 100% 0)'],
          left: [[d, 0], 'inset(0 0 0 100%)'],
          right: [[-d, 0], 'inset(0 100% 0 0)'],
        };
        const [[x, y], clip] = map[anim.direction] || map.up;
        return { transform: `translate(${x}px, ${y}px)${base}`, clipPath: clip };
      }
      case 'zoom': {
        // ズーム: 大きい状態から等倍へ (Ken Burns風)
        const from = anim.scaleFrom !== undefined ? anim.scaleFrom : 1.25;
        return { opacity: 0, transform: `scale(${from})${base}` };
      }
      case 'flip': {
        // フリップ: 奥行き回転しながら出現
        return { opacity: 0, transform: `perspective(900px) rotateY(70deg)${base}` };
      }
      case 'fade':
      case 'chars':
      default:
        return { opacity: 0 };
    }
  }

  /** 要素の「表示状態」のフレーム (インラインスタイルの値を維持) */
  function visibleFrame(anim, el, baseTransform) {
    const frame = {};
    const hidden = hiddenFrame(anim, baseTransform);
    if ('opacity' in hidden) frame.opacity = el.style.opacity !== '' ? el.style.opacity : 1;
    if ('transform' in hidden) frame.transform = baseTransform && baseTransform !== 'none' ? baseTransform : 'none';
    if ('clipPath' in hidden) frame.clipPath = 'inset(0 0 0 0)';
    if ('filter' in hidden) frame.filter = 'blur(0px)';
    return frame;
  }

  /** テキストレイヤーを1文字ずつspanに分割する (chars用)
   *  .tl-text-inner がある場合はその内側で分割し、座布団や長体の
   *  スタイルを保持する */
  function splitChars(el) {
    const target = el.querySelector('.tl-text-inner') || el;
    if (target.dataset.charsSplit === '1') return Array.from(target.querySelectorAll('.tl-char'));
    const text = target.textContent;
    target.textContent = '';
    const spans = [];
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'tl-char';
      span.textContent = ch;
      target.appendChild(span);
      spans.push(span);
    }
    target.dataset.charsSplit = '1';
    return spans;
  }

  /**
   * コンテナ内の全レイヤーにIN/OUTアニメーションを再生する
   * @param {HTMLElement} container .tl-layer 群を含む要素
   * @param {Object} variant テンプレートのバリアント (animation設定を参照)
   * @param {'in'|'out'} direction
   * @returns {Promise} 全レイヤーの再生完了
   */
  function play(container, variant, direction) {
    const layerEls = Array.from(container.querySelectorAll('.tl-layer'));
    if (layerEls.length === 0) return Promise.resolve();

    // 進行中のアニメーションを破棄
    layerEls.forEach((el) => {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    });

    const layerDefs = (variant && variant.layers) || [];
    const finished = [];

    layerEls.forEach((el, i) => {
      const layer = layerDefs.find((l) => l.id === el.dataset.layerId) || null;
      const resolved = resolve(variant, layer, i, direction);
      const delay = resolved.delay;
      // カットは「指定時刻に出現/消滅」として1msのフェードで表現
      const anim = resolved.anim.preset === 'cut'
        ? Object.assign({}, resolved.anim, { preset: 'fade', duration: 1 })
        : resolved.anim;
      if (!anim.duration) return;

      const easing = anim.easing || (direction === 'in' ? 'ease-out' : 'ease-in');
      const baseTransform = el.style.transform;

      // グラデーション文字は分割するとbackground-clipが壊れるため全体フェードへ
      const innerEl = el.querySelector('.tl-text-inner');
      const splittable = !innerEl || innerEl.dataset.noSplit !== '1';
      if (anim.preset === 'chars' && el.classList.contains('tl-text') && splittable) {
        // 文字送り: 1文字ずつ順に表示 (OUTは全体フェード)
        if (direction === 'in') {
          const spans = splitChars(el);
          const charDelay = anim.charDelay !== undefined ? anim.charDelay : 40;
          // 表示順: forward=先頭から / random=決定的シャッフル
          // (文字数でシードするため、試写と本番で同じ順序になる)
          const order = spans.map((_, i) => i);
          if (anim.charOrder === 'random') {
            let seed = (spans.length * 2654435761) % 4294967296;
            const rand = () => {
              seed = (seed * 1664525 + 1013904223) % 4294967296;
              return seed / 4294967296;
            };
            for (let i = order.length - 1; i > 0; i--) {
              const j = Math.floor(rand() * (i + 1));
              [order[i], order[j]] = [order[j], order[i]];
            }
          }
          spans.forEach((span, ci) => {
            const a = span.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: anim.duration,
              delay: delay + order[ci] * charDelay,
              easing,
              fill: 'both',
            });
            finished.push(a.finished);
          });
          return;
        }
      }

      const from = direction === 'in' ? hiddenFrame(anim, baseTransform) : visibleFrame(anim, el, baseTransform);
      const to = direction === 'in' ? visibleFrame(anim, el, baseTransform) : hiddenFrame(anim, baseTransform);
      const a = el.animate([from, to], {
        duration: anim.duration,
        delay,
        easing,
        fill: 'both',
      });
      finished.push(a.finished);
    });

    return Promise.allSettled(finished);
  }

  global.TelopAnimator = { play, resolve };
})(typeof window !== 'undefined' ? window : globalThis);
