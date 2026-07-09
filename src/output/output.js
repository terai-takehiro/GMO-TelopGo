/**
 * 出力ページ制御
 *
 * URLパスから言語と担当リージョン(チャンネル)を判定し、WebSocketで受けた
 * take / change / clear / stop を描画に反映する。
 *   /output/jp        → lang=jp, 全チャンネル重畳
 *   /output/jp/name   → lang=jp, nameチャンネルのみ
 *
 * リージョンのコンテナはWS init/refreshで受け取るチャンネル一覧から動的生成する
 * (チャンネルは設定で任意に追加できる)。
 * アニメーションは TelopAnimator (WAAPI) で再生。
 * OUT再生中に次のTAKEが来た場合は世代カウンタで古い完了処理を無効化する。
 */
(function () {
  const m = location.pathname.match(/^\/output\/(jp|en)(?:\/([a-z0-9_-]+))?\/?$/);
  const lang = m ? m[1] : 'jp';
  const onlyRegion = m && m[2] ? m[2] : null;

  let project = null;
  const generation = {};
  const containers = {};
  const canvas = document.getElementById('canvas');

  function handlesRegion(region) {
    return !onlyRegion || onlyRegion === region;
  }

  /** チャンネルのコンテナを取得 (無ければ動的生成) */
  function containerFor(region) {
    if (containers[region]) return containers[region];
    const el = document.createElement('div');
    el.className = 'region';
    el.id = `region-${region}`;
    canvas.appendChild(el);
    containers[region] = el;
    generation[region] = generation[region] || 0;
    return el;
  }

  /** チャンネル一覧に応じてコンテナを準備 (担当外は作らない) */
  function ensureContainers(channels) {
    (channels || []).forEach((ch) => {
      if (handlesRegion(ch.region)) containerFor(ch.region);
    });
  }

  // ===== キャンバスをウィンドウにフィット (vMixフルHD取り込み時は等倍) =====
  function fitCanvas() {
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
    if (!handlesRegion(region)) return;
    const container = containerFor(region);
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
    if (!handlesRegion(region)) return;
    const container = containerFor(region);
    if (!container.classList.contains('on-air')) return;
    const variant = findVariant(container.dataset.templateKey);

    const gen = ++generation[region];
    TelopAnimator.play(container, variant, 'out').then(() => {
      if (generation[region] !== gen) return; // OUT中に新しいTAKEが来た
      container.classList.remove('on-air');
      container.innerHTML = '';
    });
  }

  /** STOP: 再生中アニメーションの一時停止/再開トグル */
  function toggleStop(region) {
    if (!handlesRegion(region)) return;
    const container = containerFor(region);
    const anims = container.getAnimations({ subtree: true });
    if (anims.length === 0) return;
    const anyRunning = anims.some((a) => a.playState === 'running');
    anims.forEach((a) => {
      try {
        if (anyRunning) a.pause(); else a.play();
      } catch (_) { /* ignore */ }
    });
  }

  function applyState(state) {
    Object.keys(state || {}).forEach((region) => {
      if (!handlesRegion(region)) return;
      const s = state[region];
      const container = containerFor(region);
      if (s && s.onAir && s.templateKey) {
        show(region, s.templateKey, s.values, false);
      } else {
        generation[region] = (generation[region] || 0) + 1;
        container.classList.remove('on-air');
        container.innerHTML = '';
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
          TelopRenderer.applyFonts((project.assets && project.assets.fonts) || [], '/assets/');
          ensureContainers(msg.payload.channels);
          applyState(msg.payload.state);
          break;
        case 'take':
          show(msg.region, msg.templateKey, msg.values, msg.animate !== false);
          break;
        case 'clear':
          hide(msg.region);
          break;
        case 'stop':
          toggleStop(msg.region);
          break;
        default:
          break;
      }
    };

    ws.onclose = () => setTimeout(connect, 2000);
  }
  connect();
})();
