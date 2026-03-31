/**
 * 名前テロップ入力管理（マルチショット対応）
 */
const NameTelop = {
  tbody: null,
  /** 現在表示中のオートコンプリートドロップダウン */
  _activeDropdown: null,

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

    DragDrop.enable(this.tbody, App.nameData, () => this.onReorder());

    // ドロップダウン外クリックで閉じる
    document.addEventListener('mousedown', (e) => {
      if (this._activeDropdown && !this._activeDropdown.contains(e.target)) {
        this.closeDropdown();
      }
    });
  },

  // ===== 名前プール =====

  async loadPool() {
    App.setStatus('名前プール読込中...');
    const result = await window.api.openExcelFile('name');
    if (!result) { App.setStatus('準備完了'); return; }
    if (!result.success) { App.setStatus(`Excel読込エラー: ${result.error}`, 'error'); return; }
    App.namePool = result.data;
    this.renderPool();
    App.setStatus(`名前プール: ${result.data.length}名 読み込みました`, 'success');
  },

  clearPool() {
    if (App.namePool.length === 0) return;
    App.namePool = [];
    this.renderPool();
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

  // ===== カスタムオートコンプリート =====

  /** ドロップダウンを閉じる */
  closeDropdown() {
    if (this._activeDropdown) {
      this._activeDropdown.remove();
      this._activeDropdown = null;
    }
  },

  /**
   * テキストエリアの入力に応じてオートコンプリートドロップダウンを表示
   * @param {HTMLTextAreaElement} textarea - 入力元のtextarea
   * @param {string} field - 'nameJp' or 'titleJp'
   * @param {HTMLElement} personRow - person-row要素
   * @param {HTMLElement} tr - テーブル行要素
   * @param {number} personIndex - 出演者インデックス
   */
  showAutocomplete(textarea, field, personRow, tr, personIndex) {
    this.closeDropdown();
    const query = textarea.value.trim();
    if (!query || App.namePool.length === 0) return;

    // プールから候補をフィルタ (部分一致)
    const matches = App.namePool.filter(p => {
      const target = field === 'nameJp' ? (p.nameJp || '') : (p.titleJp || '');
      return target.includes(query);
    });
    if (matches.length === 0) return;

    const dropdown = document.createElement('div');
    dropdown.className = 'autocomplete-dropdown';

    matches.forEach(poolItem => {
      const option = document.createElement('div');
      option.className = 'autocomplete-option';
      const nameText = this.esc(poolItem.nameJp || '');
      const titleText = poolItem.titleJp ? ` (${this.esc(poolItem.titleJp)})` : '';
      option.innerHTML = `<span class="ac-name">${nameText}</span><span class="ac-title">${titleText}</span>`;
      option.addEventListener('mousedown', (e) => {
        e.preventDefault(); // textareaのblurを防ぐ
        const idx = parseInt(tr.dataset.index, 10);
        this.applyPoolItem(poolItem, personRow, idx, personIndex);
        this.closeDropdown();
      });
      dropdown.appendChild(option);
    });

    // textareaの下に配置
    const rect = textarea.getBoundingClientRect();
    const tableWrapper = textarea.closest('.table-wrapper');
    const wrapperRect = tableWrapper ? tableWrapper.getBoundingClientRect() : document.body.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';
    dropdown.style.minWidth = rect.width + 'px';
    dropdown.style.maxWidth = Math.max(rect.width, 300) + 'px';

    document.body.appendChild(dropdown);
    this._activeDropdown = dropdown;
  },

  /**
   * プール項目を全フィールドに反映
   */
  applyPoolItem(poolItem, personRow, rowIndex, personIndex) {
    const item = App.nameData[rowIndex];
    const person = item.persons[personIndex];

    const fills = { titleJp: poolItem.titleJp, nameJp: poolItem.nameJp, nameEn: poolItem.nameEn, titleEn: poolItem.titleEn };
    Object.entries(fills).forEach(([field, value]) => {
      person[field] = value || '';
      const input = personRow.querySelector(`[data-field="${field}"]`);
      if (input) {
        input.value = value || '';
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      }
    });
  },

  /**
   * 肩書と名前の両方を一致させてプール検索し自動補完
   * 両方入力済みの場合は両方一致を優先、片方のみの場合は片方一致
   */
  autoFillFromPool(personRow, rowIndex, personIndex) {
    const item = App.nameData[rowIndex];
    const person = item.persons[personIndex];
    const titleJp = (person.titleJp || '').trim();
    const nameJp = (person.nameJp || '').trim();

    if (!titleJp && !nameJp) return;

    let match = null;

    // 両方入力されている場合: titleJp + nameJp 両方一致を検索
    if (titleJp && nameJp) {
      match = App.namePool.find(p => p.titleJp === titleJp && p.nameJp === nameJp);
    }

    // 両方一致が見つからない場合、nameJpのみで検索（一意の場合のみ）
    if (!match && nameJp) {
      const nameMatches = App.namePool.filter(p => p.nameJp === nameJp);
      if (nameMatches.length === 1) {
        match = nameMatches[0];
      }
    }

    // titleJpのみで検索（一意の場合のみ）
    if (!match && titleJp && !nameJp) {
      const titleMatches = App.namePool.filter(p => p.titleJp === titleJp);
      if (titleMatches.length === 1) {
        match = titleMatches[0];
      }
    }

    if (!match) return;

    this.applyPoolItem(match, personRow, rowIndex, personIndex);
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
        // 肩書JP (textarea - 複数行対応)
        const titleJpTa = document.createElement('textarea');
        titleJpTa.className = 'cell-textarea';
        titleJpTa.dataset.field = 'titleJp';
        titleJpTa.rows = 1;
        titleJpTa.placeholder = pi === 0 ? '肩書JP' : `${pi + 1}nd 肩書JP`;
        titleJpTa.value = person.titleJp || '';
        personRow.appendChild(titleJpTa);
      }

      // 名前JP (textarea - 複数行対応)
      const nameJpTa = document.createElement('textarea');
      nameJpTa.className = 'cell-textarea';
      nameJpTa.dataset.field = 'nameJp';
      nameJpTa.rows = 1;
      nameJpTa.placeholder = pi === 0 ? '名前JP' : `${pi + 1}nd 名前JP`;
      nameJpTa.value = person.nameJp || '';
      personRow.appendChild(nameJpTa);

      if (shotDef.hasTitle) {
        // 肩書EN (textarea - 複数行対応)
        const titleEnTa = document.createElement('textarea');
        titleEnTa.className = 'cell-textarea';
        titleEnTa.dataset.field = 'titleEn';
        titleEnTa.rows = 1;
        titleEnTa.placeholder = pi === 0 ? '肩書EN' : `${pi + 1}nd 肩書EN`;
        titleEnTa.value = person.titleEn || '';
        personRow.appendChild(titleEnTa);
      }

      // 名前EN (textarea - 複数行対応)
      const nameEnTa = document.createElement('textarea');
      nameEnTa.className = 'cell-textarea';
      nameEnTa.dataset.field = 'nameEn';
      nameEnTa.rows = 1;
      nameEnTa.placeholder = pi === 0 ? '名前EN' : `${pi + 1}nd 名前EN`;
      nameEnTa.value = person.nameEn || '';
      personRow.appendChild(nameEnTa);

      // 入力イベント (データ同期)
      personRow.querySelectorAll('textarea').forEach(el => {
        el.addEventListener('change', () => {
          const idx = parseInt(tr.dataset.index, 10);
          App.nameData[idx].persons[pi][el.dataset.field] = el.value;
        });
      });

      // 名前JP のオートコンプリート & 自動補完
      nameJpTa.addEventListener('input', () => {
        const idx = parseInt(tr.dataset.index, 10);
        App.nameData[idx].persons[pi].nameJp = nameJpTa.value;
        this.showAutocomplete(nameJpTa, 'nameJp', personRow, tr, pi);
      });
      nameJpTa.addEventListener('change', () => {
        const idx = parseInt(tr.dataset.index, 10);
        this.autoFillFromPool(personRow, idx, pi);
      });
      nameJpTa.addEventListener('blur', () => {
        // 少し遅延してドロップダウンのクリックを拾えるようにする
        setTimeout(() => this.closeDropdown(), 150);
      });

      // 肩書JP のオートコンプリート & 自動補完
      if (shotDef.hasTitle) {
        const titleJpTa = personRow.querySelector('[data-field="titleJp"]');
        titleJpTa.addEventListener('input', () => {
          const idx = parseInt(tr.dataset.index, 10);
          App.nameData[idx].persons[pi].titleJp = titleJpTa.value;
          this.showAutocomplete(titleJpTa, 'titleJp', personRow, tr, pi);
        });
        titleJpTa.addEventListener('change', () => {
          const idx = parseInt(tr.dataset.index, 10);
          this.autoFillFromPool(personRow, idx, pi);
        });
        titleJpTa.addEventListener('blur', () => {
          setTimeout(() => this.closeDropdown(), 150);
        });
      }

      // 全textarea自動高さ調整
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

  onReorder() {
    Broadcast.reset('name');
  },
};

document.addEventListener('DOMContentLoaded', () => NameTelop.init());
