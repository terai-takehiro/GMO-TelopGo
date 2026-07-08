/**
 * 出力ページ制御
 *
 * URLパスから言語と担当リージョンを判定し、WebSocketで受けた
 * take / change / clear を描画に反映する。
 *   /output/jp        → lang=jp, regions=[name, side]
 *   /output/jp/name   → lang=jp, regions=[name]
 *
 * アニメーションは TelopAnimator (WAAPI) で再生。
 * OUT再生中に次のTAKEが来た場合は世代カウンタで古い完了処理を無効化する。
 */
(function () {
  const m = location.pathname.match(/^\/output\/(jp|en)(?:\/(name|side))?\/?$/);
  const lang = m ? m[1] : 'jp';
  const regions = m && m[2] ? [m[2]] : ['name', 'side'];

  let project = null;
  const generation = { name: 0, side: 0 };

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

    generation[region]++;
    TelopRenderer.renderVariant(container, variant, values || {});
    container.classList.add('on-air');
    container.dataset.templateKey = templateKey;

    if (animate) {
      TelopAnimator.play(container, variant, 'in');
    }
  }

  function hide(region) {
    if (!regions.includes(region)) return;
    const container = containers[region];
    if (!container.classList.contains('on-air')) return;
    const variant = findVariant(container.dataset.templateKey);

    const gen = ++generation[region];
    TelopAnimator.play(container, variant, 'out').then(() => {
      if (generation[region] !== gen) return; // OUT中に新しいTAKEが来た
      container.classList.remove('on-air');
      container.innerHTML = '';
    });
  }

  function applyState(state) {
    regions.forEach((region) => {
      const s = state && state[region];
      if (s && s.onAir && s.templateKey) {
        show(region, s.templateKey, s.values, false);
      } else {
        generation[region]++;
        containers[region].classList.remove('on-air');
        containers[region].innerHTML = '';
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
