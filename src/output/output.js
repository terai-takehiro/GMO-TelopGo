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
  // /output/jp | /output/jp/<region> | /output/jp/g/<groupId>
  const mGroup = location.pathname.match(/^\/output\/(jp|en)\/g\/([a-z0-9_-]+)\/?$/);
  const mSingle = location.pathname.match(/^\/output\/(jp|en)\/([a-z0-9_-]+)\/?$/);
  const mAll = location.pathname.match(/^\/output\/(jp|en)\/?$/);
  const lang = (mGroup || mSingle || mAll) ? (mGroup || mSingle || mAll)[1] : 'jp';
  const target = mGroup ? { type: 'group', groupId: mGroup[2] }
    : mSingle ? { type: 'channel', region: mSingle[2] }
      : { type: 'all' };

  let project = null;
  const generation = {};
  const containers = {};
  // 描画対象リージョンをレイヤー順 (背面→前面) で保持
  let orderedRegions = [];
  const canvas = document.getElementById('canvas');

  function handlesRegion(region) {
    return orderedRegions.includes(region);
  }

  /** URLの対象種別とpayloadのチャンネル/グループから描画対象リージョンを順序付きで解決 */
  function resolveRegions(channels, groups) {
    const all = (channels || []).map((c) => c.region);
    if (target.type === 'channel') {
      return all.includes(target.region) ? [target.region] : [];
    }
    if (target.type === 'group') {
      const g = (groups || []).find((x) => x.id === target.groupId);
      if (!g) return [];
      // グループ定義のchannels順 = レイヤー順。存在するチャンネルのみ
      return g.channels.filter((cid) => all.includes(cid));
    }
    return all; // 全チャンネル重畳 (channels配列順)
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

  /** 描画対象リージョンを解決し、コンテナをレイヤー順(=DOM順=z-order)に整える */
  function ensureContainers(channels, groups) {
    orderedRegions = resolveRegions(channels, groups);
    // 対象外になったコンテナを撤去
    Object.keys(containers).forEach((region) => {
      if (!orderedRegions.includes(region)) {
        containers[region].remove();
        delete containers[region];
      }
    });
    // 対象を順に (再)appendして重なり順を確定 (後の要素ほど前面)
    orderedRegions.forEach((region) => {
      canvas.appendChild(containerFor(region));
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

  /** 静止画1枚を全画面(1920x1080)に敷くバリアントを組む */
  function stillVariant(still) {
    if (!still || !still.file) return null;
    return {
      layers: [{
        id: 'still', type: 'image', x: 0, y: 0, w: 1920, h: 1080,
        file: still.file, objectFit: still.objectFit || 'contain', visible: true,
      }],
      animation: still.animation || {}, // ページごとのIN/OUTエフェクト (未設定はフェード既定)
    };
  }

  /**
   * 送出内容 (content) から描画バリアントと値を解決する。
   *   content = { templateKey, values }               (リアルタイムCG)
   *           | { static: { kind, still?|variant? } }  (電テロ: 静的)
   */
  function resolveContent(content) {
    if (content && content.static) {
      const s = content.static;
      if (s.kind === 'still') return { variant: stillVariant(s.still), values: {} };
      if (s.kind === 'design') return { variant: s.variant || null, values: {} };
      return { variant: null, values: {} };
    }
    return { variant: findVariant(content.templateKey), values: content.values || {} };
  }

  function show(region, content, animate) {
    if (!handlesRegion(region)) return;
    const container = containerFor(region);
    const { variant, values } = resolveContent(content);
    if (!variant) return;

    generation[region]++;
    TelopRenderer.renderVariant(container, variant, values);
    container.classList.add('on-air');
    container._variant = variant; // OUTアニメ用に保持 (静的送出はtemplateKeyを持たない)

    if (animate) {
      TelopAnimator.play(container, variant, 'in');
    }
  }

  function hide(region) {
    if (!handlesRegion(region)) return;
    const container = containerFor(region);
    if (!container.classList.contains('on-air')) return;
    const variant = container._variant || null;

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
      if (s && s.onAir && (s.templateKey || s.static)) {
        show(region, s.static ? { static: s.static } : { templateKey: s.templateKey, values: s.values }, false);
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
          ensureContainers(msg.payload.channels, msg.payload.groups);
          applyState(msg.payload.state);
          break;
        case 'take':
          show(
            msg.region,
            msg.static ? { static: msg.static } : { templateKey: msg.templateKey, values: msg.values },
            msg.animate !== false,
          );
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
