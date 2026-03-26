/**
 * テーブル行のドラッグ＆ドロップ並び替え
 */
const DragDrop = {
  dragSrcRow: null,

  /**
   * tbodyにドラッグ＆ドロップを有効化
   * @param {HTMLElement} tbody
   * @param {Array} dataArray - 並び替え対象のデータ配列
   * @param {Function} onReorder - 並び替え後のコールバック
   */
  enable(tbody, dataArray, onReorder) {
    tbody.addEventListener('dragstart', (e) => {
      const row = e.target.closest('tr');
      if (!row) return;
      this.dragSrcRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });

    tbody.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const row = e.target.closest('tr');
      if (!row || row === this.dragSrcRow) return;
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (e.clientY < mid) {
        tbody.insertBefore(this.dragSrcRow, row);
      } else {
        tbody.insertBefore(this.dragSrcRow, row.nextSibling);
      }
    });

    tbody.addEventListener('dragend', (e) => {
      const row = e.target.closest('tr');
      if (row) row.classList.remove('dragging');
      this.dragSrcRow = null;

      // DOMの順序からデータ配列を再構築
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const newOrder = rows.map((r) => parseInt(r.dataset.index, 10));
      const reordered = newOrder.map((i) => dataArray[i]);
      dataArray.length = 0;
      dataArray.push(...reordered);

      // インデックスを更新して番号を振り直し
      rows.forEach((r, i) => {
        r.dataset.index = i;
        const numCell = r.querySelector('.row-num');
        if (numCell) numCell.textContent = i + 1;
      });

      if (onReorder) onReorder();
    });
  },
};
