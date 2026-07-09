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
  loaded: false,

  async init() {
    // 上部バー
    document.getElementById('od-program').addEventListener('change', (e) => {
      App.rundown.activeProgramId = e.target.value;
      App.rundown.activeBroadcastId = null;
      this.ensureSelections();
      App.saveRundown();
      this.renderAll();
    });
    document.getElementById('od-broadcast').addEventListener('change', (e) => {
      App.rundown.activeBroadcastId = e.target.value;
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
    direct.addEventListener('input', () => { this._directArmedNo = null; });

    // コーナー
    document.getElementById('od-corner-add').addEventListener('click', () => this.addCorner());

    // ページ操作
    document.getElementById('od-add-page').addEventListener('click', () => this.openPageDialog('add'));
    document.getElementById('od-import-excel').addEventListener('click', () => this.openPageDialog('excel'));
    document.getElementById('od-import-pool').addEventListener('click', () => this.importNamePool());
    document.getElementById('od-page-dialog-cancel').addEventListener('click', () => document.getElementById('od-page-dialog').close());
    document.getElementById('od-page-dialog-ok').addEventListener('click', () => this.submitPageDialog());
    document.getElementById('od-standby-toggle').addEventListener('click', () => {
      document.getElementById('od-standby').classList.toggle('hidden');
    });

    // 送出ボタン
    document.getElementById('od-take').addEventListener('click', () => Broadcast.doTake(this.activeChannelId));
    document.getElementById('od-update').addEventListener('click', () => Broadcast.doUpdate(this.activeChannelId));
    document.getElementById('od-clear').addEventListener('click', () => Broadcast.doClear(this.activeChannelId));
    document.getElementById('od-stop').addEventListener('click', () => Broadcast.doStop(this.activeChannelId));
    document.getElementById('od-skip').addEventListener('click', () => Broadcast.moveNext(this.activeChannelId, 1));
    document.getElementById('od-back').addEventListener('click', () => Broadcast.moveNext(this.activeChannelId, -1));
    document.getElementById('od-top-btn').addEventListener('click', () => Broadcast.goTop(this.activeChannelId));

    // ホットキー
    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    // コンテキストメニューを閉じる
    document.addEventListener('click', () => this.closeContextMenu());

    // 残尺カウントダウン / オートフォロー
    setInterval(() => this.tick(), 250);
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
    if (!App.rundown) return;
    const program = App.activeProgram();
    if (program) {
      App.rundown.activeProgramId = program.id;
      const broadcast = App.activeBroadcast();
      if (broadcast) App.rundown.activeBroadcastId = broadcast.id;
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
    this.renderFocusLabel();
    this.renderEditor();
    this.renderNextPreview();
    Broadcast.updateGlobalOnAir();
  },

  /** 送出状態のみが変わったときの軽量再描画 */
  renderBroadcastState() {
    this.applyRowStates();
    this.renderFocusLabel();
    this.renderNextPreview();
    this.renderEditor();
  },

  renderTopBar() {
    const progSel = document.getElementById('od-program');
    progSel.innerHTML = '';
    App.rundown.programs.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      progSel.appendChild(opt);
    });
    progSel.value = App.rundown.activeProgramId;

    const bcSel = document.getElementById('od-broadcast');
    bcSel.innerHTML = '';
    const program = App.activeProgram();
    ((program && program.broadcasts) || []).forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.name;
      bcSel.appendChild(opt);
    });
    bcSel.value = App.rundown.activeBroadcastId;
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
      const badges = [];
      if (corner.locked) badges.push('🔒');
      if (corner.autoFollow && corner.autoFollow !== 'off') badges.push('⏱');
      meta.textContent = `${badges.join('')} ${corner.pages.length}`;

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
    tplName.textContent = this.templateLabel(page.templateKey);
    metaLine.appendChild(tplName);
    if (page.duration > 0) {
      const dur = document.createElement('span');
      dur.className = 'od-page-dur';
      dur.textContent = `⏱${page.duration}s`;
      metaLine.appendChild(dur);
    }
    if (page.locked) {
      const lock = document.createElement('span');
      lock.textContent = '🔒';
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
      this.renderFocusLabel();
      this.renderNextPreview();
      this.renderEditor();
    });
    el.addEventListener('dblclick', () => {
      if (listName !== 'pages' || !channelId) return;
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
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('od-drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('od-drop-target');
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/page')); } catch (_) { return; }
      if (!payload || payload.pageId === page.id) return;
      this.movePageBefore(payload.pageId, page.id, corner, listName);
    });

    return el;
  },

  /** 系統(チャンネル)ごとの列でページ一覧を描画 (最大4系統横並び) */
  renderColumns() {
    const wrap = document.getElementById('od-columns');
    wrap.innerHTML = '';
    const corner = this.currentCorner();
    if (!corner) return;

    App.channels.forEach((ch) => {
      const col = document.createElement('div');
      col.className = `od-col${ch.id === this.activeChannelId ? ' active' : ''}`;
      col.dataset.channelId = ch.id;

      // ヘッダ (色ドット+ラベル+件数+その系統へページ追加)
      const header = document.createElement('div');
      header.className = 'od-col-header';
      header.style.borderTopColor = ch.color;
      const dot = document.createElement('span');
      dot.className = 'od-col-dot';
      dot.style.background = ch.color;
      const name = document.createElement('span');
      name.className = 'od-col-name';
      const pages = Broadcast.channelPagesInCorner(corner, ch.id);
      name.textContent = `${ch.label} (${pages.length})`;
      const addBtn = document.createElement('button');
      addBtn.className = 'od-col-add';
      addBtn.textContent = '＋';
      addBtn.title = `${ch.label} にページを追加`;
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openPageDialog('add', ch.id); });
      header.appendChild(dot);
      header.appendChild(name);
      header.appendChild(addBtn);
      header.addEventListener('click', () => this.focusChannel(ch.id));
      col.appendChild(header);

      // ボディ (その系統のページ)
      const body = document.createElement('div');
      body.className = `od-col-body od-pages--${this.viewMode}`;
      pages.forEach((page) => body.appendChild(this.buildPageEl(page, corner, 'pages')));
      if (pages.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'od-empty';
        empty.textContent = '(ページなし)';
        body.appendChild(empty);
      }
      // 末尾ドロップで並べ替え/系統への移動 (この系統のテンプレは変わらないので同系統内のみ意味を持つ)
      body.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/page')) e.preventDefault();
      });
      body.addEventListener('drop', (e) => {
        e.preventDefault();
        let payload;
        try { payload = JSON.parse(e.dataTransfer.getData('text/page')); } catch (_) { return; }
        if (payload) this.movePageBefore(payload.pageId, null, corner, 'pages');
      });
      col.appendChild(body);

      // フッタ (NEXT/ON AIRバッジ + TAKE + CLEAR)
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
      const btns = document.createElement('div');
      btns.className = 'od-col-btns';
      const take = document.createElement('button');
      take.className = 'od-col-take';
      take.textContent = 'TAKE';
      take.title = `${ch.label} を送出 (NEXT→ON AIR)`;
      take.addEventListener('click', (e) => { e.stopPropagation(); this.focusChannel(ch.id); Broadcast.doTake(ch.id); });
      const clr = document.createElement('button');
      clr.className = 'od-col-clear';
      clr.textContent = 'CLEAR';
      clr.title = `${ch.label} を消去`;
      clr.addEventListener('click', (e) => { e.stopPropagation(); this.focusChannel(ch.id); Broadcast.doClear(ch.id); });
      btns.appendChild(take);
      btns.appendChild(clr);
      footer.appendChild(btns);
      col.appendChild(footer);

      wrap.appendChild(col);
    });

    this.applyRowStates();
  },

  /** 操作対象の系統をフォーカス (右ペインのフルボタン/プレビュー/ホットキーの対象) */
  focusChannel(channelId) {
    if (this.activeChannelId === channelId) return;
    this.activeChannelId = channelId;
    document.querySelectorAll('#od-columns .od-col').forEach((el) => {
      el.classList.toggle('active', el.dataset.channelId === channelId);
    });
    this.renderFocusLabel();
    this.renderNextPreview();
  },

  renderFocusLabel() {
    const el = document.getElementById('od-focus-label');
    if (!el) return;
    const ch = App.channelById(this.activeChannelId);
    el.textContent = `操作中: ${ch ? ch.label : '-'}`;
    el.style.color = ch ? ch.color : '';
  },

  renderStandby() {
    const list = document.getElementById('od-standby-list');
    list.innerHTML = '';
    const corner = this.currentCorner();
    if (!corner) return;
    (corner.standby || []).forEach((page) => {
      list.appendChild(this.buildPageEl(page, corner, 'standby'));
    });
    if ((corner.standby || []).length === 0) {
      const empty = document.createElement('div');
      empty.className = 'od-empty';
      empty.textContent = '(素材集は空です — ページを右クリック→「素材集へ」で退避できます)';
      list.appendChild(empty);
    }
    document.getElementById('od-standby-count').textContent = (corner.standby || []).length;
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
    // 列フッタのNEXT/ON AIRバッジと強調を更新
    document.querySelectorAll('#od-columns .od-col').forEach((col) => {
      const ch = App.channelById(col.dataset.channelId);
      if (!ch) return;
      col.classList.toggle('active', ch.id === this.activeChannelId);
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

  renderNextPreview() {
    const host = document.getElementById('od-next-preview');
    const found = this.activeChannelId ? Broadcast.nextPage(this.activeChannelId) : null;
    const label = document.getElementById('od-next-label');
    if (!found) {
      host.innerHTML = '<div class="od-preview-empty">NEXT未設定</div>';
      if (label) label.textContent = 'NEXT';
      return;
    }
    const { page } = found;
    if (label) label.textContent = `NEXT — P${page.pageNo}`;
    const tpl = App.graphicsProject && App.graphicsProject.templates[page.templateKey];
    const variant = tpl && tpl.variants && tpl.variants.jp;
    if (!variant) {
      host.innerHTML = '<div class="od-preview-empty">テンプレートなし</div>';
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
    const fit = () => {
      const scale = host.clientWidth / 1920;
      canvas.style.transform = `scale(${scale})`;
    };
    fit();
  },

  // ===== ページエディタ (右ペイン) =====

  templateLabel(key) {
    const labels = (typeof DesignEditor !== 'undefined' && DesignEditor.TEMPLATE_LABELS) || {};
    return labels[key] || key;
  },

  renderEditor() {
    const panel = document.getElementById('od-editor');
    panel.innerHTML = '';
    const found = this.selectedPageId ? App.findPage(this.selectedPageId) : null;
    if (!found) {
      panel.innerHTML = '<div class="od-editor-empty">ページを選択すると内容を編集できます</div>';
      return;
    }
    const { page, corner } = found;
    const tplInfo = App.templates[page.templateKey] || { bindings: [] };

    const head = document.createElement('div');
    head.className = 'od-editor-head';
    head.textContent = `P${page.pageNo} — ${this.templateLabel(page.templateKey)}`;
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

    // フィールド (テンプレートのbinding)
    tplInfo.bindings.forEach((binding) => {
      // 改行が必要なフィールドはtextarea、名前系は名前プール補完付きinput
      const multiline = /text/i.test(binding);
      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = 'input od-field-input';
      if (multiline) input.rows = 2;
      else if (/nameJp$/i.test(binding)) input.setAttribute('list', 'od-namepool');
      input.value = (page.values && page.values[binding]) || '';
      input.addEventListener('change', () => {
        page.values = page.values || {};
        page.values[binding] = input.value;
        this._thumbCache.delete(this.thumbKey(page));
        App.saveRundown();
        this.renderColumns();
        this.renderNextPreview();
      });
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

  thumbKey(page) {
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
        const tpl = App.graphicsProject && App.graphicsProject.templates[page.templateKey];
        const variant = tpl && tpl.variants && tpl.variants.jp;
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
    document.getElementById('od-page-dialog-title').textContent =
      mode === 'excel' ? 'Excel取込 — テンプレートを選択' : 'ページ追加 — テンプレートを選択';
    document.getElementById('od-page-dialog-hint').textContent =
      mode === 'excel'
        ? '選んだテンプレートの列順 (フィールド順) でExcelを読み込みます。「テンプレDL」で列見本を出力できます'
        : '追加するページのテンプレートを選んでください';
    document.getElementById('od-page-dialog').showModal();
  },

  async submitPageDialog() {
    const templateKey = document.getElementById('od-page-template').value;
    document.getElementById('od-page-dialog').close();
    const corner = this.currentCorner();
    if (!corner || !templateKey) return;

    if (this._pageDialogMode === 'excel') {
      const result = await window.api.excelImportPages(templateKey);
      if (!result) return;
      if (!result.success) {
        App.setStatus(`Excel取込エラー: ${result.error}`, 'error');
        return;
      }
      this.mutate(() => {
        result.pages.forEach((values) => {
          corner.pages.push({
            id: this.uid('pg'), pageNo: this.nextPageNo(corner), templateKey,
            values, note: '', duration: 0, locked: false,
          });
        });
      });
      App.setStatus(`Excelから${result.pages.length}ページを取り込みました`, 'success');
      return;
    }

    const page = {
      id: this.uid('pg'), pageNo: this.nextPageNo(corner), templateKey,
      values: {}, note: '', duration: 0, locked: false,
    };
    this.mutate(() => corner.pages.push(page));
    this.selectedPageId = page.id;
    this.renderEditor();
    this.applyRowStates();
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
      { label: '削除', danger: true, action: () => {
          if (!confirm(`ページ ${page.pageNo} を削除しますか?`)) return;
          this.mutate(() => {
            const list = corner[listName];
            list.splice(list.indexOf(page), 1);
          });
        } },
    ]);
  },

  showCornerMenu(e, corner) {
    this.showMenu(e, [
      { label: '名前を変更...', action: () => {
          const name = prompt('コーナー名', corner.name);
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
      { label: '削除', danger: true, action: () => {
          if (App.corners().length <= 1) {
            App.setStatus('最後のコーナーは削除できません', 'error');
            return;
          }
          if (!confirm(`コーナー「${corner.name}」を削除しますか? (ページ${corner.pages.length}件も削除)`)) return;
          this.mutate(() => {
            const corners = App.corners();
            corners.splice(corners.indexOf(corner), 1);
            if (this.currentCornerId === corner.id) this.currentCornerId = null;
          });
        } },
    ]);
  },

  // ===== 番組 / 放送 / コーナー管理 =====

  addProgram() {
    const name = prompt('番組名');
    if (!name) return;
    const corner = { id: this.uid('cn'), name: 'コーナー1', color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [] };
    const broadcast = { id: this.uid('bc'), name: '放送1', corners: [corner] };
    const program = { id: this.uid('pg'), name, broadcasts: [broadcast] };
    this.mutate(() => {
      App.rundown.programs.push(program);
      App.rundown.activeProgramId = program.id;
      App.rundown.activeBroadcastId = broadcast.id;
      this.currentCornerId = corner.id;
    });
  },

  renameProgram() {
    const program = App.activeProgram();
    if (!program) return;
    const name = prompt('番組名', program.name);
    if (name) this.mutate(() => { program.name = name; });
  },

  deleteProgram() {
    const program = App.activeProgram();
    if (!program) return;
    if (App.rundown.programs.length <= 1) {
      App.setStatus('最後の番組は削除できません', 'error');
      return;
    }
    if (!confirm(`番組「${program.name}」を削除しますか?`)) return;
    this.mutate(() => {
      App.rundown.programs.splice(App.rundown.programs.indexOf(program), 1);
      App.rundown.activeProgramId = App.rundown.programs[0].id;
      App.rundown.activeBroadcastId = null;
      this.currentCornerId = null;
    });
  },

  addBroadcast(duplicate) {
    const program = App.activeProgram();
    if (!program) return;
    const today = new Date();
    const suggested = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const name = prompt(duplicate ? '複製先の放送名 (例: 日付)' : '放送名 (例: 日付)', suggested);
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
      broadcast = {
        id: this.uid('bc'),
        name,
        corners: [{ id: this.uid('cn'), name: 'コーナー1', color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [] }],
      };
    }
    this.mutate(() => {
      program.broadcasts.push(broadcast);
      App.rundown.activeBroadcastId = broadcast.id;
      this.currentCornerId = null;
    });
  },

  renameBroadcast() {
    const broadcast = App.activeBroadcast();
    if (!broadcast) return;
    const name = prompt('放送名', broadcast.name);
    if (name) this.mutate(() => { broadcast.name = name; });
  },

  deleteBroadcast() {
    const program = App.activeProgram();
    const broadcast = App.activeBroadcast();
    if (!program || !broadcast) return;
    if (program.broadcasts.length <= 1) {
      App.setStatus('最後の放送は削除できません', 'error');
      return;
    }
    if (!confirm(`放送「${broadcast.name}」を削除しますか?`)) return;
    this.mutate(() => {
      program.broadcasts.splice(program.broadcasts.indexOf(broadcast), 1);
      App.rundown.activeBroadcastId = program.broadcasts[0].id;
      this.currentCornerId = null;
    });
  },

  addCorner() {
    const name = prompt('コーナー名');
    if (!name) return;
    const broadcast = App.activeBroadcast();
    if (!broadcast) return;
    const corner = { id: this.uid('cn'), name, color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [] };
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
