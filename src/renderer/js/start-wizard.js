/**
 * モード入場ウィザード (番組 → 放送(日付) 選択ポップアップ)
 *
 * ホームで送出モードを選ぶと開き、番組と放送(日付)を順に選んでから送出画面に入る。
 * 各段で新規作成でき、項目が0件の段は既定を自動生成する (空リストを出さない)。
 */
const StartWizard = {
  state: null,

  init() {
    const cancel = document.getElementById('start-cancel');
    const back = document.getElementById('start-back');
    const next = document.getElementById('start-next');
    if (cancel) cancel.addEventListener('click', () => this.close());
    if (back) back.addEventListener('click', () => this.back());
    if (next) next.addEventListener('click', () => this.next());
  },

  tree() { return App.modeTree(); },
  currentProgram() {
    const tree = this.tree();
    return tree.programs.find((p) => p.id === this.state.programId) || tree.programs[0] || null;
  },

  /** モードを設定してウィザードを開く */
  open(mode) {
    App.setMode(mode);
    const tree = App.modeTree();
    this.state = {
      mode,
      step: 'program',
      programId: tree.activeProgramId || (tree.programs[0] && tree.programs[0].id) || null,
      broadcastId: null,
    };
    this.render();
    const dlg = document.getElementById('od-start-dialog');
    if (dlg && !dlg.open) dlg.showModal();
  },

  close() {
    const dlg = document.getElementById('od-start-dialog');
    if (dlg && dlg.open) dlg.close();
  },

  // ===== 生成 =====
  _defaultProgram() {
    const corner = RundownUI.makeCorner();
    const bc = { id: RundownUI.uid('bc'), name: '放送1', corners: [corner] };
    return { id: RundownUI.uid('pg'), name: '既定番組', broadcasts: [bc] };
  },
  _defaultBroadcast() {
    return { id: RundownUI.uid('bc'), name: '放送1', corners: [RundownUI.makeCorner()] };
  },
  _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  async promptCreateProgram() {
    const name = await AppModal.prompt('番組を追加', { value: '新規番組' });
    if (!name) return;
    const prog = this._defaultProgram();
    prog.name = name;
    this.tree().programs.push(prog);
    this.state.programId = prog.id;
    App.saveRundown();
    this.render();
  },
  async promptCreateBroadcast() {
    const prog = this.currentProgram();
    if (!prog) return;
    const name = await AppModal.prompt('放送を追加', { value: this._today(), message: '放送名 (例: 日付)' });
    if (!name) return;
    const bc = this._defaultBroadcast();
    bc.name = name;
    prog.broadcasts.push(bc);
    this.state.broadcastId = bc.id;
    App.saveRundown();
    this.render();
  },

  // ===== 描画 =====
  render() {
    const st = this.state;
    const tree = this.tree();
    const stepsEl = document.getElementById('start-steps');
    const title = document.getElementById('start-title');
    const list = document.getElementById('start-list');
    const back = document.getElementById('start-back');
    const next = document.getElementById('start-next');
    if (!list) return;

    stepsEl.innerHTML = `<span class="start-step ${st.step === 'program' ? 'active' : 'done'}">1. 番組</span>`
      + '<span class="start-step-sep">▸</span>'
      + `<span class="start-step ${st.step === 'broadcast' ? 'active' : ''}">2. 放送(日付)</span>`;
    list.innerHTML = '';

    if (st.step === 'program') {
      const modeLabel = st.mode === 'telop' ? '電テロ送出' : st.mode === 'sports' ? 'スポーツ送出' : 'リアルタイムCG送出';
      title.textContent = `番組を選択 — ${modeLabel}`;
      // 0件なら既定を自動生成 (空リストにしない)
      if (tree.programs.length === 0) {
        tree.programs.push(this._defaultProgram());
        App.saveRundown();
      }
      if (!tree.programs.find((p) => p.id === st.programId)) st.programId = tree.programs[0].id;
      tree.programs.forEach((p) => {
        list.appendChild(this._item(p.name, `${p.broadcasts.length} 放送`, p.id === st.programId,
          () => { st.programId = p.id; this.render(); }, () => this.next()));
      });
      list.appendChild(this._new('＋ 新規番組', () => this.promptCreateProgram()));
      back.classList.add('hidden');
      next.textContent = '次へ ▶';
    } else {
      const prog = this.currentProgram();
      title.textContent = `放送(日付)を選択 — ${prog.name}`;
      if (prog.broadcasts.length === 0) {
        prog.broadcasts.push(this._defaultBroadcast());
        App.saveRundown();
      }
      if (!prog.broadcasts.find((b) => b.id === st.broadcastId)) st.broadcastId = prog.broadcasts[0].id;
      prog.broadcasts.forEach((b) => {
        list.appendChild(this._item(b.name, `${b.corners.length} コーナー`, b.id === st.broadcastId,
          () => { st.broadcastId = b.id; this.render(); }, () => this.finish()));
      });
      list.appendChild(this._new('＋ 新規放送(日付)', () => this.promptCreateBroadcast()));
      back.classList.remove('hidden');
      next.textContent = st.mode === 'sports' ? '操作盤へ ▶' : '送出へ ▶';
    }
  },

  _item(name, meta, selected, onSelect, onConfirm) {
    const el = document.createElement('button');
    el.className = `start-item${selected ? ' selected' : ''}`;
    const nm = document.createElement('span');
    nm.className = 'start-item-name';
    nm.textContent = name;
    const mt = document.createElement('span');
    mt.className = 'start-item-meta';
    mt.textContent = meta;
    el.appendChild(nm);
    el.appendChild(mt);
    el.addEventListener('click', onSelect);
    el.addEventListener('dblclick', onConfirm);
    return el;
  },
  _new(label, onClick) {
    const el = document.createElement('button');
    el.className = 'start-new';
    el.textContent = label;
    el.addEventListener('click', onClick);
    return el;
  },

  // ===== 遷移 =====
  back() {
    if (this.state.step === 'broadcast') { this.state.step = 'program'; this.render(); }
  },
  next() {
    if (this.state.step === 'program') {
      if (!this.state.programId) return;
      this.state.step = 'broadcast';
      this.state.broadcastId = null;
      this.render();
    } else {
      this.finish();
    }
  },
  finish() {
    const st = this.state;
    if (!st.programId || !st.broadcastId) return;
    App.setActiveProgram(st.programId);
    App.setActiveBroadcast(st.broadcastId);
    App.saveRundown();
    if (typeof RundownUI !== 'undefined' && RundownUI.loaded) {
      RundownUI.currentCornerId = null;
      RundownUI.ensureSelections();
      RundownUI.renderAll();
    }
    this.close();
    if (typeof HomeUI !== 'undefined') HomeUI.goTab(st.mode === 'sports' ? 'sports' : 'onair');
    if (st.mode === 'sports' && typeof SportsUI !== 'undefined') SportsUI.renderAll();
  },
};

document.addEventListener('DOMContentLoaded', () => StartWizard.init());
