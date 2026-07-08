/**
 * サイドテロップ入力管理
 */
const SideTelop = {
  tbody: null,

  init() {
    this.tbody = document.getElementById('side-tbody');

    document.getElementById('side-load-excel').addEventListener('click', () => this.loadExcel());
    document.getElementById('side-add-row').addEventListener('click', () => this.addEmptyRow());
    document.getElementById('side-clear-all').addEventListener('click', () => this.clearAll());

    DragDrop.enable(this.tbody, () => App.sideData, (newOrder) => this.onReorder(newOrder));
  },

  async loadExcel() {
    App.setStatus('Excel読込中...');
    const result = await window.api.openExcelFile('side');
    if (!result) {
      App.setStatus('準備完了');
      return;
    }
    if (!result.success) {
      App.setStatus(`Excel読込エラー: ${result.error}`, 'error');
      return;
    }
    App.sideData = result.data;
    this.renderAll();
    Broadcast.reset('side');
    App.setStatus(`${result.data.length}件 読み込みました`, 'success');
  },

  addEmptyRow() {
    App.sideData.push({ textJp: '', textEn: '' });
    this.renderAll();
  },

  clearAll() {
    if (App.sideData.length === 0) return;
    App.sideData = [];
    this.renderAll();
    Broadcast.reset('side');
    App.setStatus('データをクリアしました');
  },

  deleteRow(index) {
    App.sideData.splice(index, 1);
    this.renderAll();
    Broadcast.reset('side');
  },

  renderAll() {
    this.tbody.innerHTML = '';
    App.sideData.forEach((item, i) => this.renderRow(item, i));
    Broadcast.updateInfo('side');
  },

  renderRow(item, index) {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.dataset.index = index;

    tr.innerHTML = `
      <td class="col-drag"><span class="drag-handle">&#9776;</span></td>
      <td class="col-num"><span class="row-num">${index + 1}</span></td>
      <td><textarea class="cell-textarea" rows="1" wrap="off" data-field="textJp">${this.esc(item.textJp)}</textarea></td>
      <td><textarea class="cell-textarea" rows="1" wrap="off" data-field="textEn">${this.esc(item.textEn)}</textarea></td>
      <td class="col-actions"><button class="btn-delete-row" title="削除">&#10005;</button></td>
    `;

    tr.querySelectorAll('textarea').forEach((ta) => {
      ta.addEventListener('change', () => {
        const idx = parseInt(tr.dataset.index, 10);
        App.sideData[idx][ta.dataset.field] = ta.value;
      });
      // 自動高さ調整 (改行に合わせて行高を伸ばす)
      const autoResize = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
      ta.addEventListener('input', autoResize);
      requestAnimationFrame(autoResize);
    });

    tr.querySelector('.btn-delete-row').addEventListener('click', () => {
      this.deleteRow(parseInt(tr.dataset.index, 10));
    });

    // 行クリックで選択 (スケジュール/かるた共通)
    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return;
      Broadcast.selectItem('side', parseInt(tr.dataset.index, 10));
    });

    this.tbody.appendChild(tr);
  },

  esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  onReorder(newOrder) {
    Broadcast.remapAfterReorder('side', newOrder);
  },
};

document.addEventListener('DOMContentLoaded', () => SideTelop.init());
