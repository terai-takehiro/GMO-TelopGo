/**
 * 送出タブUI (TELOP BOX / Viz Trio流のランダウン送出画面)
 *
 * 構成:
 *   上部バー: 番組/放送の切替・管理、表示モード、ダイレクト送出、リハーサル
 *   左レール: コーナー(項目)リスト — 並び順=送出順
 *   中央:     選択コーナーのページ一覧 (サムネイル/リスト) + 素材集(予備)
 *   右ペイン: ON AIR(PGM)/NEXTプレビュー、ページエディタ、送出ボタン群
 *
 * 状態色の定石: 赤=ON AIR / 黄=NEXT / グレー=送出済み
 */
const RundownUI = {
  currentCornerId: null,
  activeChannelId: null,
  selectedPageId: null,
  viewMode: 'thumb',   // 'thumb' | 'list'
  thumbSize: 'm',      // 's' | 'm' | 'l'
  _thumbCache: new Map(),
  _thumbQueue: [],
  _thumbBusy: false,
  _playedPages: new Set(), // 送出済みページ (グレー表示)
  _autoFired: new Set(),
  _directArmedNo: null,
  searchQuery: '',     // ページ検索 (コーナー内絞り込み)
  loaded: false,

  async init() {
    // 上部バー
    document.getElementById('od-program').addEventListener('change', (e) => {
      App.setActiveProgram(e.target.value);
      this.ensureSelections();
      App.saveRundown();
      this.renderAll();
    });
    document.getElementById('od-broadcast').addEventListener('change', (e) => {
      App.setActiveBroadcast(e.target.value);
      this.currentCornerId = null;
      this.ensureSelections();
      App.saveRundown();
      this.renderAll();
    });
    document.getElementById('od-program-add').addEventListener('click', () => this.addProgram());
    document.getElementById('od-program-rename').addEventListener('click', () => this.renameProgram());
    document.getElementById('od-program-delete').addEventListener('click', () => this.deleteProgram());
    document.getElementById('od-broadcast-add').addEventListener('click', () => this.addBroadcast(false));
    document.getElementById('od-broadcast-dup').addEventListener('click', () => this.addBroadcast(true));
    document.getElementById('od-broadcast-rename').addEventListener('click', () => this.renameBroadcast());
    document.getElementById('od-broadcast-delete').addEventListener('click', () => this.deleteBroadcast());

    document.getElementById('od-view-mode').addEventListener('change', (e) => {
      this.viewMode = e.target.value;
      this.renderColumns();
    });
    document.getElementById('od-thumb-size').addEventListener('change', (e) => {
      this.thumbSize = e.target.value;
      this.renderColumns();
    });
    document.getElementById('od-rehearsal').addEventListener('change', (e) => {
      App.rehearsal = e.target.checked;
      document.getElementById('od-rehearsal-banner').classList.toggle('hidden', !App.rehearsal);
      App.setStatus(App.rehearsal
        ? 'リハーサルモード ON — 出力には送出されません' : 'リハーサルモード OFF', App.rehearsal ? 'error' : 'success');
    });

    // ダイレクト送出
    const direct = document.getElementById('od-direct');
    direct.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.directEnter(direct.value.trim());
      } else if (e.key === 'Escape') {
        direct.value = '';
        this._directArmedNo = null;
        direct.blur();
      }
    });
    direct.addEventListener('input', () => {
      this._directArmedNo = null;
      this.highlightDirectCandidates(direct.value.trim());
    });

    // 送出モード切替 (リアルタイムCG / 電テロ) — モードごとの番組・放送へ切り替わる
    document.querySelectorAll('#tab-onair .od-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (App.activeMode === btn.dataset.mode) return;
        App.setMode(btn.dataset.mode);
        this.currentCornerId = null;
        this.ensureSelections();
        this.renderAll();
      });
    });

    // 上部バーのポップオーバー (番組・放送 / ⋯ / 表示)
    this.initPopovers();

    // コーナー
    document.getElementById('od-corner-add').addEventListener('click', () => this.addCorner());

    // ページ操作
    document.getElementById('od-add-page').addEventListener('click', () => this.addPageForChannel(this.activeChannelId));
    document.getElementById('od-import-excel').addEventListener('click', () => this.openPageDialog('excel'));
    document.getElementById('od-export-excel-template').addEventListener('click', () => this.openPageDialog('template', this.activeChannelId));
    document.getElementById('od-page-dialog-template').addEventListener('click', () => {
      this.exportExcelTemplate(document.getElementById('od-page-template').value);
    });
    document.getElementById('od-import-pool').addEventListener('click', () => this.importNamePool());
    document.getElementById('od-export-pool-template').addEventListener('click', () => this.exportPoolTemplate());
    document.getElementById('od-import-name-batch').addEventListener('click', () => this.importNameBatch());
    document.getElementById('od-export-name-batch-template').addEventListener('click', () => this.exportNameBatchTemplate());
    document.getElementById('od-page-dialog-cancel').addEventListener('click', () => document.getElementById('od-page-dialog').close());
    document.getElementById('od-page-dialog-ok').addEventListener('click', () => this.submitPageDialog());
    document.getElementById('od-page-template').addEventListener('change', () => this.renderExcelColumns());
    document.getElementById('od-page-dialog-colset').addEventListener('click', () => {
      document.getElementById('od-page-dialog').close();
      this.openExcelColumnSettings(document.getElementById('od-page-template').value);
    });
    document.getElementById('od-xl-preview-cancel').addEventListener('click', () => {
      this._pendingExcel = null;
      document.getElementById('od-xl-preview').close();
    });
    document.getElementById('od-xl-preview-ok').addEventListener('click', () => this.commitExcelImport());

    // 右サイドバー (テロップ編集) の折りたたみ
    this.initRightPanel();
    this.initConsoleToggle();

    // 素材集: 選択して一括削除
    document.getElementById('od-standby-selall').addEventListener('change', (e) => {
      const corner = this.currentCorner();
      this.standbySel = new Set(e.target.checked && corner ? (corner.standby || []).map((pg) => pg.id) : []);
      this.renderStandby();
    });
    document.getElementById('od-standby-del-sel').addEventListener('click', () => this.deleteStandby(false));
    document.getElementById('od-standby-del-all').addEventListener('click', () => this.deleteStandby(true));

    // 電テロ追加ダイアログ (静的送出)
    document.getElementById('od-telop-cancel').addEventListener('click', () => document.getElementById('od-telop-dialog').close());
    document.getElementById('od-telop-ok').addEventListener('click', () => this.submitTelopDialog());
    document.getElementById('od-telop-source').addEventListener('change', (e) => {
      document.getElementById('od-telop-design-row').classList.toggle('hidden', e.target.value !== 'design');
    });
    document.getElementById('od-standby-toggle').addEventListener('click', () => {
      document.getElementById('od-standby').classList.toggle('hidden');
    });

    // 番組/放送の選び直し (入場ウィザードを再表示)
    const reselect = document.getElementById('od-reselect');
    if (reselect) reselect.addEventListener('click', () => {
      if (typeof StartWizard !== 'undefined') StartWizard.open(App.activeMode);
    });

    // ページ検索 (コーナー内の絞り込み)
    const search = document.getElementById('od-search');
    if (search) {
      search.addEventListener('input', () => {
        this.searchQuery = search.value.trim();
        this.renderColumns();
      });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { search.value = ''; this.searchQuery = ''; this.renderColumns(); search.blur(); }
      });
    }

    // プレビュー帯 (サイズ/背景/PGM範囲)
    this.initPreviewStrip();

    // 素材集へのドロップ受け (ページを予備へ退避)
    const standbyList = document.getElementById('od-standby-list');
    if (standbyList) {
      standbyList.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/page')) {
          e.preventDefault();
          standbyList.classList.add('od-file-drop');
        }
      });
      standbyList.addEventListener('dragleave', () => standbyList.classList.remove('od-file-drop'));
      standbyList.addEventListener('drop', (e) => {
        standbyList.classList.remove('od-file-drop');
        e.preventDefault();
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData('text/page')); } catch (_) { return; }
        const corner = this.currentCorner();
        if (payload && corner) this.movePageBefore(payload.pageId, null, corner, 'standby');
      });
    }

    // ホットキー
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // コンテキストメニューを閉じる
    document.addEventListener('click', () => this.closeContextMenu());

    // 残尺カウントダウン / オートフォロー
    setInterval(() => this.tick(), 250);
  },

  /** [data-pop] ボタンでポップオーバーを開閉。外側クリック・Esc・メニュー項目選択で閉じる */
  initPopovers() {
    const root = document.getElementById('tab-onair');
    const closeAll = (except) => {
      root.querySelectorAll('.od-pop').forEach((p) => { if (p !== except) p.classList.add('hidden'); });
    };
    root.querySelectorAll('[data-pop]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pop = document.getElementById(btn.dataset.pop);
        if (!pop) return;
        closeAll(pop);
        pop.classList.toggle('hidden');
      });
    });
    root.querySelectorAll('.od-pop').forEach((pop) => {
      pop.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.od-menu-item') || e.target.id === 'od-reselect') closeAll();
      });
    });
    document.addEventListener('click', () => closeAll());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  },

  /** 各列のOA/NEXTモニターの背景コントロール (透過確認用) */
  initPreviewStrip() {
    const bgSel = document.getElementById('od-pvw-bg');
    const bgFile = document.getElementById('od-pvw-bg-file');
    if (!bgSel) return;

    bgSel.addEventListener('change', () => {
      if (bgSel.value === 'image') {
        bgFile.click(); // 選択キャンセル時は onchange が来ないので黒へ戻す
        return;
      }
      this._pvwBgImage = null;
      this._pvwBg = bgSel.value;
      this.applyPreviewBg();
      try { localStorage.setItem('od.pvwBg', bgSel.value); } catch (_) { /* ignore */ }
    });
    bgFile.addEventListener('change', () => {
      const f = bgFile.files && bgFile.files[0];
      if (!f) { bgSel.value = 'black'; this._pvwBg = 'black'; this.applyPreviewBg(); return; }
      const reader = new FileReader();
      reader.onload = () => {
        this._pvwBgImage = reader.result;
        this._pvwBg = 'image';
        this.applyPreviewBg();
      };
      reader.readAsDataURL(f);
      bgFile.value = '';
    });

    // 前回のUI設定を復元
    let bg = 'black';
    try {
      bg = localStorage.getItem('od.pvwBg') || 'black';
      if (bg === 'image') bg = 'black'; // 画像は永続化しない
    } catch (_) { /* ignore */ }
    bgSel.value = bg;
    this._pvwBg = bg;
    this.applyPreviewBg();
  },

  /** 背景設定 (透過確認用) を各列のOA/NEXTモニターへ適用 */
  applyPreviewBg() {
    const v = this._pvwBg || 'black';
    document.querySelectorAll('#od-columns .od-col-mon').forEach((el) => {
      el.classList.remove('bg-black', 'bg-checker', 'bg-white', 'bg-image');
      el.classList.add(`bg-${v}`);
      el.style.backgroundImage = v === 'image' && this._pvwBgImage ? `url(${this._pvwBgImage})` : '';
    });
  },

  /** ダイレクト入力中、番号が一致するページを一覧上でハイライト */
  highlightDirectCandidates(value) {
    document.querySelectorAll('#od-columns .od-page').forEach((el) => {
      const no = el.querySelector('.od-page-no');
      el.classList.toggle('od-direct-hit', !!value && !!no && no.textContent.startsWith(value));
    });
  },

  /** 起動時ロード (設定 → チャンネル反映後に呼ばれる) */
  async load() {
    if (!window.api.rundownGet) return; // 旧テストスタブ互換
    const project = await window.api.graphicsGetProject();
    App.loadTemplatesFrom(project);
    App.rundown = await window.api.rundownGet();
    App.resetRundownHistory();
    this.ensureSelections();
    this.loaded = true;
    this.renderAll();
  },

  /** デザイン保存後などにテンプレート情報を再取得 */
  async refreshTemplates() {
    const project = await window.api.graphicsGetProject();
    App.loadTemplatesFrom(project);
    this._thumbCache.clear();
    if (this.loaded) this.renderAll();
  },

  ensureSelections() {
    if (!App.rundown || !App.modeTree()) return;
    const program = App.activeProgram();
    if (program) {
      App.modeTree().activeProgramId = program.id;
      const broadcast = App.activeBroadcast();
      if (broadcast) App.modeTree().activeBroadcastId = broadcast.id;
    }
    const corners = App.corners();
    if (!corners.find((c) => c.id === this.currentCornerId)) {
      this.currentCornerId = corners.length ? corners[0].id : null;
    }
    if (!App.channels.find((c) => c.id === this.activeChannelId)) {
      this.activeChannelId = App.channels.length ? App.channels[0].id : null;
    }
  },

  currentCorner() {
    return App.corners().find((c) => c.id === this.currentCornerId) || null;
  },

  mutate(fn) {
    fn();
    App.saveRundown();
    this.renderAll();
  },

  esc(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  // ===== 描画 =====

  renderAll() {
    if (!App.rundown) return;
    this.ensureSelections();
    this.renderTopBar();
    this.renderCornerRail();
    this.renderColumns();
    this.renderStandby();
    this.renderKeyTarget();
    this.renderEditor();
    Broadcast.updateGlobalOnAir();
    Broadcast.syncNextOutput(); // 系統の増減・放送の切替でNEXT出力の対象が変わる
  },

  /** 送出状態のみが変わったときの軽量再描画 */
  renderBroadcastState() {
    this.applyRowStates();
    this.renderKeyTarget();
    this.renderNextPreviews();
    this.renderEditor();
  },

  renderTopBar() {
    const tree = App.modeTree() || { programs: [], activeProgramId: null, activeBroadcastId: null };
    this.renderModeBanner();
    const progSel = document.getElementById('od-program');
    progSel.innerHTML = '';
    tree.programs.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      progSel.appendChild(opt);
    });
    progSel.value = tree.activeProgramId;

    const bcSel = document.getElementById('od-broadcast');
    bcSel.innerHTML = '';
    const program = App.activeProgram();
    ((program && program.broadcasts) || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      bcSel.appendChild(opt);
    });
    bcSel.value = tree.activeBroadcastId;

    // パンくず (番組 ▸ 放送)
    const bc = App.activeBroadcast();
    document.getElementById('od-crumb-prog').textContent = program ? program.name : '-';
    document.getElementById('od-crumb-bc').textContent = bc ? bc.name : '-';
  },

  /** 送出タブ上部のモード切替スイッチの選択状態 */
  renderModeBanner() {
    document.querySelectorAll('#tab-onair .od-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === App.activeMode);
    });
  },

  renderCornerRail() {
    const ul = document.getElementById('od-corner-list');
    ul.innerHTML = '';
    App.corners().forEach((corner, idx) => {
      const li = document.createElement('li');
      li.className = `od-corner${corner.id === this.currentCornerId ? ' active' : ''}`;
      li.draggable = true;
      li.dataset.cornerId = corner.id;

      const color = document.createElement('span');
      color.className = 'od-corner-color';
      color.style.background = corner.color || '#4da3ff';
      const name = document.createElement('span');
      name.className = 'od-corner-name';
      name.textContent = `${idx + 1}. ${corner.name}`;
      const meta = document.createElement('span');
      meta.className = 'od-corner-meta';
      meta.dataset.cornerId = corner.id;
      const badges = [];
      const tips = [];
      if (corner.locked) { badges.push('🔒'); tips.push('送出ロック中'); }
      if (corner.autoFollow && corner.autoFollow !== 'off') { badges.push('⏱'); tips.push('オートフォロー有効'); }
      const played = corner.pages.filter((pg) => this._playedPages.has(pg.id)).length;
      meta.textContent = `${badges.join('')} ${played}/${corner.pages.length}`;
      meta.title = tips.length ? `${tips.join(' / ')} — 送出済み ${played}/${corner.pages.length}ページ` : `送出済み ${played}/${corner.pages.length}ページ`;

      li.appendChild(color);
      li.appendChild(name);
      li.appendChild(meta);
      li.addEventListener('click', () => {
        this.currentCornerId = corner.id;
        this.renderCornerRail();
        this.renderColumns();
        this.renderStandby();
      });
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showCornerMenu(e, corner);
      });

      // コーナー並べ替え (D&D)
      li.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/corner', corner.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      li.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/corner')) e.preventDefault();
      });
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData('text/corner');
        if (!fromId || fromId === corner.id) return;
        this.mutate(() => {
          const corners = App.corners();
          const fromIdx = corners.findIndex((c) => c.id === fromId);
          const toIdx = corners.findIndex((c) => c.id === corner.id);
          const [moved] = corners.splice(fromIdx, 1);
          corners.splice(toIdx, 0, moved);
        });
      });

      ul.appendChild(li);
    });
  },

  /** ページ行/カードのDOMを生成 (opts.tile = かるた取りの札として描く) */
  buildPageEl(page, corner, listName, opts = {}) {
    const channelId = App.channelOfPage(page);
    const channel = App.channelById(channelId);
    const tile = !!opts.tile;
    const el = document.createElement('div');
    el.className = tile ? 'od-page od-page--tile' : `od-page od-page--${this.viewMode} od-thumb-${this.thumbSize}`;
    el.dataset.pageId = page.id;
    el.draggable = true;

    const stateBar = document.createElement('span');
    stateBar.className = 'od-page-state';
    el.appendChild(stateBar);

    const no = document.createElement('span');
    no.className = 'od-page-no';
    no.textContent = page.pageNo;
    el.appendChild(no);

    if (tile || this.viewMode === 'thumb') {
      const thumb = document.createElement('div');
      thumb.className = 'od-page-thumb';
      const img = document.createElement('img');
      img.alt = '';
      thumb.appendChild(img);
      el.appendChild(thumb);
      this.queueThumb(page, img);
    }

    const body = document.createElement('div');
    body.className = 'od-page-body';
    const summary = document.createElement('div');
    summary.className = 'od-page-summary';
    summary.textContent = Broadcast.summarize(page) || '(空)';
    const metaLine = document.createElement('div');
    metaLine.className = 'od-page-meta';
    const chip = document.createElement('span');
    chip.className = 'od-chip';
    chip.style.background = channel ? channel.color : '#555';
    chip.textContent = channel ? channel.label : '?';
    metaLine.appendChild(chip);
    const tplName = document.createElement('span');
    tplName.className = 'od-page-tpl';
    tplName.textContent = page.kind === 'still' ? '🖼 静止画'
      : this.isEditedStill(page) ? '🖼 編集済み'
        : page.kind === 'design' ? '🎨 作画'
          : this.templateLabel(page.templateKey);
    metaLine.appendChild(tplName);
    // INアニメが設定されているCGページはバッジで可視化 (TELOP BOXのエフェクトアイコン相当)
    if (!page.kind || page.kind === 'cg') {
      const tpl = App.graphicsProject && App.graphicsProject.templates
        && App.graphicsProject.templates[page.templateKey];
      const inAnim = tpl && tpl.variants && tpl.variants.jp
        && tpl.variants.jp.animation && tpl.variants.jp.animation.in;
      if (inAnim && inAnim.preset && inAnim.preset !== 'none' && inAnim.duration !== 0) {
        const fx = document.createElement('span');
        fx.className = 'od-page-fx';
        fx.textContent = '✨';
        fx.title = `INアニメ: ${inAnim.preset}`;
        metaLine.appendChild(fx);
      }
    }
    if (page.duration > 0) {
      const dur = document.createElement('span');
      dur.className = 'od-page-dur';
      dur.textContent = `⏱${page.duration}s`;
      metaLine.appendChild(dur);
    }
    if (page.locked) {
      const lock = document.createElement('span');
      lock.textContent = '🔒';
      lock.title = '送出ロック中 (TAKE不可)';
      metaLine.appendChild(lock);
    }
    if (page.note) {
      const note = document.createElement('span');
      note.className = 'od-page-note';
      note.textContent = page.note;
      metaLine.appendChild(note);
    }
    body.appendChild(summary);
    body.appendChild(metaLine);
    el.appendChild(body);

    const countdown = document.createElement('span');
    countdown.className = 'od-page-countdown hidden';
    el.appendChild(countdown);

    // クリック=NEXT+選択+その系統をフォーカス / ダブルクリック=即TAKE (かるた後継)
    el.addEventListener('click', () => {
      this.selectedPageId = page.id;
      if (listName === 'pages') Broadcast.setNext(page.id);
      if (channelId) this.activeChannelId = channelId;
      this.renderColumns();
      this.renderKeyTarget();
      this.renderEditor();
    });
    el.addEventListener('dblclick', () => {
      if (listName !== 'pages' || !channelId) return;
      // 設定でダブルクリック即TAKEを無効化できる (誤操作防止)
      if (App.operation && App.operation.dblclickTake === false) return;
      this.selectedPageId = page.id;
      this.activeChannelId = channelId;
      Broadcast.setNext(page.id);
      Broadcast.doTake(channelId);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showPageMenu(e, page, corner, listName);
    });

    // ページ並べ替え / 素材集⇔プレイリスト移動 (D&D)
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/page', JSON.stringify({ pageId: page.id }));
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/page')) {
        e.preventDefault();
        el.classList.add('od-drop-target');
      } else if (App.activeMode === 'telop' && listName === 'pages' && e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        el.classList.add('od-drop-target');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('od-drop-target'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('od-drop-target');
      // 親 (列/素材集) の「末尾へドロップ」まで動くと、ここで並べ替えた直後に末尾へ戻ってしまう
      e.stopPropagation();
      // 電テロ: 画像ファイルのドロップ取込 (このページの系統へ)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        if (App.activeMode !== 'telop' || listName !== 'pages') return;
        e.preventDefault();
        this.importDroppedFiles(corner, App.channelOfPage(page), e.dataTransfer.files);
        return;
      }
      e.preventDefault();
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/page')); } catch (_) { return; }
      if (!payload || payload.pageId === page.id) return;
      this.movePageBefore(payload.pageId, page.id, corner, listName);
    });

    // ホバー時クイックアクション (右クリックメニューの主要操作を露出)
    const actions = document.createElement('div');
    actions.className = 'od-page-actions';
    const mkAction = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'od-page-action';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      b.addEventListener('dblclick', (e) => e.stopPropagation());
      actions.appendChild(b);
    };
    mkAction(page.locked ? '🔓 解除' : '🔒 ロック', page.locked ? '送出ロックを解除' : '送出ロック (誤TAKE防止)',
      () => this.mutate(() => { page.locked = !page.locked; Broadcast.onPageLockChanged(page); }));
    mkAction('⧉ 複製', 'このページを複製 (Ctrl+D)', () => this.duplicatePage(page, corner, listName));
    mkAction(listName === 'pages' ? '⤵ 素材へ' : '⤴ 戻す',
      listName === 'pages' ? '素材集へ移動 (放送しない予備ページ)' : 'プレイリストへ戻す',
      () => this.mutate(() => {
        const from = corner[listName];
        from.splice(from.indexOf(page), 1);
        if (listName === 'pages') {
          corner.standby = corner.standby || [];
          corner.standby.push(page);
        } else {
          corner.pages.push(page);
        }
      }));
    el.appendChild(actions);

    return el;
  },

  /** 系統(チャンネル)ごとの列でページ一覧を描画 (最大4系統横並び) */
  renderColumns() {
    const wrap = document.getElementById('od-columns');
    const corner = this.currentCorner();
    if (!corner) {
      wrap.innerHTML = '';
      return;
    }
    const telopMode = App.activeMode === 'telop';

    // OAモニター (出力ページの iframe) は列を描き直しても作り直さない。
    // iframe を作り直す/DOM内で移動すると出力ページが読み込み直され、送出中のテロップが
    // 出し直されて見える (NEXT選択や2台運用の同期のたびに OA がちらつく) ため、列ごと使い回す
    const prevCols = {};
    Array.from(wrap.children).forEach((node) => {
      const keep = node.classList.contains('od-col')
        && App.channels.some((c) => c.id === node.dataset.channelId && c.region === node.dataset.region);
      if (keep) prevCols[node.dataset.channelId] = node;
      else node.remove();
    });

    this.renderModeBanner();
    // 電テロモードでは Excel取込 (変数代入・氏名一括・名前プール) は無関係なのでメニューごと隠す
    const excelWrap = document.getElementById('od-excel-wrap');
    if (excelWrap) excelWrap.classList.toggle('hidden', telopMode);

    App.channels.forEach((ch, colIndex) => {
      let col = prevCols[ch.id] || null;
      let monitors = col ? col.querySelector(':scope > .od-col-monitors') : null;
      if (col && monitors) {
        // 使い回す列: モニター以外を作り直す
        Array.from(col.children).forEach((node) => { if (node !== monitors) node.remove(); });
      } else {
        if (col) col.remove();
        col = document.createElement('div');
        monitors = null;
      }
      col.className = `od-col${ch.id === this.activeChannelId ? ' active' : ''}`;
      col.dataset.channelId = ch.id;
      col.dataset.region = ch.region;

      // ヘッダ (色ドット+ラベル+件数+その系統へページ追加)
      const header = document.createElement('div');
      header.className = 'od-col-header';
      const dot = document.createElement('span');
      dot.className = 'od-col-dot';
      dot.style.background = ch.color;
      const name = document.createElement('span');
      name.className = 'od-col-name';
      const allPages = Broadcast.channelPagesInCorner(corner, ch.id);
      const pages = this.searchQuery ? allPages.filter((pg) => this.matchPage(pg)) : allPages;
      name.textContent = this.searchQuery
        ? `${ch.label} (${pages.length}/${allPages.length})`
        : `${ch.label} (${allPages.length})`;
      const addBtn = document.createElement('button');
      addBtn.className = 'od-col-add';
      addBtn.textContent = '＋';
      addBtn.title = telopMode ? `${ch.label} に電テロを追加` : `${ch.label} にページを追加`;
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.addPageForChannel(ch.id); });
      header.appendChild(dot);
      header.appendChild(name);
      // 電テロ: 系統ごとの送出方式 (リスト / かるた取り)
      const sendMode = App.sendMode(ch.id);
      if (telopMode) header.appendChild(this.buildSendModeSwitch(ch, sendMode));
      header.appendChild(addBtn);
      header.addEventListener('click', () => this.focusChannel(ch.id));
      if (monitors) col.insertBefore(header, monitors);
      else col.appendChild(header);

      // OA|NEXT ミニモニター (系統ごとの出力/次ページ確認)。使い回す列ではそのまま残す
      if (!monitors) {
        monitors = document.createElement('div');
        monitors.className = 'od-col-monitors';
        const oaBox = document.createElement('div');
        oaBox.className = 'od-col-mon-box';
        const oaLabel = document.createElement('span');
        oaLabel.className = 'od-col-mon-label oa';
        oaLabel.dataset.channelId = ch.id;
        oaLabel.textContent = 'OA';
        const oaFrame = document.createElement('div');
        oaFrame.className = 'od-col-mon';
        const oaIframe = document.createElement('iframe');
        oaIframe.className = 'od-col-oa';
        oaIframe.dataset.region = ch.region;
        oaIframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
        oaIframe.setAttribute('allow', 'autoplay');
        oaIframe.src = 'about:blank';
        oaFrame.appendChild(oaIframe);
        oaBox.appendChild(oaLabel);
        oaBox.appendChild(oaFrame);
        const nextBox = document.createElement('div');
        nextBox.className = 'od-col-mon-box';
        const nextLabel = document.createElement('span');
        nextLabel.className = 'od-col-mon-label next od-col-next-label';
        nextLabel.dataset.channelId = ch.id;
        nextLabel.textContent = 'NEXT';
        const nextFrame = document.createElement('div');
        nextFrame.className = 'od-col-mon';
        const nextHost = document.createElement('div');
        nextHost.className = 'od-col-next';
        nextHost.dataset.channelId = ch.id;
        nextFrame.appendChild(nextHost);
        nextBox.appendChild(nextLabel);
        nextBox.appendChild(nextFrame);
        monitors.appendChild(oaBox);
        monitors.appendChild(nextBox);
        monitors.addEventListener('click', () => this.focusChannel(ch.id));
        col.appendChild(monitors);
      }

      // ボディ (その系統のページ)。かるた取りは札 (サムネイル) を並べる
      const karuta = sendMode === 'karuta';
      const body = document.createElement('div');
      body.className = karuta
        ? `od-col-body od-col-body--karuta od-karuta-${this.thumbSize}`
        : `od-col-body od-pages--${this.viewMode}`;
      pages.forEach((page) => body.appendChild(this.buildPageEl(page, corner, 'pages', { tile: karuta })));
      if (pages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'od-empty';
        empty.textContent = this.searchQuery ? '(一致するページなし)'
          : telopMode ? '(画像をドロップ / ＋で追加)' : '(ページなし)';
        body.appendChild(empty);
      }
      // 末尾ドロップで並べ替え/系統への移動、または電テロでは画像ファイルの取込
      body.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/page')) {
          e.preventDefault();
        } else if (telopMode && e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          body.classList.add('od-file-drop');
        }
      });
      body.addEventListener('dragleave', () => body.classList.remove('od-file-drop'));
      body.addEventListener('drop', (e) => {
        body.classList.remove('od-file-drop');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          if (!telopMode) return; // 画像取込は電テロモードのみ
          e.preventDefault();
          this.importDroppedFiles(corner, ch.id, e.dataTransfer.files);
          return;
        }
        e.preventDefault();
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData('text/page')); } catch (_) { return; }
        if (payload) this.movePageBefore(payload.pageId, null, corner, 'pages');
      });
      col.appendChild(body);

      // フッタ = 系統コンソール (バッジ + ボタン一式 + 大型TAKE)
      const footer = document.createElement('div');
      footer.className = 'od-col-footer';
      const st = App.chState(ch.id);
      const nextFound = st.nextPageId ? App.findPage(st.nextPageId) : null;
      const onAirFound = st.onAirPageId ? App.findPage(st.onAirPageId) : null;
      const badges = document.createElement('div');
      badges.className = 'od-col-badges';
      badges.innerHTML = `<span class="od-col-badge next">NEXT ${nextFound ? 'P' + nextFound.page.pageNo : '—'}</span>`
        + `<span class="od-col-badge onair">ON AIR ${onAirFound ? 'P' + onAirFound.page.pageNo : '—'}</span>`;
      footer.appendChild(badges);

      const VERBS = [
        { verb: 'top', en: 'TOP', jp: '先頭', title: 'このコーナーの先頭ページをNEXTに', cls: '', run: (id) => Broadcast.goTop(id) },
        { verb: 'back', en: 'BACK', jp: '戻す', title: 'NEXTを1つ戻す', cls: '', run: (id) => Broadcast.moveNext(id, -1) },
        { verb: 'skip', en: 'SKIP', jp: '送る', title: 'NEXTを1つ進める', cls: '', run: (id) => Broadcast.moveNext(id, 1) },
        { verb: 'stop', en: 'STOP', jp: '停止', title: '再生中アニメの一時停止/再開', cls: '', run: (id) => Broadcast.doStop(id) },
        { verb: 'update', en: 'UPDATE', jp: '即差替', title: 'NEXTをアニメなしで即時差し替え', cls: ' od-obtn-update', run: (id) => Broadcast.doUpdate(id) },
        { verb: 'clear', en: 'CLEAR', jp: '消去', title: 'オンエアをOUTアニメで消去 (Ctrl+Backspace)', cls: ' od-obtn-clear', run: (id) => Broadcast.doClear(id) },
        { verb: 'clearback', en: 'CLEAR&BACK', jp: '消して前へ', title: 'オンエアを消して1つ前のページを即表示 (Ctrl+Shift+Backspace)', cls: ' od-obtn-clear od-obtn-cb', run: (id) => Broadcast.doClearBack(id) },
      ];
      const grid = document.createElement('div');
      grid.className = 'od-col-verbs';
      VERBS.forEach((v) => {
        const btn = document.createElement('button');
        btn.className = `od-obtn od-obtn--sm${v.cls}`;
        btn.dataset.verb = v.verb;
        btn.title = `${ch.label}: ${v.title}`;
        btn.innerHTML = `${v.en.replace('&', '&amp;')}<span class="od-obtn-jp">${v.jp}</span>`;
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.focusChannel(ch.id); v.run(ch.id); });
        grid.appendChild(btn);
      });
      footer.appendChild(grid);

      const take = document.createElement('button');
      take.className = 'od-col-take';
      take.title = `${ch.label} を送出: NEXT→ON AIR (フォーカス中は Space / Enter)`;
      take.innerHTML = 'TAKE <span class="od-take-arrow">⬆</span>';
      take.addEventListener('click', (e) => { e.stopPropagation(); this.focusChannel(ch.id); Broadcast.doTake(ch.id); });
      footer.appendChild(take);
      col.appendChild(footer);

      // 並び順の位置へ (既に正しい位置なら動かさない = iframe を読み込み直さない)
      const at = wrap.children[colIndex] || null;
      if (at !== col) wrap.insertBefore(col, at);
    });

    this.updateChannelMonitors();
    this.renderNextPreviews();
    this.applyPreviewBg();
    this.applyRowStates();
  },

  /** 列ヘッダの送出方式スイッチ [リスト | かるた] */
  buildSendModeSwitch(ch, current) {
    const wrap = document.createElement('div');
    wrap.className = 'od-sendmode';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', `${ch.label} の送出方式`);
    [
      ['list', 'リスト', 'リスト送出: 上から順に送出 (TAKEするとNEXTが次のページへ進む)'],
      ['karuta', 'かるた', 'かるた取り: 札を並べ、クリックした札をNEXTにしてTAKE (TAKE後にNEXTは進まない)'],
    ].forEach(([mode, label, title]) => {
      const btn = document.createElement('button');
      btn.className = `od-sendmode-btn${current === mode ? ' active' : ''}`;
      btn.textContent = label;
      btn.title = title;
      btn.setAttribute('aria-pressed', current === mode ? 'true' : 'false');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (App.sendMode(ch.id) === mode) return;
        App.setSendMode(ch.id, mode);
        this.focusChannel(ch.id);
        this.renderColumns();
        App.setStatus(`${ch.label}: ${mode === 'karuta' ? 'かるた取り送出 (札をクリックでNEXT → TAKE)' : 'リスト送出 (上から順に)'} に切り替えました`);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  },

  /** 各列のOAモニター (出力サーバの系統別プレビュー) のURLを最新化 */
  updateChannelMonitors(status) {
    const st = status || (typeof GraphicsUI !== 'undefined' ? GraphicsUI.status : null);
    const base = (typeof GraphicsUI !== 'undefined' && GraphicsUI.previewBase) ? GraphicsUI.previewBase(st) : null;
    document.querySelectorAll('#od-columns iframe.od-col-oa').forEach((frame) => {
      const url = base ? `${base}/output/jp/${frame.dataset.region}?preview=1` : 'about:blank';
      if (frame.src !== url) frame.src = url;
    });
  },

  /** コーナーレールの進捗表示 (送出済み/全ページ) を最新化 */
  updateCornerProgress() {
    document.querySelectorAll('#od-corner-list .od-corner-meta').forEach((meta) => {
      const corner = App.corners().find((c) => c.id === meta.dataset.cornerId);
      if (!corner) return;
      const badges = [];
      const tips = [];
      if (corner.locked) { badges.push('🔒'); tips.push('送出ロック中'); }
      if (corner.autoFollow && corner.autoFollow !== 'off') { badges.push('⏱'); tips.push('オートフォロー有効'); }
      const played = corner.pages.filter((pg) => this._playedPages.has(pg.id)).length;
      meta.textContent = `${badges.join('')} ${played}/${corner.pages.length}`;
      meta.title = tips.length ? `${tips.join(' / ')} — 送出済み ${played}/${corner.pages.length}ページ` : `送出済み ${played}/${corner.pages.length}ページ`;
    });
  },

  /** キーボード操作 (Space=TAKE等) の対象系統をフォーカス。列クリックで切替 */
  focusChannel(channelId) {
    if (this.activeChannelId === channelId) return;
    this.activeChannelId = channelId;
    document.querySelectorAll('#od-columns .od-col').forEach((el) => {
      const active = el.dataset.channelId === channelId;
      el.classList.toggle('active', active);
    });
    this.renderKeyTarget();
  },

  /** ツールバーの「⌨ TL1」ピル = ホットキーが効く系統の表示 */
  renderKeyTarget() {
    const el = document.getElementById('od-key-target');
    if (!el) return;
    const ch = App.channelById(this.activeChannelId);
    el.textContent = `⌨ キー操作: ${ch ? ch.label : '-'}`;
    el.style.color = ch ? ch.color : '';
    el.style.borderColor = ch ? ch.color : '';
  },

  renderStandby() {
    const list = document.getElementById('od-standby-list');
    list.innerHTML = '';
    const corner = this.currentCorner();
    if (!corner) return;
    const standby = corner.standby || [];
    // 選択 (一括削除用): 無くなったページは選択から外す
    const ids = new Set(standby.map((pg) => pg.id));
    this.standbySel = new Set([...(this.standbySel || [])].filter((id) => ids.has(id)));
    standby.forEach((page) => {
      const el = this.buildPageEl(page, corner, 'standby');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.className = 'od-standby-check';
      check.checked = this.standbySel.has(page.id);
      check.title = '選択 (一括削除用)';
      check.setAttribute('aria-label', `P${page.pageNo} を選択`);
      check.addEventListener('click', (e) => e.stopPropagation());
      check.addEventListener('mousedown', (e) => e.stopPropagation());
      check.addEventListener('change', () => {
        if (check.checked) this.standbySel.add(page.id);
        else this.standbySel.delete(page.id);
        this.updateStandbySelection(standby.length);
      });
      el.classList.toggle('od-standby-selected', check.checked);
      el.insertBefore(check, el.firstChild);
      list.appendChild(el);
    });
    if (standby.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'od-empty';
      empty.textContent = '(素材集は空です — ページを右クリック→「素材集へ」で退避できます)';
      list.appendChild(empty);
    }
    document.getElementById('od-standby-count').textContent = standby.length;
    this.updateStandbySelection(standby.length);
  },

  /** 素材集の選択数・一括操作ボタンの状態を更新 */
  updateStandbySelection(total) {
    const n = this.standbySel ? this.standbySel.size : 0;
    document.getElementById('od-standby-selcount').textContent = n ? `${n} 件を選択中` : '';
    document.getElementById('od-standby-del-sel').disabled = n === 0;
    document.getElementById('od-standby-del-all').disabled = total === 0;
    const all = document.getElementById('od-standby-selall');
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
    all.disabled = total === 0;
    document.querySelectorAll('#od-standby-list .od-page').forEach((el) => {
      el.classList.toggle('od-standby-selected', !!(this.standbySel && this.standbySel.has(el.dataset.pageId)));
    });
  },

  /** 素材集のページを削除 (all=true: すべて / false: 選択したもの)。コーナーのページは削除しない */
  async deleteStandby(all) {
    const corner = this.currentCorner();
    if (!corner || !(corner.standby || []).length) return;
    const targets = all ? corner.standby.map((pg) => pg.id) : [...(this.standbySel || [])];
    if (!targets.length) return;
    const ok = await AppModal.confirm(
      all ? '素材集をすべて削除' : '選択したページを削除',
      `素材集から ${targets.length} 件のページを削除します。コーナーのページは削除されません。よろしいですか?`,
      { danger: true },
    );
    if (!ok) return;
    const del = new Set(targets);
    this.mutate(() => {
      corner.standby = corner.standby.filter((pg) => !del.has(pg.id));
    });
    this.standbySel = new Set();
    if (this.selectedPageId && del.has(this.selectedPageId)) {
      this.selectedPageId = null;
      this.renderEditor();
    }
    App.setStatus(`素材集から ${targets.length} 件を削除しました`, 'success');
  },

  // ===== 右サイドバー (テロップ編集) の折りたたみ =====

  RIGHT_COLLAPSED_KEY: 'telopgo.onairEditorCollapsed',
  RIGHT_AUTOCLOSE_KEY: 'telopgo.onairEditorAutoClose',

  _pref(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (_) { /* 保存できない環境 */ }
    return null;
  },

  initRightPanel() {
    document.getElementById('od-right-collapse').addEventListener('click', () => this.setRightCollapsed(true));
    document.getElementById('od-right-expand').addEventListener('click', () => this.setRightCollapsed(false));
    const auto = document.getElementById('od-right-autoclose');
    auto.checked = this._pref(this.RIGHT_AUTOCLOSE_KEY) === '1';
    auto.addEventListener('change', () => this._pref(this.RIGHT_AUTOCLOSE_KEY, auto.checked ? '1' : '0'));
    this.setRightCollapsed(this._pref(this.RIGHT_COLLAPSED_KEY) === '1');
  },

  /** テロップ編集を折りたたむ/開く (折りたたみ中は細い帯だけ残し、系統の列を広く使う) */
  setRightCollapsed(collapsed) {
    this.rightCollapsed = !!collapsed;
    document.getElementById('od-right').classList.toggle('hidden', this.rightCollapsed);
    document.getElementById('od-right-rail').classList.toggle('hidden', !this.rightCollapsed);
    this._pref(this.RIGHT_COLLAPSED_KEY, this.rightCollapsed ? '1' : '0');
    // 列幅が変わるのでOA/NEXTモニターの縮尺を合わせ直す
    if (this.loaded) {
      this.updateChannelMonitors();
      this.renderNextPreviews();
    }
  },

  // ===== 各列の送出ボタン (コンソール) の表示/非表示 =====

  CONSOLE_HIDDEN_KEY: 'telopgo.onairConsoleHidden',

  initConsoleToggle() {
    document.getElementById('od-console-toggle').addEventListener('click', () => this.setConsoleHidden(!this.consoleHidden));
    this.setConsoleHidden(this._pref(this.CONSOLE_HIDDEN_KEY) === '1');
  },

  /** リモコン/GPIO/キー操作の運用向け: 列下部の送出ボタン一式を隠して送出リストを広く見せる */
  setConsoleHidden(hidden) {
    this.consoleHidden = !!hidden;
    document.getElementById('od-columns').classList.toggle('od-columns--no-console', this.consoleHidden);
    const btn = document.getElementById('od-console-toggle');
    btn.textContent = this.consoleHidden ? '送出ボタンを表示' : '送出ボタンを隠す';
    btn.classList.toggle('active', this.consoleHidden);
    this._pref(this.CONSOLE_HIDDEN_KEY, this.consoleHidden ? '1' : '0');
  },

  /** TAKE後に呼ばれる: 設定がONならテロップ編集を折りたたむ */
  afterTake() {
    if (!this.rightCollapsed && document.getElementById('od-right-autoclose').checked) this.setRightCollapsed(true);
  },

  /** 状態色 (赤=ON AIR / 黄=NEXT / グレー=済み) をページ行へ反映 */
  applyRowStates() {
    const onAirIds = new Set();
    const nextIds = new Set();
    Object.values(App.broadcast).forEach((st) => {
      if (st.onAirPageId) onAirIds.add(st.onAirPageId);
      if (st.nextPageId) nextIds.add(st.nextPageId);
    });
    document.querySelectorAll('#od-columns .od-page, #od-standby-list .od-page').forEach((el) => {
      const id = el.dataset.pageId;
      el.classList.toggle('on-air', onAirIds.has(id));
      el.classList.toggle('next', nextIds.has(id) && !onAirIds.has(id));
      el.classList.toggle('played', this._playedPages.has(id) && !onAirIds.has(id) && !nextIds.has(id));
      el.classList.toggle('editing', id === this.selectedPageId);
    });
    // コーナーレールの進捗 (送出済み/全ページ) を更新
    this.updateCornerProgress();
    // 列フッタのNEXT/ON AIRバッジと強調を更新
    document.querySelectorAll('#od-columns .od-col').forEach((col) => {
      const ch = App.channelById(col.dataset.channelId);
      if (!ch) return;
      const active = ch.id === this.activeChannelId;
      col.classList.toggle('active', active);
      const st = App.chState(ch.id);
      const nextFound = st.nextPageId ? App.findPage(st.nextPageId) : null;
      const onAirFound = st.onAirPageId ? App.findPage(st.onAirPageId) : null;
      const nextBadge = col.querySelector('.od-col-badge.next');
      const onairBadge = col.querySelector('.od-col-badge.onair');
      if (nextBadge) nextBadge.textContent = `NEXT ${nextFound ? 'P' + nextFound.page.pageNo : '—'}`;
      if (onairBadge) {
        onairBadge.textContent = `ON AIR ${onAirFound ? 'P' + onAirFound.page.pageNo : '—'}`;
        onairBadge.classList.toggle('lit', !!onAirFound);
      }
    });
  },

  // ===== プレビュー =====

  /** 各列のNEXTモニターへ、その系統のNEXTページを描画 */
  renderNextPreviews() {
    document.querySelectorAll('#od-columns .od-col-next').forEach((host) => {
      const chId = host.dataset.channelId;
      const label = document.querySelector(`#od-columns .od-col-next-label[data-channel-id="${chId}"]`);
      const found = chId ? Broadcast.nextPage(chId) : null;
      if (!found) {
        host.innerHTML = '<div class="od-preview-empty">NEXT未設定</div>';
        if (label) label.textContent = 'NEXT';
        return;
      }
      const { page } = found;
      if (label) label.textContent = `NEXT P${page.pageNo}`;
      const variant = this.pageVariant(page);
      if (!variant) {
        host.innerHTML = '<div class="od-preview-empty">内容なし</div>';
        return;
      }
      host.innerHTML = '';
      const canvas = document.createElement('div');
      canvas.className = 'od-next-canvas';
      host.appendChild(canvas);
      TelopRenderer.renderVariant(canvas, variant, page.values || {}, {
        assetBase: (typeof DesignEditor !== 'undefined') ? DesignEditor.assetBase() : '/assets/',
      });
      this.fitNextCanvas(host);
      this.observeNextHost(host);
    });
  },

  /** NEXTモニターの描画を16:9でモニター枠にフィット */
  fitNextCanvas(host) {
    const canvas = host.querySelector('.od-next-canvas');
    if (canvas) canvas.style.transform = `scale(${host.clientWidth / 1920})`;
  },

  /**
   * 列幅が変わったら (TL追加・右ペイン開閉・ウィンドウサイズ変更・非表示からの表示) NEXTモニターを合わせ直す。
   * 描画時の幅で一度だけ縮尺を決めると、その後に列幅が変わったときに絵がはみ出したり小さく寄ったりする
   */
  observeNextHost(host) {
    if (typeof ResizeObserver === 'undefined' || host._fitObserved) return;
    if (!this._nextResizeObserver) {
      this._nextResizeObserver = new ResizeObserver((entries) => {
        entries.forEach((entry) => this.fitNextCanvas(entry.target));
      });
    }
    this._nextResizeObserver.observe(host);
    host._fitObserved = true;
  },

  /** 互換エイリアス (旧: 単一NEXTプレビュー) */
  renderNextPreview() {
    this.renderNextPreviews();
  },

  // ===== ページエディタ (右ペイン) =====

  templateLabel(key) {
    const labels = (typeof DesignEditor !== 'undefined' && DesignEditor.TEMPLATE_LABELS) || {};
    return labels[key] || key;
  },

  /** ページ種別のラベル (エディタ見出し用) */
  pageKindLabel(page) {
    if (page.kind === 'still') return '🖼 静止画';
    if (this.isEditedStill(page)) return '🖼 静止画 (編集済み)';
    if (page.kind === 'design') return '🎨 作画';
    return this.templateLabel(page.templateKey);
  },

  /**
   * 氏名テロップ系テンプレート(name-*)が持つ人物枠一覧を返す (このテンプレートに実在するbindingのみ)。
   * 名前テロップ以外のテンプレートでは空配列。
   */
  namePersonsFor(templateKey) {
    if (!templateKey || !templateKey.startsWith('name-')) return [];
    const tplInfo = App.templates[templateKey];
    if (!tplInfo) return [];
    const bindings = new Set(tplInfo.bindings);
    const nameFields = App.nameFields || {};
    // 設定タブ「氏名テロップの項目名」でスロットごとに変数名を変更していれば、それを優先する
    const slot = (key) => nameFields[key] || key;
    const persons = [];
    ['', '2nd', '3rd', '4th'].forEach((prefix) => {
      const nameJp = slot(prefix ? `${prefix}NameJp` : 'nameJp');
      if (!bindings.has(nameJp)) return;
      const titleJp = slot(prefix ? `${prefix}TitleJp` : 'titleJp');
      persons.push({
        nameJp,
        nameEn: slot(prefix ? `${prefix}NameEn` : 'nameEn'),
        titleJp,
        titleEn: slot(prefix ? `${prefix}TitleEn` : 'titleEn'),
        hasTitle: bindings.has(titleJp),
      });
    });
    return persons;
  },

  renderEditor() {
    const panel = document.getElementById('od-editor');
    // 入力中の欄があれば、作り直す前に値を確定し、作り直した後にフォーカス・カーソル位置を戻す
    // (TAKE/GPIO/オートフォローなどで再描画されても、打ちかけの文字が消えないように)
    if (!this._editorChangeHooked) {
      // 確定済みの値を覚えておく (未確定の入力があるときだけ change を発火させるため)
      // 欄自身の確定 (Enter/フォーカス移動) による再描画では、フォーカスを戻さない (移動先の欄を優先)
      panel.addEventListener('change', (e) => {
        e.target._committed = e.target.value;
        this._changingField = e.target;
        setTimeout(() => { this._changingField = null; }, 0);
      }, true);
      this._editorChangeHooked = true;
    }
    const active = document.activeElement;
    let restore = null;
    if (!this._restoringEditor && active !== this._changingField && active && panel.contains(active) && active.dataset.fieldKey
      && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type !== 'checkbox'))) {
      restore = {
        key: active.dataset.fieldKey, pageId: this._editorPageId,
        start: active.selectionStart, end: active.selectionEnd, scroll: panel.scrollTop,
      };
      if (active.value !== active._committed) {
        // change の処理から renderEditor が再び呼ばれても、ここへは戻らない
        this._restoringEditor = true;
        try { active.dispatchEvent(new Event('change')); } finally { this._restoringEditor = false; }
      }
    }
    panel.innerHTML = '';
    const found = this.selectedPageId ? App.findPage(this.selectedPageId) : null;
    this._editorPageId = found ? found.page.id : null;
    if (restore && restore.pageId === this._editorPageId) {
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body) return; // 既に別の欄へ移っている
        const el = panel.querySelector(`[data-field-key="${CSS.escape(restore.key)}"]`);
        if (!el || el.readOnly) return;
        el.focus();
        try { el.setSelectionRange(restore.start, restore.end); } catch (_) { /* number等は非対応 */ }
        panel.scrollTop = restore.scroll;
      });
    }
    const railLabel = document.getElementById('od-right-rail-label');
    if (railLabel) railLabel.textContent = found ? `テロップ編集　P${found.page.pageNo}` : 'テロップ編集';
    if (!found) {
      panel.innerHTML = '<div class="od-editor-empty">ページを選択すると内容を編集できます</div>';
      return;
    }
    const { page, corner } = found;
    const tplInfo = App.templates[page.templateKey] || { bindings: [] };
    // 名前プールから選択中の人物 (pi番目。該当なしはnull=手入力)
    const namePool = (App.rundown && App.rundown.namePool) || [];
    const personsInfo = this.namePersonsFor(page.templateKey);
    const poolSelEntries = personsInfo.map((_person, pi) => {
      const selected = page.namePoolSel && page.namePoolSel[pi];
      return (selected && namePool.find((p) => p.nameJp === selected)) || null;
    });

    const head = document.createElement('div');
    head.className = 'od-editor-head';
    head.textContent = `P${page.pageNo} — ${this.pageKindLabel(page)}`;
    panel.appendChild(head);

    const row = (label, input) => {
      const div = document.createElement('div');
      div.className = 'od-editor-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      div.appendChild(lab);
      div.appendChild(input);
      panel.appendChild(div);
      return div;
    };

    // ページ番号 / 尺
    const noInput = document.createElement('input');
    noInput.className = 'input input--small';
    noInput.dataset.fieldKey = 'pageNo';
    noInput.value = page.pageNo;
    noInput.addEventListener('change', () => this.mutate(() => { page.pageNo = noInput.value.trim() || page.pageNo; }));
    // 数値欄は全角数字も受け付ける (↑↓キーで増減)。解釈できない入力は元の値に戻す
    const durInput = DesignEditor.numInput({ min: '0' });
    durInput.className = 'input input--small';
    durInput.dataset.fieldKey = 'duration';
    durInput.value = page.duration || 0;
    durInput.title = '尺 (秒)。0=なし。コーナーのオートフォローONで自動送出に使われます (↑↓キーで増減)';
    durInput.addEventListener('change', () => {
      const v = DesignEditor.parseNum(durInput.value);
      if (!Number.isFinite(v)) { durInput.value = page.duration || 0; return; }
      this.mutate(() => { page.duration = Math.max(0, v); });
    });
    const noDur = document.createElement('div');
    noDur.className = 'od-editor-inline';
    noDur.appendChild(noInput);
    noDur.appendChild(durInput);
    row('番号 / 尺(秒)', noDur);

    // タイトル (全種別共通 — 一覧・ログでの識別用。空なら内容の要約を表示)
    {
      const titleInput = document.createElement('input');
      titleInput.className = 'input';
      titleInput.dataset.fieldKey = 'title';
      titleInput.value = page.title || '';
      titleInput.placeholder = 'テロップ名 (任意 — 一覧・ログでの識別用)';
      titleInput.addEventListener('change', () => this.mutate(() => { page.title = titleInput.value; }));
      row('タイトル', titleInput);
    }

    // 電テロ (静止画・作画): 画像の編集 / 表示方法 / IN・OUT効果
    if (page.kind === 'still' || page.kind === 'design') {
      this.renderImageEditRow(page, row);
      if (page.kind === 'still') {
        const fitSel = document.createElement('select');
        fitSel.className = 'input input--small';
        [['contain', '全体表示 (contain)'], ['cover', '画面いっぱい (cover)'], ['fill', '引き伸ばし (fill)']]
          .forEach(([v, lbl]) => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = lbl;
            fitSel.appendChild(opt);
          });
        fitSel.value = (page.still && page.still.objectFit) || 'contain';
        fitSel.addEventListener('change', () => {
          page.still = page.still || {};
          page.still.objectFit = fitSel.value;
          this._thumbCache.delete(this.thumbKey(page));
          App.saveRundown();
          this.renderColumns();
        });
        row('表示方法', fitSel);
      }
      // 静止画 (画像編集で作画になったものも含む) は、ページごとのIN/OUTエフェクトを選べる
      if (this.isStillLike(page)) this.renderStillEffectRows(page, corner, row);
    }

    // 名前プールから選択 (氏名テロップ系テンプレートで、名前プール読込済みの場合のみ表示)
    if (personsInfo.length && namePool.length) {
      const hint = document.createElement('div');
      hint.className = 'od-namepool-hint';
      hint.textContent = `名前プールから選択 (${namePool.length}名読込済み) — 選ぶと肩書・名前(日英)が自動入力されます。代入後も下の欄で手入力の修正ができます`;
      panel.appendChild(hint);

      personsInfo.forEach((person, pi) => {
        const sel = document.createElement('select');
        sel.className = 'input input--small';
        const manualOpt = document.createElement('option');
        manualOpt.value = 'manual';
        manualOpt.textContent = '— 手入力 —';
        sel.appendChild(manualOpt);
        namePool.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.nameJp;
          opt.textContent = p.titleJp ? `${p.nameJp}（${p.titleJp}）` : p.nameJp;
          sel.appendChild(opt);
        });
        sel.value = poolSelEntries[pi] ? poolSelEntries[pi].nameJp : 'manual';
        sel.addEventListener('change', () => {
          this.mutate(() => {
            page.namePoolSel = page.namePoolSel || [];
            if (sel.value === 'manual') {
              page.namePoolSel[pi] = null;
            } else {
              const entry = namePool.find((p) => p.nameJp === sel.value) || {};
              page.namePoolSel[pi] = sel.value;
              page.values = page.values || {};
              if (person.hasTitle) page.values[person.titleJp] = entry.titleJp || '';
              page.values[person.nameJp] = entry.nameJp || '';
              if (person.hasTitle) page.values[person.titleEn] = entry.titleEn || '';
              page.values[person.nameEn] = entry.nameEn || '';
            }
            this._thumbCache.delete(this.thumbKey(page));
          });
        });
        row(`${pi + 1}人目 名前選択`, sel);
      });
    }

    // プールから代入された欄 (代入後も手入力で編集できる。色で代入元が分かるようにする)
    const poolBindings = new Set();
    personsInfo.forEach((person, pi) => {
      if (!poolSelEntries[pi]) return;
      poolBindings.add(person.nameJp);
      poolBindings.add(person.nameEn);
      if (person.hasTitle) { poolBindings.add(person.titleJp); poolBindings.add(person.titleEn); }
    });

    // フィールド (テンプレートのbinding)
    const guides = tplInfo.guides || {};
    tplInfo.bindings.forEach((binding) => {
      // 手入力欄はすべて改行可 (Enterで改行・Ctrl+Enterで確定)。名前(JP)だけは名前プール補完付きの1行input
      const multiline = !/nameJp$/i.test(binding);
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = 'input od-field-input';
      input.dataset.fieldKey = `v:${binding}`;
      if (multiline) {
        input.rows = 1;
        input.placeholder = 'Enterで改行 / Ctrl+Enterで確定';
        const fit = () => {
          if (!input.isConnected || !input.offsetParent) return; // 非表示 (サイドバー折りたたみ中) は測れない
          input.style.height = 'auto';
          input.style.height = `${input.scrollHeight + 2}px`;
        };
        input.addEventListener('input', fit);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); input.blur(); }
        });
        requestAnimationFrame(fit);
      } else {
        input.setAttribute('list', 'od-namepool');
      }
      input.value = (page.values && page.values[binding]) || '';
      if (poolBindings.has(binding)) {
        input.classList.add('od-field-from-pool');
        input.title = '名前プールから代入済み — このまま手入力で編集できます (プルダウンで選び直すと上書きされます)';
      }
      input.addEventListener('change', () => {
        page.values = page.values || {};
        page.values[binding] = input.value;
        this._thumbCache.delete(this.thumbKey(page));
        App.saveRundown();
        this.renderColumns();
      });
      // ガイド (デザインで任意設定した日本語などの項目名) があれば、変数名の代わりに表示する
      const fieldRow = row(guides[binding] || binding, input);
      if (guides[binding]) {
        const lab = fieldRow.querySelector('label');
        lab.title = `変数: ${binding}`;
        const code = document.createElement('span');
        code.className = 'od-field-var';
        code.textContent = binding;
        lab.appendChild(code);
      }
    });

    // メモ / ロック
    const noteInput = document.createElement('input');
    noteInput.className = 'input';
    noteInput.dataset.fieldKey = 'note';
    noteInput.value = page.note || '';
    noteInput.placeholder = 'オペレーションメモ';
    noteInput.addEventListener('change', () => this.mutate(() => { page.note = noteInput.value; }));
    row('メモ', noteInput);

    const lockLabel = document.createElement('label');
    lockLabel.className = 'od-lock-label';
    const lockInput = document.createElement('input');
    lockInput.type = 'checkbox';
    lockInput.checked = !!page.locked;
    lockInput.addEventListener('change', () => this.mutate(() => { page.locked = lockInput.checked; Broadcast.onPageLockChanged(page); }));
    lockLabel.appendChild(lockInput);
    lockLabel.appendChild(document.createTextNode(' 送出ロック (誤TAKE防止)'));
    panel.appendChild(lockLabel);

    // オンエア中ページなら「オンエアへ反映」
    const channelId = App.channelOfPage(page);
    const st = channelId ? App.chState(channelId) : null;
    if (st && st.onAirPageId === page.id) {
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn od-apply-btn';
      applyBtn.textContent = '⚡ オンエアへ反映 (訂正)';
      applyBtn.addEventListener('click', () => Broadcast.applyOnAirEdit(channelId));
      panel.appendChild(applyBtn);
    }
    panel.querySelectorAll('[data-field-key]').forEach((el) => { el._committed = el.value; });
    void corner;
  },

  // ===== サムネイル =====

  /** ページ検索: 番号/タイトル/内容要約/テンプレ名のいずれかに一致するか */
  matchPage(page) {
    const q = this.searchQuery.toLowerCase();
    if (!q) return true;
    const hay = [
      String(page.pageNo || ''),
      page.title || '',
      Broadcast.summarize(page) || '',
      page.templateKey ? this.templateLabel(page.templateKey) : '',
      Object.values(page.values || {}).join(' '),
    ].join(' ').toLowerCase();
    return hay.includes(q);
  },

  /** ページ種別に応じた描画バリアント (サムネ/プレビュー/出力の共通ソース) */
  pageVariant(page) {
    if (page.kind === 'still') return this.stillVariant(page.still);
    if (page.kind === 'design') return (page.design && page.design.variant) || null;
    const tpl = App.graphicsProject && App.graphicsProject.templates[page.templateKey];
    return (tpl && tpl.variants && tpl.variants.jp) || null;
  },

  /** 静止画1枚を全画面(1920x1080)に敷くバリアント */
  stillVariant(still) {
    if (!still || !still.file) return null;
    return {
      layers: [{
        id: 'still', type: 'image', x: 0, y: 0, w: 1920, h: 1080,
        file: still.file, objectFit: still.objectFit || 'contain', visible: true,
      }],
      animation: still.animation || {},
    };
  },

  // ===== 電テロ (静止画) のIN/OUTエフェクト =====

  /** 静止画で選べるエフェクト (文字送りは文字レイヤー専用のため除外) */
  STILL_EFFECTS: [
    ['cut', 'カット'], ['fade', 'フェード'], ['slide', 'スライド'], ['wipe', 'ワイプ'], ['push', 'プッシュ'],
    ['pop', 'ポップ'], ['zoom', 'ズーム'], ['blur', 'ブラー'], ['flip', 'フリップ'],
  ],
  STILL_EFFECT_DIRS: [['up', '↑ 上'], ['down', '↓ 下'], ['left', '← 左'], ['right', '→ 右']],
  /** 未設定時の既定 (TelopAnimator の既定と同じ) */
  STILL_EFFECT_DEFAULT: { preset: 'fade', duration: 350 },

  /** 画像編集で作画になった静止画か (元の静止画を覚えている作画ページ) */
  isEditedStill(page) {
    return !!(page && page.kind === 'design' && page.design && page.design.fromStill);
  },

  /** ページごとのIN/OUTエフェクトを選べるページ (静止画 / 編集済みの静止画) */
  isStillLike(page) {
    return !!page && (page.kind === 'still' || this.isEditedStill(page));
  },

  /** IN/OUTエフェクトの置き場所: 静止画は still.animation、編集済みは作画の variant.animation */
  effectHolder(page, create) {
    if (page.kind === 'still') {
      if (create) page.still = page.still || {};
      return page.still || null;
    }
    if (this.isEditedStill(page)) return page.design.variant || null;
    return null;
  },

  stillEffect(page, dir) {
    const holder = this.effectHolder(page);
    const a = holder && holder.animation && holder.animation[dir];
    return Object.assign({}, this.STILL_EFFECT_DEFAULT, a || {});
  },

  /** 静止画ページのIN/OUTエフェクト (種類・方向・秒数) と一括適用の行を描く */
  renderStillEffectRows(page, corner, row) {
    const setEffect = (dir, patch) => {
      this.mutate(() => {
        const holder = this.effectHolder(page, true);
        if (!holder) return;
        const next = Object.assign(this.stillEffect(page, dir), patch);
        holder.animation = holder.animation || {};
        holder.animation[dir] = next;
      });
    };
    ['in', 'out'].forEach((dir) => {
      const eff = this.stillEffect(page, dir);
      const wrap = document.createElement('div');
      wrap.className = 'od-editor-inline od-effect-inline';

      const presetSel = document.createElement('select');
      presetSel.className = 'input input--small';
      this.STILL_EFFECTS.forEach(([v, lbl]) => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = lbl;
        presetSel.appendChild(opt);
      });
      presetSel.value = eff.preset;
      presetSel.addEventListener('change', () => setEffect(dir, { preset: presetSel.value }));
      wrap.appendChild(presetSel);

      if (['slide', 'wipe', 'push'].includes(eff.preset)) {
        const dirSel = document.createElement('select');
        dirSel.className = 'input input--small';
        dirSel.title = 'スライド/プッシュ=進入方向、ワイプ=拭き出し方向';
        this.STILL_EFFECT_DIRS.forEach(([v, lbl]) => {
          const opt = document.createElement('option');
          opt.value = v; opt.textContent = lbl;
          dirSel.appendChild(opt);
        });
        dirSel.value = eff.direction || (eff.preset === 'wipe' ? 'right' : 'up');
        dirSel.addEventListener('change', () => setEffect(dir, { direction: dirSel.value }));
        wrap.appendChild(dirSel);
      }

      if (eff.preset !== 'cut') {
        const secInput = DesignEditor.numInput({ min: '0', step: '0.1' });
        secInput.className = 'input input--small od-effect-sec';
        secInput.dataset.fieldKey = `still-${dir}-sec`;
        secInput.value = Math.round(eff.duration) / 1000;
        secInput.title = 'エフェクトの秒数 (↑↓キーで増減)';
        secInput.addEventListener('change', () => {
          const v = DesignEditor.parseNum(secInput.value);
          if (!Number.isFinite(v)) { secInput.value = Math.round(eff.duration) / 1000; return; }
          setEffect(dir, { duration: Math.round(Math.max(0, v) * 1000) });
        });
        wrap.appendChild(secInput);
        const unit = document.createElement('span');
        unit.className = 'od-editor-unit';
        unit.textContent = '秒';
        wrap.appendChild(unit);
      }
      row(dir === 'in' ? 'IN 効果' : 'OUT 効果', wrap).title = `${dir.toUpperCase()}エフェクト (種類・方向・秒数)`;
    });

    const bulk = document.createElement('button');
    bulk.className = 'btn btn--small od-effect-bulk';
    bulk.textContent = '他の静止画へ一括適用…';
    bulk.addEventListener('click', (e) => {
      e.stopPropagation();
      const channelId = App.channelOfPage(page);
      const stills = (list) => list.filter((pg) => this.isStillLike(pg) && pg !== page);
      const cornerPages = [...(corner.pages || []), ...(corner.standby || [])];
      const allPages = App.corners().flatMap((c) => [...(c.pages || []), ...(c.standby || [])]);
      const targets = [
        ['このコーナーの同じ系統', stills(cornerPages.filter((pg) => App.channelOfPage(pg) === channelId))],
        ['このコーナーのすべて', stills(cornerPages)],
        ['この放送の全コーナー', stills(allPages)],
      ];
      this.showMenu(e, targets.map(([label, list]) => ({
        label: `${label} (${list.length}件)`,
        disabled: list.length === 0,
        action: () => this.applyStillEffects(page, list, label),
      })));
    });
    const bulkRow = row('一括適用', bulk);
    bulkRow.title = 'このページのIN/OUTエフェクト (種類・方向・秒数) を他の静止画ページへコピーします';
  },

  async applyStillEffects(srcPage, targets, label) {
    if (!targets.length) return;
    const ok = await AppModal.confirm('エフェクトの一括適用',
      `${label}の静止画 ${targets.length} 件に、P${srcPage.pageNo} のIN/OUTエフェクトを適用します。よろしいですか?`);
    if (!ok) return;
    const animation = { in: this.stillEffect(srcPage, 'in'), out: this.stillEffect(srcPage, 'out') };
    this.mutate(() => {
      targets.forEach((pg) => {
        const holder = this.effectHolder(pg, true);
        if (holder) holder.animation = JSON.parse(JSON.stringify(animation));
      });
    });
    App.setStatus(`静止画 ${targets.length} 件にIN/OUTエフェクトを適用しました`, 'success');
  },

  // ===== ページの切り取り / コピー / 貼り付け (Ctrl+X / Ctrl+C / Ctrl+V) =====

  _pageClipboard: null,

  isPageOnAir(page) {
    return Object.values(App.broadcast || {}).some((st) => st && st.onAirPageId === page.id);
  },

  copyPage(page) {
    this._pageClipboard = JSON.parse(JSON.stringify(page));
    App.setStatus(`P${page.pageNo} をコピーしました (Ctrl+V で貼り付け)`, 'success');
  },

  cutPage(page, corner, listName) {
    if (this.isPageOnAir(page)) { App.setStatus('送出中のページは切り取れません', 'error'); return; }
    this._pageClipboard = JSON.parse(JSON.stringify(page));
    this.mutate(() => {
      const list = corner[listName];
      list.splice(list.indexOf(page), 1);
      Object.values(App.broadcast || {}).forEach((st) => { if (st && st.nextPageId === page.id) st.nextPageId = null; });
      if (this.selectedPageId === page.id) this.selectedPageId = null;
    });
    this.renderEditor();
    App.setStatus(`P${page.pageNo} を切り取りました (貼り付け先のページを選んで Ctrl+V)`, 'success');
  },

  /** 選択中ページの直後へ貼り付け (未選択なら表示中コーナーの末尾) */
  pastePage() {
    const clip = this._pageClipboard;
    if (!clip) return;
    const found = this.selectedPageId ? App.findPage(this.selectedPageId) : null;
    const corner = found ? found.corner : this.currentCorner();
    if (!corner) return;
    const listName = found ? found.list : 'pages';
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = this.uid('pg');
    const used = App.corners().some((c) => [...c.pages, ...(c.standby || [])].some((pg) => String(pg.pageNo) === String(copy.pageNo)));
    if (used) copy.pageNo = this.nextPageNo(corner);
    // 電テロページは貼り付け先の系統へ (リアルタイムCGはテンプレートで系統が決まる)
    if (copy.channelId) {
      const dest = found ? App.channelOfPage(found.page) : this.activeChannelId;
      if (dest && App.channelById(dest)) copy.channelId = dest;
    }
    this.mutate(() => {
      corner[listName] = corner[listName] || [];
      const list = corner[listName];
      const idx = found ? list.indexOf(found.page) + 1 : list.length;
      list.splice(idx, 0, copy);
      this.selectedPageId = copy.id;
    });
    this.renderEditor();
    App.setStatus(`P${copy.pageNo} を貼り付けました`, 'success');
  },

  thumbKey(page) {
    if (page.kind === 'still') return `still|${page.still ? `${page.still.file}|${page.still.objectFit || ''}` : ''}`;
    if (page.kind === 'design') return `design|${page.id}|${(page.design && page.design.rev) || 0}`;
    return `${page.templateKey}|${JSON.stringify(page.values || {})}`;
  },

  queueThumb(page, img) {
    const key = this.thumbKey(page);
    const cached = this._thumbCache.get(key);
    if (cached) {
      img.src = cached;
      return;
    }
    this._thumbQueue.push({ page, img, key });
    this.pumpThumbs();
  },

  async pumpThumbs() {
    if (this._thumbBusy) return;
    this._thumbBusy = true;
    while (this._thumbQueue.length > 0) {
      const { page, img, key } = this._thumbQueue.shift();
      const cached = this._thumbCache.get(key);
      if (cached) {
        img.src = cached;
        continue;
      }
      try {
        const variant = this.pageVariant(page);
        if (!variant || typeof DesignEditor === 'undefined') continue;
        const canvas = await DesignEditor.renderVariantToCanvas(variant, page.values || {}, 240 / 1920);
        const url = canvas.toDataURL('image/png');
        this._thumbCache.set(key, url);
        if (this._thumbCache.size > 500) {
          const first = this._thumbCache.keys().next().value;
          this._thumbCache.delete(first);
        }
        if (img.isConnected) img.src = url;
      } catch (_) { /* サムネ失敗は無視 */ }
    }
    this._thumbBusy = false;
  },

  // ===== ページ操作 =====

  nextPageNo(corner) {
    const idx = App.corners().indexOf(corner);
    const base = (idx + 1) * 100;
    const used = new Set();
    App.corners().forEach((c) => {
      [...c.pages, ...(c.standby || [])].forEach((pg) => used.add(String(pg.pageNo)));
    });
    for (let i = 1; i < 100; i++) {
      if (!used.has(String(base + i))) return String(base + i);
    }
    return String(base + 99);
  },

  uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}`;
  },

  openPageDialog(mode, preferChannelId) {
    this._pageDialogMode = mode;
    const sel = document.getElementById('od-page-template');
    sel.innerHTML = '';
    Object.keys(App.templates).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      const ch = App.channelById(App.templates[key].region);
      opt.textContent = `${this.templateLabel(key)}${ch ? ` [${ch.label}]` : ''}`;
      sel.appendChild(opt);
    });
    // 系統の＋から開いた場合はその系統のテンプレートを既定選択
    if (preferChannelId) {
      const firstForCh = Object.keys(App.templates).find((k) => App.templates[k].region === preferChannelId);
      if (firstForCh) sel.value = firstForCh;
    }
    document.getElementById('od-page-dialog-title').textContent = {
      excel: 'Excel取込 — テンプレートを選択',
      template: 'Excelテンプレ書き出し — テンプレートを選択',
    }[mode] || 'ページ追加 — テンプレートを選択';
    document.getElementById('od-page-dialog-hint').textContent = {
      excel: '選んだテンプレートの列順 (フィールド順) でExcelを読み込みます (1行目は見出しとして読み飛ばし、2行目以降の1行=1ページ)。列の見本は「Excelテンプレを書き出し…」で出力できます',
      template: '選んだテンプレートの入力用Excelを書き出します。1行目=見出し (レイヤー名と項目名)、2行目=見本。2行目以降に入力して「Excel取込」で読み込めます',
    }[mode] || '追加するページのテンプレートを選んでください';
    document.getElementById('od-page-dialog-template').classList.toggle('hidden', mode !== 'excel');
    document.getElementById('od-page-dialog-cols').classList.toggle('hidden', mode !== 'excel' && mode !== 'template');
    document.getElementById('od-page-dialog-dest-row').classList.toggle('hidden', mode !== 'excel');
    document.getElementById('od-page-dest').value = 'pages';
    document.getElementById('od-page-dialog-ok').textContent = mode === 'template' ? '書き出し…' : mode === 'excel' ? 'ファイルを選んで読み込む…' : 'OK';
    this.renderExcelColumns();
    document.getElementById('od-page-dialog').showModal();
  },

  /** ダイアログで選んだテンプレートの「Excelの列」(A=…, B=…) を表示 */
  renderExcelColumns() {
    const table = document.getElementById('od-page-dialog-cols-table');
    if (!table) return;
    const key = document.getElementById('od-page-template').value;
    const cols = App.excelColumns(key);
    table.innerHTML = '';
    if (!cols.length) {
      table.innerHTML = '<tr><td class="od-xl-empty">このテンプレートには Excel の列として使う文字フィールドがありません</td></tr>';
      return;
    }
    const head = document.createElement('tr');
    ['列', '見出し', '変数', '見本'].forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      head.appendChild(th);
    });
    table.appendChild(head);
    cols.forEach((c, i) => {
      const tr = document.createElement('tr');
      [this.excelColName(i), c.header || c.label || c.binding, c.binding, c.sample].forEach((t, ci) => {
        const td = document.createElement('td');
        td.textContent = t || '';
        if (ci === 0) td.className = 'od-xl-colname';
        if (ci === 2) td.className = 'od-xl-mono';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
  },

  /** 0→A, 25→Z, 26→AA (Excelの列名) */
  excelColName(i) {
    let n = i + 1;
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  },

  /** デザインタブの「変数/Excel」でこのテンプレートの列を設定する */
  async openExcelColumnSettings(templateKey) {
    const btn = document.querySelector('.tab-btn[data-tab="design"]');
    if (btn) btn.click();
    if (typeof DesignEditor === 'undefined') return;
    await DesignEditor.onShow();
    if (DesignEditor.project && DesignEditor.project.templates[templateKey]) {
      DesignEditor.templateKey = templateKey;
      DesignEditor.clearSelection();
      DesignEditor.refreshTemplateSelect();
    }
    DesignEditor.propsTab = 'vars';
    DesignEditor.renderAll();
    DesignEditor.showPropsTab('vars');
  },

  async submitPageDialog() {
    const templateKey = document.getElementById('od-page-template').value;
    document.getElementById('od-page-dialog').close();
    const corner = this.currentCorner();
    if (!corner || !templateKey) return;

    if (this._pageDialogMode === 'template') {
      await this.exportExcelTemplate(templateKey);
      return;
    }

    if (this._pageDialogMode === 'excel') {
      const dest = document.getElementById('od-page-dest').value === 'standby' ? 'standby' : 'pages';
      const result = await window.api.excelImportPages(templateKey);
      if (!result) return;
      if (!result.success) {
        App.setStatus(`Excel取込エラー: ${result.error}`, 'error');
        return;
      }
      if (!result.pages.length) {
        App.setStatus('Excelに取り込める行がありません (1行目は見出しとして読み飛ばします)', 'error');
        return;
      }
      this.openExcelPreview({ corner, templateKey, dest, pages: result.pages, filePath: result.filePath });
      return;
    }

    const page = {
      id: this.uid('pg'), pageNo: this.nextPageNo(corner), kind: 'cg', templateKey,
      values: {}, note: '', duration: 0, locked: false,
    };
    this.mutate(() => corner.pages.push(page));
    this.selectedPageId = page.id;
    this.renderEditor();
    this.applyRowStates();
  },

  /** Excel取込: 読み込み内容 (先頭の行) を確認してから取り込む */
  openExcelPreview(pending) {
    this._pendingExcel = pending;
    const cols = App.excelColumns(pending.templateKey);
    const file = String(pending.filePath || '').split(/[\\/]/).pop();
    const destLabel = pending.dest === 'standby' ? '素材集' : `コーナー「${pending.corner.name}」の末尾`;
    document.getElementById('od-xl-preview-summary').textContent =
      `${file} — ${pending.pages.length} ページ (テンプレート: ${this.templateLabel(pending.templateKey)} / 取込先: ${destLabel})`;
    const table = document.getElementById('od-xl-preview-table');
    table.innerHTML = '';
    const head = document.createElement('tr');
    ['行'].concat(cols.map((c, i) => `${this.excelColName(i)} ${c.header || c.label || c.binding}`)).forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      head.appendChild(th);
    });
    table.appendChild(head);
    const SHOW = 10;
    pending.pages.slice(0, SHOW).forEach((values, ri) => {
      const tr = document.createElement('tr');
      const no = document.createElement('td');
      no.className = 'od-xl-colname';
      no.textContent = String(ri + 2); // 1行目は見出し
      tr.appendChild(no);
      cols.forEach((c) => {
        const td = document.createElement('td');
        td.textContent = values[c.binding] || '';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    document.getElementById('od-xl-preview-more').textContent =
      pending.pages.length > SHOW ? `ほか ${pending.pages.length - SHOW} 行` : '';
    document.getElementById('od-xl-preview-ok').textContent = `${pending.pages.length} ページを取り込む`;
    document.getElementById('od-xl-preview').showModal();
  },

  commitExcelImport() {
    const pending = this._pendingExcel;
    document.getElementById('od-xl-preview').close();
    this._pendingExcel = null;
    if (!pending) return;
    const { corner, templateKey, dest, pages } = pending;
    this.mutate(() => {
      if (dest === 'standby') corner.standby = corner.standby || [];
      pages.forEach((values) => {
        corner[dest].push({
          id: this.uid('pg'), pageNo: this.nextPageNo(corner), templateKey,
          values, note: '', duration: 0, locked: false,
        });
      });
    });
    if (dest === 'standby') document.getElementById('od-standby').classList.remove('hidden');
    App.setStatus(`Excelから${pages.length}ページを${dest === 'standby' ? '素材集' : 'コーナー'}へ取り込みました`, 'success');
  },

  /** 入力用Excelテンプレ (列見出し+見本行) を書き出す */
  async exportExcelTemplate(templateKey) {
    if (!templateKey || !window.api.downloadTemplate) return;
    const result = await window.api.downloadTemplate(templateKey);
    if (!result) return;
    if (result.success) App.setStatus(`Excelテンプレを書き出しました: ${result.filePath}`, 'success');
    else if (result.error) App.setStatus(`Excelテンプレの書き出しエラー: ${result.error}`, 'error');
  },

  // ===== 電テロ (静的) ページの追加 =====

  /** コーナーのモードに応じて適切な追加フローを開く */
  addPageForChannel(channelId) {
    if (App.activeMode === 'telop') this.openTelopDialog(channelId);
    else this.openPageDialog('add', channelId);
  },

  openTelopDialog(channelId) {
    this._telopChannelId = channelId || this.activeChannelId;
    const sel = document.getElementById('od-telop-design');
    sel.innerHTML = '';
    Object.keys(App.templates).forEach((key) => {
      const opt = document.createElement('option');
      opt.value = key;
      const ch = App.channelById(App.templates[key].region);
      opt.textContent = `${this.templateLabel(key)}${ch ? ` [${ch.label}]` : ''}`;
      sel.appendChild(opt);
    });
    document.getElementById('od-telop-source').value = 'design';
    document.getElementById('od-telop-design-row').classList.toggle('hidden', Object.keys(App.templates).length === 0);
    document.getElementById('od-telop-dialog').showModal();
  },

  async submitTelopDialog() {
    const source = document.getElementById('od-telop-source').value;
    const channelId = this._telopChannelId;
    const corner = this.currentCorner();
    document.getElementById('od-telop-dialog').close();
    if (!corner || !channelId) return;
    if (source === 'design') {
      const key = document.getElementById('od-telop-design').value;
      if (key) this.addDesignPage(corner, channelId, key);
    } else {
      const res = await window.api.graphicsImportAsset();
      if (res === null) return; // キャンセル
      if (!res.ok) { App.setStatus(`画像取込エラー: ${res.error}`, 'error'); return; }
      this.addStillPage(corner, channelId, res.file, '');
    }
  },

  /** アプリ内デザインを1枚絵として固定コピーし電テロページを追加 */
  addDesignPage(corner, channelId, templateKey) {
    const tpl = App.graphicsProject && App.graphicsProject.templates[templateKey];
    const variant = tpl && tpl.variants && tpl.variants.jp;
    if (!variant) { App.setStatus('デザインが見つかりません', 'error'); return; }
    const page = {
      id: this.uid('pg'), pageNo: this.nextPageNo(corner), kind: 'design', channelId,
      design: { variant: JSON.parse(JSON.stringify(variant)) },
      title: this.templateLabel(templateKey),
      values: {}, note: '', duration: 0, locked: false,
    };
    this.mutate(() => corner.pages.push(page));
    this.selectedPageId = page.id;
    App.setStatus('作画を電テロリストへ追加しました (以後テンプレートを編集しても固定です)', 'success');
  },

  // ===== 電テロの画像編集 (デザイン画面で位置調整・文字/図形の追加) =====

  /** テロップ編集の「画像の編集」行 (画像を編集… / 元の画像に戻す) */
  renderImageEditRow(page, row) {
    const wrap = document.createElement('div');
    wrap.className = 'od-editor-inline od-imgedit-inline';
    const edit = document.createElement('button');
    edit.className = 'btn btn--small btn--primary';
    const isDesign = page.kind === 'design' && !this.isEditedStill(page);
    edit.textContent = isDesign ? '作画を編集…' : '画像を編集…';
    edit.title = 'デザイン画面で開いて、位置・大きさの調整や文字・図形・画像の追加をします (Ctrl+E)。保存するとこのページだけに反映されます';
    edit.addEventListener('click', () => this.editPageImage(page));
    wrap.appendChild(edit);
    if (this.isEditedStill(page)) {
      const revert = document.createElement('button');
      revert.className = 'btn btn--small';
      revert.textContent = '元の画像に戻す';
      revert.title = '編集 (文字・位置調整など) を取り消して、取り込んだときの静止画に戻します';
      revert.addEventListener('click', () => this.revertPageImage(page));
      wrap.appendChild(revert);
    }
    row(isDesign ? '作画' : '画像の編集', wrap);
  },

  /** 画像の実寸 (読めなければ null) */
  loadImageSize(file) {
    return new Promise((resolve) => {
      if (!file || typeof DesignEditor === 'undefined') { resolve(null); return; }
      const img = new Image();
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => { clearTimeout(timer); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = DesignEditor.assetBase() + encodeURIComponent(file);
    });
  },

  /**
   * 静止画を編集用の作画に変換する: 画像を1枚のレイヤーとして、今の表示方法 (全体表示/画面いっぱい/引き伸ばし) と
   * 同じ見え方になる位置・大きさで置く。IN/OUTエフェクトも引き継ぐ
   */
  async stillToVariant(page) {
    const still = page.still || {};
    const fit = still.objectFit || 'contain';
    const size = fit === 'fill' ? null : await this.loadImageSize(still.file);
    let box = { x: 0, y: 0, w: 1920, h: 1080 };
    let objectFit = fit;
    if (size && size.w > 0 && size.h > 0) {
      const scale = fit === 'cover' ? Math.max(1920 / size.w, 1080 / size.h) : Math.min(1920 / size.w, 1080 / size.h);
      const w = Math.round(size.w * scale);
      const h = Math.round(size.h * scale);
      box = { x: Math.round((1920 - w) / 2), y: Math.round((1080 - h) / 2), w, h };
      objectFit = 'fill'; // 枠を画像の縦横比に合わせたので、そのまま敷けば同じ見え方になる (Shift+角で比率を保って拡縮)
    }
    return {
      layers: [{
        id: `ly_${Math.random().toString(36).slice(2, 9)}`, name: `元画像 ${String(still.file || '').replace(/^\d+_/, '')}`,
        type: 'image', file: still.file, ...box, objectFit, visible: true, locked: false, opacity: 1,
      }],
      animation: { in: this.stillEffect(page, 'in'), out: this.stillEffect(page, 'out') },
    };
  },

  /** 送出リストのページ (静止画・作画) をデザイン画面で開く */
  async editPageImage(page) {
    if (!page || (page.kind !== 'still' && page.kind !== 'design') || typeof DesignEditor === 'undefined') return;
    const variant = page.kind === 'still' ? await this.stillToVariant(page) : (page.design && page.design.variant);
    if (!variant) { App.setStatus('このページには編集できる絵柄がありません', 'error'); return; }
    const channel = App.channelById(App.channelOfPage(page));
    const title = `P${page.pageNo} ${Broadcast.summarize(page)}`;
    const pageId = page.id;
    const btn = document.querySelector('.tab-btn[data-tab="design"]');
    if (btn) btn.click();
    await DesignEditor.beginPageEdit({
      pageId, title, region: channel ? channel.region : '', variant,
      onSave: (edited) => this.applyPageEdit(pageId, edited),
    });
  },

  /** 画像編集の結果をページへ書き戻す (2台運用の同期でランダウンが差し替わっていても、IDで探し直す) */
  applyPageEdit(pageId, variant) {
    const found = App.findPage(pageId);
    if (!found) { App.setStatus('編集したページが見つかりません (削除された可能性があります)', 'error'); return; }
    const { page } = found;
    this.mutate(() => {
      if (page.kind === 'still') {
        const original = JSON.parse(JSON.stringify(page.still || {}));
        if (!page.title && original.file) page.title = String(original.file).replace(/^\d+_/, '').replace(/\.[^.]+$/, '');
        page.kind = 'design';
        page.design = { variant, fromStill: original, rev: Date.now() };
        delete page.still;
      } else {
        // rev はサムネイルのキャッシュ用。元に戻す/やり直しで同じ番号が別の絵柄を指さないよう時刻にする
        page.design = Object.assign({}, page.design, { variant, rev: Date.now() });
      }
      this.selectedPageId = page.id;
    });
    const onAir = this.isPageOnAir(page);
    App.setStatus(onAir
      ? `P${page.pageNo} の画像を保存しました — 送出中のページです。出力へ出すには「オンエアへ反映」を押してください`
      : `P${page.pageNo} の画像を保存しました (このページだけに反映。元の画像ファイルは残っています)`, 'success');
  },

  /** 画像編集を取り消して、取り込んだときの静止画へ戻す */
  async revertPageImage(page) {
    if (!this.isEditedStill(page)) return;
    if (!(await AppModal.confirm('元の画像に戻す', `P${page.pageNo} の画像編集 (文字・位置調整など) を取り消して、取り込んだときの静止画に戻しますか?`, { danger: true, okLabel: '元に戻す' }))) return;
    this.mutate(() => {
      const still = page.design.fromStill || {};
      // 編集中に変えたIN/OUTエフェクトは戻した静止画にも残す
      const anim = page.design.variant && page.design.variant.animation;
      page.kind = 'still';
      page.still = Object.assign({}, still, anim ? { animation: JSON.parse(JSON.stringify(anim)) } : {});
      delete page.design;
    });
    App.setStatus(`P${page.pageNo} を元の画像に戻しました`, 'success');
  },

  /** 静止画ファイル(取込済みファイル名)から電テロページを追加 */
  addStillPage(corner, channelId, file, title) {
    const page = {
      id: this.uid('pg'), pageNo: this.nextPageNo(corner), kind: 'still', channelId,
      still: { file, objectFit: 'contain' },
      title: title || '', values: {}, note: '', duration: 0, locked: false,
    };
    this.mutate(() => corner.pages.push(page));
    this.selectedPageId = page.id;
  },

  /** ドロップされた画像ファイルを取り込み、静止画ページを順に追加 */
  async importDroppedFiles(corner, channelId, fileList) {
    if (!channelId) { App.setStatus('取込先の系統が特定できません', 'error'); return; }
    const files = [...fileList].filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
    if (files.length === 0) { App.setStatus('画像ファイルではありません', 'error'); return; }
    let added = 0;
    for (const f of files) {
      let res;
      try {
        if (f.path) {
          res = await window.api.graphicsImportAsset(f.path);
        } else {
          const buf = new Uint8Array(await f.arrayBuffer());
          res = await window.api.graphicsImportAsset({ name: f.name, data: buf });
        }
      } catch (err) { res = { ok: false, error: err.message }; }
      if (res && res.ok) { this.addStillPage(corner, channelId, res.file, f.name.replace(/\.[^.]+$/, '')); added++; }
      else App.setStatus(`取込失敗: ${(res && res.error) || f.name}`, 'error');
    }
    if (added > 0) App.setStatus(`静止画${added}枚を電テロリストへ取り込みました`, 'success');
  },

  movePageBefore(pageId, beforePageId, corner, listName) {
    this.mutate(() => {
      const src = App.findPage(pageId);
      if (!src) return;
      src.corner[src.list].splice(src.corner[src.list].indexOf(src.page), 1);
      const destList = corner[listName];
      if (beforePageId) {
        const idx = destList.findIndex((pg) => pg.id === beforePageId);
        destList.splice(idx < 0 ? destList.length : idx, 0, src.page);
      } else {
        destList.push(src.page);
      }
    });
  },

  // ===== コンテキストメニュー =====

  closeContextMenu() {
    const menu = document.getElementById('od-context-menu');
    if (menu) menu.remove();
  },

  showMenu(e, items) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'od-context-menu';
    menu.className = 'od-context-menu';
    items.forEach((item) => {
      if (!item) return;
      const btn = document.createElement('button');
      btn.textContent = item.label;
      if (item.kbd) {
        const kbd = document.createElement('span');
        kbd.className = 'od-menu-kbd';
        kbd.textContent = item.kbd;
        btn.appendChild(kbd);
      }
      if (item.danger) btn.classList.add('danger');
      if (item.disabled) btn.disabled = true;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.closeContextMenu();
        item.action();
      });
      menu.appendChild(btn);
    });
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - items.length * 34 - 10)}px`;
    document.body.appendChild(menu);
  },

  showPageMenu(e, page, corner, listName) {
    this.showMenu(e, [
      listName === 'pages'
        ? { label: '素材集へ移動 (予備)', action: () => this.mutate(() => {
            corner.pages.splice(corner.pages.indexOf(page), 1);
            corner.standby = corner.standby || [];
            corner.standby.push(page);
          }) }
        : { label: 'プレイリストへ戻す', action: () => this.mutate(() => {
            corner.standby.splice(corner.standby.indexOf(page), 1);
            corner.pages.push(page);
          }) },
      { label: '切り取り', kbd: 'Ctrl+X', action: () => this.cutPage(page, corner, listName) },
      { label: 'コピー', kbd: 'Ctrl+C', action: () => this.copyPage(page) },
      { label: '貼り付け (このページの後ろへ)', kbd: 'Ctrl+V', disabled: !this._pageClipboard, action: () => {
          this.selectedPageId = page.id;
          this.pastePage();
        } },
      { label: '複製', kbd: 'Ctrl+D', action: () => this.duplicatePage(page, corner, listName) },
      { label: page.locked ? 'ロック解除' : '送出ロック', kbd: 'Ctrl+L', action: () => this.mutate(() => { page.locked = !page.locked; Broadcast.onPageLockChanged(page); }) },
      (page.kind === 'still' || page.kind === 'design')
        ? { label: page.kind === 'design' && !this.isEditedStill(page) ? '作画を編集…' : '画像を編集…', kbd: 'Ctrl+E', action: () => this.editPageImage(page) }
        : { label: 'デザインをエディタで開く', action: () => {
            if (typeof DesignEditor !== 'undefined') {
              DesignEditor.templateKey = page.templateKey;
              document.querySelector('.tab-btn[data-tab="design"]').click();
            }
          } },
      { label: '削除', kbd: 'Delete', danger: true, action: () => this.deletePage(page, corner, listName) },
    ]);
  },

  /** ページを直後に複製 (Ctrl+D) */
  duplicatePage(page, corner, listName) {
    let copy = null;
    this.mutate(() => {
      copy = JSON.parse(JSON.stringify(page));
      copy.id = this.uid('pg');
      copy.pageNo = this.nextPageNo(corner);
      const list = corner[listName];
      list.splice(list.indexOf(page) + 1, 0, copy);
      this.selectedPageId = copy.id;
    });
    if (copy) App.setStatus(`P${page.pageNo} を複製しました (P${copy.pageNo})`, 'success');
  },

  /** ページを削除 (確認あり。送出中のページは削除しない) */
  async deletePage(page, corner, listName) {
    if (this.isPageOnAir(page)) { App.setStatus('送出中のページは削除できません (CLEAR してから削除してください)', 'error'); return; }
    if (!(await AppModal.confirm('ページを削除', `ページ ${page.pageNo} を削除しますか? (Ctrl+Z で元に戻せます)`, { danger: true, okLabel: '削除' }))) return;
    this.mutate(() => {
      const list = corner[listName];
      const idx = list.indexOf(page);
      if (idx >= 0) list.splice(idx, 1);
      Object.values(App.broadcast || {}).forEach((st) => { if (st && st.nextPageId === page.id) st.nextPageId = null; });
      if (this.selectedPageId === page.id) this.selectedPageId = null;
    });
  },

  showCornerMenu(e, corner) {
    this.showMenu(e, [
      { label: '名前を変更...', action: async () => {
          const name = await AppModal.prompt('コーナー名を変更', { value: corner.name });
          if (name) this.mutate(() => { corner.name = name; });
        } },
      { label: '色を変更...', action: () => {
          const input = document.createElement('input');
          input.type = 'color';
          input.value = corner.color || '#4da3ff';
          input.addEventListener('input', () => this.mutate(() => { corner.color = input.value; }));
          input.click();
        } },
      { label: corner.locked ? 'ロック解除' : '送出ロック (コーナー全体)', action: () => this.mutate(() => { corner.locked = !corner.locked; }) },
      { label: `オートフォロー: ${{ off: 'なし', take: '次へTAKE', clear: 'CLEAR' }[corner.autoFollow || 'off']} → 切替`, action: () => {
          const order = ['off', 'take', 'clear'];
          const next = order[(order.indexOf(corner.autoFollow || 'off') + 1) % order.length];
          this.mutate(() => { corner.autoFollow = next; });
          App.setStatus(`オートフォロー: ${{ off: 'なし', take: '尺経過で次ページへTAKE', clear: '尺経過でCLEAR' }[next]}`);
        } },
      { label: '削除', danger: true, action: async () => {
          if (App.corners().length <= 1) {
            App.setStatus('最後のコーナーは削除できません', 'error');
            return;
          }
          if (!(await AppModal.confirm('コーナーを削除', `コーナー「${corner.name}」を削除しますか? (ページ${corner.pages.length}件も削除)`, { danger: true, okLabel: '削除' }))) return;
          this.mutate(() => {
            const corners = App.corners();
            corners.splice(corners.indexOf(corner), 1);
            if (this.currentCornerId === corner.id) this.currentCornerId = null;
          });
        } },
    ]);
  },

  // ===== 番組 / 放送 / コーナー管理 (現在モードツリー) =====

  /** 現在モードの既定コーナーを生成 */
  makeCorner(name) {
    const telop = App.activeMode === 'telop';
    return {
      id: this.uid('cn'), name: name || (telop ? '電テロ1' : 'コーナー1'),
      color: telop ? '#e8b160' : '#4da3ff', mode: App.activeMode,
      locked: false, autoFollow: 'off', pages: [], standby: [],
    };
  },

  async addProgram() {
    const name = await AppModal.prompt('番組を追加', { placeholder: '番組名' });
    if (!name) return;
    const corner = this.makeCorner();
    const broadcast = { id: this.uid('bc'), name: '放送1', corners: [corner] };
    const program = { id: this.uid('pg'), name, broadcasts: [broadcast] };
    this.mutate(() => {
      const tree = App.modeTree();
      tree.programs.push(program);
      tree.activeProgramId = program.id;
      tree.activeBroadcastId = broadcast.id;
      this.currentCornerId = corner.id;
    });
  },

  async renameProgram() {
    const program = App.activeProgram();
    if (!program) return;
    const name = await AppModal.prompt('番組名を変更', { value: program.name });
    if (name) this.mutate(() => { program.name = name; });
  },

  async deleteProgram() {
    const program = App.activeProgram();
    if (!program) return;
    const tree = App.modeTree();
    if (tree.programs.length <= 1) {
      App.setStatus('最後の番組は削除できません', 'error');
      return;
    }
    if (!(await AppModal.confirm('番組を削除', `番組「${program.name}」を削除しますか?`, { danger: true, okLabel: '削除' }))) return;
    this.mutate(() => {
      tree.programs.splice(tree.programs.indexOf(program), 1);
      tree.activeProgramId = tree.programs[0].id;
      tree.activeBroadcastId = null;
      this.currentCornerId = null;
    });
  },

  async addBroadcast(duplicate) {
    const program = App.activeProgram();
    if (!program) return;
    const today = new Date();
    const suggested = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const name = await AppModal.prompt(duplicate ? '放送を複製' : '放送を追加', { value: suggested, message: '放送名 (例: 日付)' });
    if (!name) return;
    let broadcast;
    if (duplicate && App.activeBroadcast()) {
      broadcast = JSON.parse(JSON.stringify(App.activeBroadcast()));
      broadcast.id = this.uid('bc');
      broadcast.name = name;
      broadcast.corners.forEach((c) => {
        c.id = this.uid('cn');
        [...c.pages, ...(c.standby || [])].forEach((pg) => { pg.id = this.uid('pg'); });
      });
    } else {
      broadcast = { id: this.uid('bc'), name, corners: [this.makeCorner()] };
    }
    this.mutate(() => {
      program.broadcasts.push(broadcast);
      App.modeTree().activeBroadcastId = broadcast.id;
      this.currentCornerId = null;
    });
  },

  async renameBroadcast() {
    const broadcast = App.activeBroadcast();
    if (!broadcast) return;
    const name = await AppModal.prompt('放送名を変更', { value: broadcast.name });
    if (name) this.mutate(() => { broadcast.name = name; });
  },

  async deleteBroadcast() {
    const program = App.activeProgram();
    const broadcast = App.activeBroadcast();
    if (!program || !broadcast) return;
    if (program.broadcasts.length <= 1) {
      App.setStatus('最後の放送は削除できません', 'error');
      return;
    }
    if (!(await AppModal.confirm('放送を削除', `放送「${broadcast.name}」を削除しますか?`, { danger: true, okLabel: '削除' }))) return;
    this.mutate(() => {
      program.broadcasts.splice(program.broadcasts.indexOf(broadcast), 1);
      App.modeTree().activeBroadcastId = program.broadcasts[0].id;
      this.currentCornerId = null;
    });
  },

  async addCorner() {
    const name = await AppModal.prompt('コーナーを追加', { placeholder: 'コーナー名' });
    if (!name) return;
    const broadcast = App.activeBroadcast();
    if (!broadcast) return;
    const corner = this.makeCorner(name);
    this.mutate(() => broadcast.corners.push(corner));
    this.currentCornerId = corner.id;
    this.renderCornerRail();
    this.renderColumns();
  },

  // ===== ダイレクト送出 =====

  directEnter(value) {
    if (!value) return;
    const found = App.findPageByNo(value);
    if (!found) {
      App.setStatus(`ページ ${value} が見つかりません`, 'error');
      this._directArmedNo = null;
      return;
    }
    const channelId = App.channelOfPage(found.page);
    if (this._directArmedNo === value) {
      // 2回目のEnter → TAKE (TELOP BOXの2段送出)
      this._directArmedNo = null;
      document.getElementById('od-direct').value = '';
      Broadcast.doTake(channelId);
      return;
    }
    // 1回目のEnter → NEXTへセット
    this.currentCornerId = found.corner.id;
    this.selectedPageId = found.page.id;
    if (channelId) this.activeChannelId = channelId;
    Broadcast.setNext(found.page.id);
    this.renderAll();
    const el = document.querySelector(`#od-columns .od-page[data-page-id="${found.page.id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
    this._directArmedNo = value;
    App.setStatus(`P${found.page.pageNo} をNEXTにセットしました (もう一度EnterでTAKE)`);
  },

  // ===== ホットキー =====

  onKeyDown(e) {
    const onairTab = document.getElementById('tab-onair');
    if (!onairTab || !onairTab.classList.contains('active')) return;
    // ダイアログ (確認・ページ追加など) を開いている間は送出キーを効かせない
    if (document.querySelector('dialog[open]')) return;
    const target = e.target;
    const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (isInput) return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const selected = () => (this.selectedPageId ? App.findPage(this.selectedPageId) : null);

    if (mod && !e.shiftKey && !e.altKey && ['x', 'c', 'v'].includes(key)) {
      e.preventDefault();
      if (key === 'v') { this.pastePage(); return; }
      const found = selected();
      if (!found) return;
      if (key === 'x') this.cutPage(found.page, found.corner, found.list);
      else this.copyPage(found.page);
      return;
    }

    // 送出リストの編集の 元に戻す / やり直し (送出操作 TAKE/CLEAR は対象外)
    if (mod && !e.altKey && (key === 'z' || key === 'y')) {
      e.preventDefault();
      const redo = key === 'y' || e.shiftKey;
      const done = redo ? App.redoRundown() : App.undoRundown();
      if (done) {
        this.ensureSelections();
        this.renderAll();
        App.setStatus(redo ? 'やり直しました' : '元に戻しました (送出リストの編集)', 'success');
      } else {
        App.setStatus(redo ? 'やり直せる操作はありません' : '元に戻せる操作はありません');
      }
      return;
    }

    if (mod && !e.altKey && !e.shiftKey) {
      const found = selected();
      const handled = {
        d: () => { if (found) this.duplicatePage(found.page, found.corner, found.list); },
        f: () => { const el = document.getElementById('od-search'); if (el) { el.focus(); el.select(); } },
        l: () => {
          if (!found) return;
          this.mutate(() => { found.page.locked = !found.page.locked; Broadcast.onPageLockChanged(found.page); });
          App.setStatus(`P${found.page.pageNo} を${found.page.locked ? '送出ロックしました' : 'ロック解除しました'}`);
        },
        n: () => this.addPageForChannel(this.activeChannelId),
        o: () => { if (typeof StartWizard !== 'undefined') StartWizard.open(App.activeMode); },
        e: () => { if (found) this.editPageImage(found.page); },
        b: () => this.setConsoleHidden(!this.consoleHidden),
        Enter: () => Broadcast.doUpdate(this.activeChannelId),
      }[key];
      if (handled) { e.preventDefault(); handled(); return; }
    }

    // キー操作するTLの切替: Alt+1〜9 / Ctrl+Tab (Shiftで前へ)
    if (e.altKey && !mod && /^[1-9]$/.test(e.key)) {
      e.preventDefault();
      const ch = App.channels[Number(e.key) - 1];
      if (ch) { this.focusChannel(ch.id); App.setStatus(`キー操作: ${ch.label}`); }
      return;
    }
    if (mod && e.key === 'Tab') {
      e.preventDefault();
      const idx = App.channels.findIndex((c) => c.id === this.activeChannelId);
      const n = App.channels.length;
      const ch = App.channels[((idx < 0 ? 0 : idx) + (e.shiftKey ? n - 1 : 1)) % n];
      if (ch) { this.focusChannel(ch.id); App.setStatus(`キー操作: ${ch.label}`); }
      return;
    }

    if (!mod && !e.altKey && (e.key === 'Delete')) {
      e.preventDefault();
      const found = selected();
      if (found) this.deletePage(found.page, found.corner, found.list);
      return;
    }
    if (!mod && !e.altKey && e.key === 'F2') {
      e.preventDefault();
      this.focusTitleField();
      return;
    }

    if ((e.key === ' ' || e.key === 'Enter') && !mod && !e.altKey) {
      e.preventDefault();
      Broadcast.doTake(this.activeChannelId);
    } else if (e.key === 'ArrowDown' && !mod) {
      e.preventDefault();
      Broadcast.moveNext(this.activeChannelId, 1);
    } else if (e.key === 'ArrowUp' && !mod) {
      e.preventDefault();
      Broadcast.moveNext(this.activeChannelId, -1);
    } else if (e.key === 'Home' && !mod) {
      e.preventDefault();
      Broadcast.goTop(this.activeChannelId);
    } else if (e.key === 'End' && !mod) {
      e.preventDefault();
      Broadcast.goEnd(this.activeChannelId);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !mod) {
      e.preventDefault();
      const corners = App.corners();
      const idx = corners.findIndex((c) => c.id === this.currentCornerId);
      const to = Math.max(0, Math.min(corners.length - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)));
      if (corners[to]) {
        this.currentCornerId = corners[to].id;
        this.renderCornerRail();
        this.renderColumns();
        this.renderStandby();
      }
    } else if (e.key === 'Backspace' && e.ctrlKey && e.shiftKey) {
      e.preventDefault();
      Broadcast.doClearBack(this.activeChannelId);
    } else if (e.key === 'Backspace' && e.ctrlKey) {
      e.preventDefault();
      Broadcast.doClear(this.activeChannelId);
    } else if (/^[0-9]$/.test(e.key) && !mod && !e.altKey) {
      const direct = document.getElementById('od-direct');
      direct.focus();
      direct.value = e.key;
      this._directArmedNo = null;
      e.preventDefault();
    }
  },

  /** F2: 選択中ページのタイトル欄へ (テロップ編集を閉じていれば開く) */
  focusTitleField() {
    if (!this.selectedPageId) { App.setStatus('ページを選択してください'); return; }
    if (this.rightCollapsed) this.setRightCollapsed(false);
    const el = document.querySelector('#od-editor [data-field-key="title"]');
    if (el) { el.focus(); el.select(); }
  },

  // ===== 残尺カウントダウン / オートフォロー =====

  tick() {
    if (!App.rundown || !this.loaded) return;
    const bar = document.getElementById('od-countdown');
    const lines = [];
    App.channels.forEach((ch) => {
      const st = App.broadcast[ch.id];
      if (!st || !st.onAirPageId) return;
      const found = App.findPage(st.onAirPageId);
      if (!found) return;
      this._playedPages.add(st.onAirPageId);
      const { page, corner } = found;
      const rowCd = document.querySelector(`#od-columns .od-page[data-page-id="${page.id}"] .od-page-countdown`);
      if (!page.duration || page.duration <= 0) {
        if (rowCd) rowCd.classList.add('hidden');
        return;
      }
      const elapsed = (performance.now() - st.onAirAt) / 1000;
      const remaining = page.duration - elapsed;
      const text = remaining > 0 ? `残 ${remaining.toFixed(1)}s` : '尺到達';
      lines.push(`${ch.label}: P${page.pageNo} ${text}`);
      if (rowCd) {
        rowCd.textContent = remaining > 0 ? `${Math.ceil(remaining)}s` : '0s';
        rowCd.classList.remove('hidden');
        rowCd.classList.toggle('warn', remaining <= 5);
      }
      // オートフォロー
      if (remaining <= 0 && (corner.autoFollow === 'take' || corner.autoFollow === 'clear')
          && !this._autoFired.has(page.id)) {
        this._autoFired.add(page.id);
        if (corner.autoFollow === 'take' && st.nextPageId) {
          Broadcast.doTake(ch.id);
        } else {
          Broadcast.doClear(ch.id);
        }
      }
    });
    if (bar) bar.textContent = lines.join(' ｜ ');
    // オンエアが変わったらオートフォロー履歴を掃除
    const onAirIds = new Set(Object.values(App.broadcast).map((st) => st.onAirPageId).filter(Boolean));
    [...this._autoFired].forEach((id) => { if (!onAirIds.has(id)) this._autoFired.delete(id); });
  },

  /**
   * 氏名テロップをExcelから一括取込む。
   * 1行目は見出しとして読み飛ばし、2行目以降の1行=1ページ。
   * 1列目「テンプレ」の値 (1S/2S/3S/4S/nameOnly等) で、その行が使う名前テンプレート
   * (name-1S 等) を自動判定し、続く1st〜4th分の肩書/名前(日英)列から該当する人数分だけを読み取る。
   */
  async importNameBatch() {
    const result = await window.api.excelImportNamePages();
    if (!result) return;
    if (!result.success) {
      App.setStatus(`氏名テロップ一括取込エラー: ${result.error}`, 'error');
      return;
    }
    const corner = this.currentCorner();
    if (!corner) return;

    const skipped = result.skipped || [];
    const skippedMsg = skipped.length
      ? ` (${skipped.length}行スキップ: ${skipped.map((s) => `${s.row}行目「${s.shotType}」`).join(', ')})`
      : '';

    if (result.pages.length === 0) {
      App.setStatus(`氏名テロップ一括取込: 有効な行がありませんでした${skippedMsg}`, 'error');
      return;
    }

    this.mutate(() => {
      result.pages.forEach(({ templateKey, values }) => {
        corner.pages.push({
          id: this.uid('pg'), pageNo: this.nextPageNo(corner), templateKey,
          values, note: '', duration: 0, locked: false,
        });
      });
    });
    App.setStatus(`Excelから${result.pages.length}ページを取り込みました${skippedMsg}`, skipped.length ? 'error' : 'success');
  },

  /** 氏名テロップ一括取込用の入力Excel (テンプレ列+1st〜4th分の列) を1ファイルで書き出す */
  async exportNameBatchTemplate() {
    if (!window.api.downloadNameBatchTemplate) return;
    const result = await window.api.downloadNameBatchTemplate();
    if (!result) return;
    if (result.success) App.setStatus(`氏名テロップ一括用Excelテンプレを書き出しました: ${result.filePath}`, 'success');
    else if (result.error) App.setStatus(`Excelテンプレの書き出しエラー: ${result.error}`, 'error');
  },

  /** 名前プール取込用の入力Excel (肩書/名前 日英4列) を書き出す */
  async exportPoolTemplate() {
    if (!window.api.downloadTemplate) return;
    const result = await window.api.downloadTemplate('name');
    if (!result) return;
    if (result.success) App.setStatus(`名前プール用Excelテンプレを書き出しました: ${result.filePath}`, 'success');
    else if (result.error) App.setStatus(`Excelテンプレの書き出しエラー: ${result.error}`, 'error');
  },

  /** 名前プールをExcelから読込 (肩書JP/名前JP/肩書EN/名前EN の4列) */
  async importNamePool() {
    const result = await window.api.openExcelFile('name');
    if (!result) return;
    if (!result.success) {
      App.setStatus(`名前プール読込エラー: ${result.error}`, 'error');
      return;
    }
    this.mutate(() => {
      App.rundown.namePool = result.data;
    });
    this.updateNamePool();
    App.setStatus(`名前プールへ${result.data.length}名を読み込みました (名前フィールドの入力補完に使われます)`, 'success');
  },

  /** 名前プールのdatalist更新 (ページエディタの名前補完) */
  updateNamePool() {
    const dl = document.getElementById('od-namepool');
    if (!dl || !App.rundown) return;
    dl.innerHTML = '';
    (App.rundown.namePool || []).forEach((p) => {
      if (!p.nameJp) return;
      const opt = document.createElement('option');
      opt.value = p.nameJp;
      opt.label = p.titleJp || '';
      dl.appendChild(opt);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => RundownUI.init());
