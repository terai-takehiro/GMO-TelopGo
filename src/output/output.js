/**
 * 出力ページ制御
 *
 * URLパスから言語と担当リージョンを判定し、WebSocketで受けた
 * take / change / clear を描画に反映する。
 *   /output/jp        → lang=jp, regions=[name, side]
 *   /output/jp/name   → lang=jp, regions=[name]
 */
(function () {
  const m = location.pathname.match(/^\/output\/(jp|en)(?:\/(name|side))?\/?$/);
  const lang = m ? m[1] : 'jp';
  const regions = m && m[2] ? [m[2]] : ['name', 'side'];

  let project = null;

  const containers = {
    name: document.getElementById('region-name'),
    side: document.getElementById('region-side'),
  };

  // 担当外リージョンは非表示のまま
  Object.entries(containers).forEach(([region, el]) => {
    if (!regions.includes(region)) el.style.display = 'none';
  });

  // ===== キャンバスをウィンドウにフィット (vMixフルHD取り込み時は等倍) =====
  function fitCanvas() {
    const canvas = document.getElementById('canvas');
    const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    canvas.style.transform = `scale(${scale})`;
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // ===== 描画 =====

  function findVariant(templateKey) {
    if (!project || !project.templates || !project.templates[templateKey]) return null;
    return project.templates[templateKey].variants[lang] || null;
  }

  function show(region, templateKey, values, animate) {
    if (!regions.includes(region)) return;
    const container = containers[region];
    const variant = findVariant(templateKey);
    if (!variant) return;

    TelopRenderer.renderVariant(container, variant, values || {});

    const anim = (variant.animation && variant.animation.in) || {};
    const duration = animate ? (anim.duration !== undefined ? anim.duration : 350) : 0;
    container.style.transition = duration ? `opacity ${duration}ms ${anim.easing || 'ease-out'}` : 'none';
    // 再描画を挟んでからon-air化 (transitionを確実に効かせる)
    requestAnimationFrame(() => container.classList.add('on-air'));
    container.dataset.templateKey = templateKey;
  }

  function hide(region) {
    if (!regions.includes(region)) return;
    const container = containers[region];
    const variant = findVariant(container.dataset.templateKey);
    const anim = (variant && variant.animation && variant.animation.out) || {};
    const duration = anim.duration !== undefined ? anim.duration : 300;
    container.style.transition = `opacity ${duration}ms ${anim.easing || 'ease-in'}`;
    container.classList.remove('on-air');
  }

  function applyState(state) {
    regions.forEach((region) => {
      const s = state && state[region];
      if (s && s.onAir && s.templateKey) {
        show(region, s.templateKey, s.values, false);
      } else {
        containers[region].style.transition = 'none';
        containers[region].classList.remove('on-air');
      }
    });
  }

  // ===== WebSocket =====

  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      switch (msg.type) {
        case 'init':
        case 'refresh':
          project = msg.payload.project;
          applyState(msg.payload.state);
          break;
        case 'take':
          show(msg.region, msg.templateKey, msg.values, msg.animate !== false);
          break;
        case 'clear':
          hide(msg.region);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
