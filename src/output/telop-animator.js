/**
 * テロップアニメーションエンジン (共通モジュール)
 *
 * Web Animations API でレイヤーのIN/OUTアニメーションを再生する。
 * 出力ページとデザインエディタの試写の両方から使用する。
 *
 * アニメーション設定 (variant.animation.in / .out):
 *   preset:    'cut' | 'fade' | 'slide' | 'wipe' | 'pop' | 'blur' | 'chars'
 *   duration:  再生時間 (ms)
 *   easing:    CSSイージング
 *   direction: 'up'|'down'|'left'|'right' (slide=進入方向, wipe=拭き出し方向)
 *   distance:  slideの移動距離 (px)
 *   scaleFrom: popの開始スケール (既定0.6)
 *   blurFrom:  blurのぼかし量 (px, 既定14)
 *   charDelay: charsの1文字ごとの遅れ (ms, 既定40)
 *   stagger:   レイヤーごとの順次ディレイ (ms, 背面レイヤーから順に)
 */
(function (global) {
  const DEFAULTS = { preset: 'fade', duration: 350 };

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

  /** テキストレイヤーを1文字ずつspanに分割する (chars用) */
  function splitChars(el) {
    if (el.dataset.charsSplit === '1') return Array.from(el.querySelectorAll('.tl-char'));
    const text = el.textContent;
    el.textContent = '';
    const spans = [];
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'tl-char';
      span.textContent = ch;
      el.appendChild(span);
      spans.push(span);
    }
    el.dataset.charsSplit = '1';
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
    const anim = Object.assign({}, DEFAULTS, (variant && variant.animation && variant.animation[direction]) || {});
    const layers = Array.from(container.querySelectorAll('.tl-layer'));
    if (layers.length === 0) return Promise.resolve();

    // 進行中のアニメーションを破棄
    layers.forEach((el) => {
      el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    });

    if (anim.preset === 'cut' || !anim.duration) {
      return Promise.resolve();
    }

    const stagger = anim.stagger || 0;
    const easing = anim.easing || (direction === 'in' ? 'ease-out' : 'ease-in');
    const finished = [];

    layers.forEach((el, i) => {
      const delay = stagger * i;
      const baseTransform = el.style.transform;

      if (anim.preset === 'chars' && el.classList.contains('tl-text')) {
        // 文字送り: 1文字ずつ順に表示 (OUTは全体フェード)
        if (direction === 'in') {
          const spans = splitChars(el);
          const charDelay = anim.charDelay !== undefined ? anim.charDelay : 40;
          spans.forEach((span, ci) => {
            const a = span.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: anim.duration,
              delay: delay + ci * charDelay,
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

  global.TelopAnimator = { play };
})(typeof window !== 'undefined' ? window : globalThis);
