const XLSX = require('xlsx');

/**
 * Excelファイルを読み込み、テロップデータの配列を返す。
 * @param {string} filePath - Excelファイルパス
 * @param {'name'|'side'} telopType - テロップ種別
 * @returns {Array<Object>}
 */
function readExcel(filePath, telopType) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) return [];

  // 1行目はヘッダーとしてスキップ
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ''));

  if (telopType === 'name') {
    return dataRows.map((row) => ({
      titleJp: String(row[0] || ''),
      nameJp: String(row[1] || ''),
      titleEn: String(row[2] || ''),
      nameEn: String(row[3] || ''),
    }));
  }

  // side telop
  return dataRows.map((row) => ({
    textJp: String(row[0] || ''),
    textEn: String(row[1] || ''),
  }));
}

module.exports = { readExcel };
