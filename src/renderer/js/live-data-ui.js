/**
 * ライブデータ連携 (CSV/Excel監視) 設定UI
 *
 * 外部ファイルの指定セルをテロップのフィールドへ割り当て、
 * 監視開始で送出中テロップへ自動反映する。
 */
const LiveDataUI = {
  file: '',
  mappings: [{ field: '', cell: '' }],

  init() {
    if (!document.getElementById('ld-choose')) return;
    document.getElementById('ld-choose').addEventListener('click', async () => {
      const r = await window.api.liveDataChooseFile();
      if (r && r.ok) {
        this.file = r.file;
        document.getElementById('ld-file').value = r.file;
      }
    });
    this.renderRegionOptions();
    document.getElementById('ld-region').addEventListener('change', () => this.renderMappings());
    document.getElementById('ld-start').addEventListener('click', () => this.start());
    document.getElementById('ld-stop').addEventListener('click', () => this.stop());
    if (window.api.onLiveDataUpdate) {
      window.api.onLiveDataUpdate((st) => this.applyStatus(st));
    }
    this.renderMappings();
    if (window.api.liveDataStatus) {
      window.api.liveDataStatus().then((st) => this.applyStatus(st));
    }
  },

  /** 反映先チャンネルの選択肢を再生成 */
  renderRegionOptions() {
    const sel = document.getElementById('ld-region');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '';
    (App.channels.length ? App.channels : [{ id: 'name', label: '名前', region: 'name' }, { id: 'side', label: 'サイド', region: 'side' }])
      .forEach((ch) => {
        const opt = document.createElement('option');
        opt.value = ch.region;
        opt.textContent = `${ch.label}チャンネル`;
        sel.appendChild(opt);
      });
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  },

  /** 選択チャンネルのテンプレートが持つbindingフィールドの和集合 */
  fieldsForRegion() {
    const region = document.getElementById('ld-region').value;
    const fields = [];
    Object.values(App.templates || {}).forEach((tpl) => {
      if (tpl.region !== region) return;
      (tpl.bindings || []).forEach((b) => { if (!fields.includes(b)) fields.push(b); });
    });
    return fields;
  },

  renderMappings() {
    const wrap = document.getElementById('ld-mappings');
    if (!wrap) return;
    wrap.innerHTML = '';
    const fields = this.fieldsForRegion();
    this.mappings.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'ld-map-row';
      const sel = document.createElement('select');
      sel.className = 'input input--small';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(フィールド)';
      sel.appendChild(none);
      fields.forEach((f) => {
        const opt = document.createElement('option');
        opt.value = f;
        opt.textContent = f;
        sel.appendChild(opt);
      });
      sel.value = fields.includes(m.field) ? m.field : '';
      sel.addEventListener('change', () => { m.field = sel.value; });
      const cell = document.createElement('input');
      cell.type = 'text';
      cell.className = 'input input--small ld-cell';
      cell.placeholder = '例: B2';
      cell.value = m.cell || '';
      cell.addEventListener('change', () => { m.cell = cell.value.trim(); });
      const del = document.createElement('button');
      del.className = 'btn btn--small';
      del.textContent = '✕';
      del.title = 'この割当を削除';
      del.addEventListener('click', () => {
        this.mappings.splice(i, 1);
        if (this.mappings.length === 0) this.mappings.push({ field: '', cell: '' });
        this.renderMappings();
      });
      row.appendChild(sel);
      row.appendChild(cell);
      row.appendChild(del);
      wrap.appendChild(row);
    });
    const add = document.createElement('button');
    add.className = 'btn btn--small';
    add.textContent = '＋割当を追加';
    add.addEventListener('click', () => {
      this.mappings.push({ field: '', cell: '' });
      this.renderMappings();
    });
    wrap.appendChild(add);
  },

  collectConfig() {
    return {
      file: this.file || '',
      region: document.getElementById('ld-region') ? document.getElementById('ld-region').value : 'name',
      mappings: this.mappings.filter((m) => m.field && m.cell),
    };
  },

  populateConfig(cfg) {
    if (!document.getElementById('ld-file')) return;
    this.renderRegionOptions();
    this.renderMappings();
    if (!cfg) return;
    this.file = cfg.file || '';
    document.getElementById('ld-file').value = this.file;
    if (cfg.region) document.getElementById('ld-region').value = cfg.region;
    this.mappings = (cfg.mappings && cfg.mappings.length)
      ? cfg.mappings.map((m) => ({ field: m.field || '', cell: m.cell || '' }))
      : [{ field: '', cell: '' }];
    this.renderMappings();
  },

  async start() {
    const cfg = this.collectConfig();
    if (!cfg.file) {
      App.setStatus('ライブデータ: 監視するファイルを選択してください', 'error');
      return;
    }
    if (cfg.mappings.length === 0) {
      App.setStatus('ライブデータ: フィールドとセルの割当を1つ以上設定してください', 'error');
      return;
    }
    const result = await window.api.liveDataStart(cfg);
    if (!result.ok) {
      App.setStatus(`ライブデータ開始エラー: ${result.error}`, 'error');
      return;
    }
    App.setStatus('ライブデータ監視を開始しました (送出中のテロップへ自動反映されます)', 'success');
    // 設定を自動保存 (保存し忘れ防止)
    window.api.saveSettings(SettingsUI.collectSettings());
  },

  async stop() {
    await window.api.liveDataStop();
    App.setStatus('ライブデータ監視を停止しました');
  },

  applyStatus(st) {
    const pill = document.getElementById('ld-status');
    if (!pill) return;
    pill.textContent = st && st.running ? '監視中' : '停止中';
    pill.classList.toggle('connected', !!(st && st.running));
    const last = document.getElementById('ld-last');
    if (st && st.lastError) {
      last.textContent = `エラー: ${st.lastError}`;
    } else if (st && st.lastUpdate) {
      last.textContent = `最終更新: ${new Date(st.lastUpdate).toLocaleTimeString()}`;
    } else {
      last.textContent = '';
    }
  },
};

document.addEventListener('DOMContentLoaded', () => LiveDataUI.init());
