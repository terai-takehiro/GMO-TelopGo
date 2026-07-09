/**
 * 名前テロップ入力管理（マルチショット対応）
 */
const NameTelop = {
  tbody: null,

  init() {
    this.tbody = document.getElementById('name-tbody');

    // プール読込
    document.getElementById('name-load-pool').addEventListener('click', () => this.loadPool());
    document.getElementById('name-clear-pool').addEventListener('click', () => this.clearPool());
    document.getElementById('name-pool-toggle').addEventListener('click', () => {
      document.getElementById('name-pool-body').classList.toggle('hidden');
    });

    // スケジュール操作
    document.getElementById('name-add-row').addEventListener('click', () => this.addEmptyRow());
    document.getElementById('name-clear-all').addEventListener('click', () => this.clearAll());

    DragDrop.enable(this.tbody, () => App.nameData, (newOrder) => this.onReorder(newOrder));
  },

  // ===== 名前プール =====

  async loadPool() {
    App.setStatus('名前プール読込中...');
    const result = await window.api.openExcelFile('name');
    if (!result) { App.setStatus('準備完了'); return; }
    if (!result.success) { App.setStatus(`Excel読込エラー: ${result.error}`, 'error'); return; }
    App.namePool = result.data;
    this.renderPool();
    this.updateDatalist();
    App.setStatus(`名前プール: ${result.data.length}名 読み込みました`, 'success');
  },

  clearPool() {
    if (App.namePool.length === 0) return;
    if (!confirm(`名前プールの ${App.namePool.length} 名をすべて削除します。よろしいですか?`)) return;
    App.namePool = [];
    this.renderPool();
    this.updateDatalist();
    App.setStatus('名前プールをクリアしました');
  },

  renderPool() {
    document.getElementById('name-pool-count').textContent = App.namePool.length;
    const body = document.getElementById('name-pool-body');
    if (App.namePool.length === 0) {
      body.innerHTML = '<div class="pool-empty">プールが空です。Excel読込で名前リストを追加してください。</div>';
      return;
    }
    body.innerHTML = App.namePool.map((p, i) =>
      `<div class="pool-item">${i + 1}. ${this.esc(p.nameJp)}${p.titleJp ? ' (' + this.esc(p.titleJp) + ')' : ''}</div>`
    ).join('');
  },

  updateDatalist() {
    const dl = document.getElementById('name-pool-jp');
    dl.innerHTML = '';
    App.namePool.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.nameJp;
      // ドロップダウンに肩書を表示 (名前 — 肩書)
      if (p.titleJp) opt.textContent = `${p.nameJp} — ${p.titleJp}`;
      dl.appendChild(opt);
    });
  },

  /** datalist選択時に全フィールドを自動補完 (名前JP/肩書JP どちらからでも) */
  autoFillFromPool(nameJpValue, personRow, rowIndex, personIndex) {
    const match = App.namePool.find(p => p.nameJp === nameJpValue);
    if (!match) return;

    const item = App.nameData[rowIndex];
    const person = item.persons[personIndex];

    // 全フィールドを補完 (nameJp含む)
    const fills = { titleJp: match.titleJp, nameJp: match.nameJp, nameEn: match.nameEn, titleEn: match.titleEn };
    Object.entries(fills).forEach(([field, value]) => {
      person[field] = value || '';
      const input = personRow.querySelector(`[data-field="${field}"]`);
      if (input) {
        input.value = value || '';
        if (input.tagName === 'TEXTAREA') {
          input.style.height = 'auto';
          input.style.height = input.scrollHeight + 'px';
        }
      }
    });
  },

  // ===== スケジュール =====

  addEmptyRow() {
    App.nameData.push({
      shotType: '1S',
      persons: [{ titleJp: '', nameJp: '', titleEn: '', nameEn: '' }],
    });
    this.renderAll();
  },

  clearAll() {
    if (App.nameData.length === 0) return;
    if (!confirm(`名前テロップの全 ${App.nameData.length} 件を削除します。よろしいですか?\n(この操作は元に戻せません)`)) return;
    App.nameData = [];
    this.renderAll();
    Broadcast.reset('name');
    App.setStatus('データをクリアしました');
  },

  deleteRow(index) {
    App.nameData.splice(index, 1);
    this.renderAll();
    Broadcast.reset('name');
  },

  renderAll() {
    this.tbody.innerHTML = '';
    App.nameData.forEach((item, i) => this.renderRow(item, i));
    Broadcast.updateInfo('name');
  },

  renderRow(item, index) {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.index = index;
    tr.title = 'クリックでNEXTに設定 (入力欄以外)';

    const shotDef = SHOT_TYPES[item.shotType] || SHOT_TYPES['1S'];

    // ドラッグハンドル
    const tdDrag = document.createElement('td');
    tdDrag.className = 'col-drag';
    tdDrag.innerHTML = '<span class="drag-handle">&#9776;</span>';
    tr.appendChild(tdDrag);

    // 行番号
    const tdNum = document.createElement('td');
    tdNum.className = 'col-num';
    tdNum.innerHTML = `<span class="row-num">${index + 1}</span>`;
    tr.appendChild(tdNum);

    // ショットタイプ選択
    const tdType = document.createElement('td');
    tdType.className = 'col-shot-type';
    const select = document.createElement('select');
    select.className = 'shot-type-select';
    Object.entries(SHOT_TYPES).forEach(([key, def]) => {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = def.label;
      if (key === item.shotType) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener('change', () => {
      const idx = parseInt(tr.dataset.index, 10);
      const newType = select.value;
      const newDef = SHOT_TYPES[newType];
      const dataItem = App.nameData[idx];
      dataItem.shotType = newType;
      // persons配列の長さ調整
      while (dataItem.persons.length < newDef.personCount) {
        dataItem.persons.push({ titleJp: '', nameJp: '', titleEn: '', nameEn: '' });
      }
      dataItem.persons.length = newDef.personCount;
      this.renderAll();
    });
    tdType.appendChild(select);
    tr.appendChild(tdType);

    // 出演者セル (person-rows を動的生成)
    const tdPersons = document.createElement('td');
    tdPersons.className = 'col-persons';

    for (let pi = 0; pi < shotDef.personCount; pi++) {
      const person = item.persons[pi] || { titleJp: '', nameJp: '', titleEn: '', nameEn: '' };
      const personRow = document.createElement('div');
      personRow.className = 'person-row';
      personRow.dataset.personIndex = pi;

      if (shotDef.hasTitle) {
        // 肩書JP (textarea — 改行入力可能)
        const titleJpTa = document.createElement('textarea');
        titleJpTa.className = 'cell-textarea';
        titleJpTa.dataset.field = 'titleJp';
        titleJpTa.rows = 1;
        titleJpTa.wrap = 'off';
        titleJpTa.placeholder = pi === 0 ? '肩書JP' : `${pi + 1}nd 肩書JP`;
        titleJpTa.value = person.titleJp || '';
        personRow.appendChild(titleJpTa);
      }

      // 名前JP (datalist付き)
      const nameJpInput = document.createElement('input');
      nameJpInput.type = 'text';
      nameJpInput.dataset.field = 'nameJp';
      nameJpInput.setAttribute('list', 'name-pool-jp');
      nameJpInput.placeholder = pi === 0 ? '名前JP' : `${pi + 1}nd 名前JP`;
      nameJpInput.value = person.nameJp || '';
      personRow.appendChild(nameJpInput);

      if (shotDef.hasTitle) {
        // 肩書EN
        const titleEnTa = document.createElement('textarea');
        titleEnTa.className = 'cell-textarea';
        titleEnTa.dataset.field = 'titleEn';
        titleEnTa.rows = 1;
        titleEnTa.wrap = 'off';
        titleEnTa.placeholder = pi === 0 ? '肩書EN' : `${pi + 1}nd 肩書EN`;
        titleEnTa.value = person.titleEn || '';
        personRow.appendChild(titleEnTa);
      }

      // 名前EN (textarea — 改行入力可能)
      const nameEnTa = document.createElement('textarea');
      nameEnTa.className = 'cell-textarea';
      nameEnTa.dataset.field = 'nameEn';
      nameEnTa.rows = 1;
      nameEnTa.wrap = 'off';
      nameEnTa.placeholder = pi === 0 ? '名前EN' : `${pi + 1}nd 名前EN`;
      nameEnTa.value = person.nameEn || '';
      personRow.appendChild(nameEnTa);

      // 入力イベント
      personRow.querySelectorAll('input, textarea').forEach(el => {
        el.addEventListener('change', () => {
          const idx = parseInt(tr.dataset.index, 10);
          App.nameData[idx].persons[pi][el.dataset.field] = el.value;
        });
      });

      // 名前JPの自動補完
      nameJpInput.addEventListener('change', () => {
        const idx = parseInt(tr.dataset.index, 10);
        this.autoFillFromPool(nameJpInput.value, personRow, idx, pi);
      });

      // textarea自動高さ
      personRow.querySelectorAll('.cell-textarea').forEach(ta => {
        const autoResize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        ta.addEventListener('input', autoResize);
        requestAnimationFrame(autoResize);
      });

      tdPersons.appendChild(personRow);
    }
    tr.appendChild(tdPersons);

    // 削除ボタン
    const tdActions = document.createElement('td');
    tdActions.className = 'col-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-delete-row';
    delBtn.title = '削除';
    delBtn.innerHTML = '&#10005;';
    delBtn.addEventListener('click', () => {
      this.deleteRow(parseInt(tr.dataset.index, 10));
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    // 行クリックで選択
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      Broadcast.selectItem('name', parseInt(tr.dataset.index, 10));
    });

    this.tbody.appendChild(tr);
  },

  esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  onReorder(newOrder) {
    Broadcast.remapAfterReorder('name', newOrder);
  },
};

document.addEventListener('DOMContentLoaded', () => NameTelop.init());
