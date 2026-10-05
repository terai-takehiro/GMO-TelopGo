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

    // 右サイドバー (ページ編集) の折りたたみ
    this.initRightPanel();

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

  /** ページ行/カードのDOMを生成 */
  buildPageEl(page, corner, listName) {
    const channelId = App.channelOfPage(page);
    const channel = App.channelById(channelId);
    const el = document.createElement('div');
    el.className = `od-page od-page--${this.viewMode} od-thumb-${this.thumbSize}`;
    el.dataset.pageId = page.id;
    el.draggable = true;

    const stateBar = document.createElement('span');
    stateBar.className = 'od-page-state';
    el.appendChild(stateBar);

    const no = document.createElement('span');
    no.className = 'od-page-no';
    no.textContent = page.pageNo;
    el.appendChild(no);

    if (this.viewMode === 'thumb') {
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
      () => this.mutate(() => { page.locked = !page.locked; }));
    mkAction('⧉ 複製', 'このページを複製', () => this.mutate(() => {
      const copy = JSON.parse(JSON.stringify(page));
      copy.id = this.uid('pg');
      copy.pageNo = this.nextPageNo(corner);
      const list = corner[listName];
      list.splice(list.indexOf(page) + 1, 0, copy);
    }));
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
    wrap.innerHTML = '';
    const corner = this.currentCorner();
    if (!corner) return;
    const telopMode = App.activeMode === 'telop';

    this.renderModeBanner();
    // 電テロモードでは Excel取込 (変数代入・氏名一括・名前プール) は無関係なのでメニューごと隠す
    const excelWrap = document.getElementById('od-excel-wrap');
    if (excelWrap) excelWrap.classList.toggle('hidden', telopMode);

    App.channels.forEach((ch) => {
      const col = document.createElement('div');
      col.className = `od-col${ch.id === this.activeChannelId ? ' active' : ''}`;
      col.dataset.channelId = ch.id;

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
      header.appendChild(addBtn);
      header.addEventListener('click', () => this.focusChannel(ch.id));
      col.appendChild(header);

      // OA|NEXT ミニモニター (系統ごとの出力/次ページ確認)
      const monitors = document.createElement('div');
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

      // ボディ (その系統のページ)
      const body = document.createElement('div');
      body.className = `od-col-body od-pages--${this.viewMode}`;
      pages.forEach((page) => body.appendChild(this.buildPageEl(page, corner, 'pages')));
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

      wrap.appendChild(col);
    });

    this.updateChannelMonitors();
    this.renderNextPreviews();
    this.applyPreviewBg();
    this.applyRowStates();
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

  // ===== 右サイドバー (ページ編集) の折りたたみ =====

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

  /** ページ編集を折りたたむ/開く (折りたたみ中は細い帯だけ残し、系統の列を広く使う) */
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

  /** TAKE後に呼ばれる: 設定がONならページ編集を折りたたむ */
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
      // 16:9で親にフィット
      canvas.style.transform = `scale(${host.clientWidth / 1920})`;
    });
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
    panel.innerHTML = '';
    const found = this.selectedPageId ? App.findPage(this.selectedPageId) : null;
    const railLabel = document.getElementById('od-right-rail-label');
    if (railLabel) railLabel.textContent = found ? `ページ編集　P${found.page.pageNo}` : 'ページ編集';
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
    noInput.value = page.pageNo;
    noInput.addEventListener('change', () => this.mutate(() => { page.pageNo = noInput.value.trim() || page.pageNo; }));
    const durInput = document.createElement('input');
    durInput.type = 'number';
    durInput.className = 'input input--small';
    durInput.min = '0';
    durInput.value = page.duration || 0;
    durInput.title = '尺 (秒)。0=なし。コーナーのオートフォローONで自動送出に使われます';
    durInput.addEventListener('change', () => this.mutate(() => { page.duration = Math.max(0, parseFloat(durInput.value) || 0); }));
    const noDur = document.createElement('div');
    noDur.className = 'od-editor-inline';
    noDur.appendChild(noInput);
    noDur.appendChild(durInput);
    row('番号 / 尺(秒)', noDur);

    // タイトル (全種別共通 — 一覧・ログでの識別用。空なら内容の要約を表示)
    {
      const titleInput = document.createElement('input');
      titleInput.className = 'input';
      titleInput.value = page.title || '';
      titleInput.placeholder = 'テロップ名 (任意 — 一覧・ログでの識別用)';
      titleInput.addEventListener('change', () => this.mutate(() => { page.title = titleInput.value; }));
      row('タイトル', titleInput);
    }

    // 電テロ (静止画): 表示方法
    if (page.kind === 'still' || page.kind === 'design') {
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
    }

    // 名前プールから選択 (氏名テロップ系テンプレートで、名前プール読込済みの場合のみ表示)
    if (personsInfo.length && namePool.length) {
      const hint = document.createElement('div');
      hint.className = 'od-namepool-hint';
      hint.textContent = `名前プールから選択 (${namePool.length}名読込済み) — 選ぶと肩書・名前(日英)が自動入力されます。下の欄へ直接入力したい場合は「手入力」を選んでください`;
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

    // プールから選択中の人物が占有しているbinding (編集不可にする)
    const lockedBindings = new Set();
    personsInfo.forEach((person, pi) => {
      if (!poolSelEntries[pi]) return;
      lockedBindings.add(person.nameJp);
      lockedBindings.add(person.nameEn);
      if (person.hasTitle) { lockedBindings.add(person.titleJp); lockedBindings.add(person.titleEn); }
    });

    // フィールド (テンプレートのbinding)
    tplInfo.bindings.forEach((binding) => {
      // 改行が必要なフィールドはtextarea、名前系は名前プール補完付きinput
      const multiline = /text/i.test(binding);
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = 'input od-field-input';
      if (multiline) input.rows = 2;
      else if (/nameJp$/i.test(binding)) input.setAttribute('list', 'od-namepool');
      input.value = (page.values && page.values[binding]) || '';
      if (lockedBindings.has(binding)) {
        input.readOnly = true;
        input.classList.add('od-field-locked');
        input.title = '名前プールから選択中のため編集できません (上のプルダウンで「手入力」を選ぶと編集できます)';
      } else {
        input.addEventListener('change', () => {
          page.values = page.values || {};
          page.values[binding] = input.value;
          this._thumbCache.delete(this.thumbKey(page));
          App.saveRundown();
          this.renderColumns();
        });
      }
      row(binding, input);
    });

    // メモ / ロック
    const noteInput = document.createElement('input');
    noteInput.className = 'input';
    noteInput.value = page.note || '';
    noteInput.placeholder = 'オペレーションメモ';
    noteInput.addEventListener('change', () => this.mutate(() => { page.note = noteInput.value; }));
    row('メモ', noteInput);

    const lockLabel = document.createElement('label');
    lockLabel.className = 'od-lock-label';
    const lockInput = document.createElement('input');
    lockInput.type = 'checkbox';
    lockInput.checked = !!page.locked;
    lockInput.addEventListener('change', () => this.mutate(() => { page.locked = lockInput.checked; }));
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
      animation: {},
    };
  },

  thumbKey(page) {
    if (page.kind === 'still') return `still|${page.still ? `${page.still.file}|${page.still.objectFit || ''}` : ''}`;
    if (page.kind === 'design') return `design|${page.id}`;
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
      if (item.danger) btn.classList.add('danger');
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
      { label: '複製', action: () => this.mutate(() => {
          const copy = JSON.parse(JSON.stringify(page));
          copy.id = this.uid('pg');
          copy.pageNo = this.nextPageNo(corner);
          const list = corner[listName];
          list.splice(list.indexOf(page) + 1, 0, copy);
        }) },
      { label: page.locked ? 'ロック解除' : '送出ロック', action: () => this.mutate(() => { page.locked = !page.locked; }) },
      { label: 'デザインをエディタで開く', action: () => {
          if (typeof DesignEditor !== 'undefined') {
            DesignEditor.templateKey = page.templateKey;
            document.querySelector('.tab-btn[data-tab="design"]').click();
          }
        } },
      { label: '削除', danger: true, action: async () => {
          if (!(await AppModal.confirm('ページを削除', `ページ ${page.pageNo} を削除しますか?`, { danger: true, okLabel: '削除' }))) return;
          this.mutate(() => {
            const list = corner[listName];
            list.splice(list.indexOf(page), 1);
          });
        } },
    ]);
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
    const target = e.target;
    const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (isInput) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      Broadcast.doTake(this.activeChannelId);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      Broadcast.moveNext(this.activeChannelId, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      Broadcast.moveNext(this.activeChannelId, -1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
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
    } else if (/^[0-9]$/.test(e.key)) {
      const direct = document.getElementById('od-direct');
      direct.focus();
      direct.value = e.key;
      this._directArmedNo = null;
      e.preventDefault();
    }
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
