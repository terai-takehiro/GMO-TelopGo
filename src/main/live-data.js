/**
 * CSV/Excelライブデータ連携
 *
 * 外部のCSV/Excelファイルを監視し、指定セルの値をテロップのフィールドへ
 * 自動反映する (スコア表示・為替・順位表などの運用向け)。
 * Excelの上書き保存はファイルのロック/リネームを伴うため、
 * fs.watchFileのポーリング監視 (1秒間隔) で堅牢に検出する。
 */
const fs = require('fs');
const XLSX = require('xlsx');

let config = null;
let onUpdate = null;
let status = { running: false, file: '', lastUpdate: null, lastError: '', lastValues: null };

function readValues() {
  // CSVは raw:true で文字列のまま読む ("2-1" が日付扱いされるのを防ぐ)。
  // Excelは表示文字列 (cell.w) を優先し、Excel上の見た目どおりに反映する。
  const isCsv = /\.csv$/i.test(config.file);
  const wb = XLSX.readFile(config.file, isCsv ? { raw: true } : { cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const values = {};
  (config.mappings || []).forEach((m) => {
    if (!m.field || !m.cell) return;
    const cell = sheet[String(m.cell).toUpperCase().trim()];
    if (cell === undefined || cell.v === undefined || cell.v === null) {
      values[m.field] = '';
    } else {
      values[m.field] = cell.w !== undefined && !isCsv ? String(cell.w) : String(cell.v);
    }
  });
  return values;
}

function check() {
  if (!config) return;
  try {
    const values = readValues();
    if (JSON.stringify(values) === JSON.stringify(status.lastValues)) return;
    status.lastValues = values;
    status.lastUpdate = new Date().toISOString();
    status.lastError = '';
    if (onUpdate) onUpdate(values);
  } catch (err) {
    status.lastError = err.message;
  }
}

/**
 * @param {{file: string, region: 'name'|'side', templateKey?: string,
 *          mappings: Array<{field: string, cell: string}>}} cfg
 * @param {(values: Object) => void} updateCallback 値が変化したときに呼ばれる
 */
function start(cfg, updateCallback) {
  stop();
  if (!cfg || !cfg.file) throw new Error('監視するファイルを選択してください。');
  if (!fs.existsSync(cfg.file)) throw new Error('ファイルが見つかりません: ' + cfg.file);
  config = JSON.parse(JSON.stringify(cfg));
  onUpdate = updateCallback;
  status = { running: true, file: cfg.file, lastUpdate: null, lastError: '', lastValues: null };
  fs.watchFile(config.file, { interval: 1000 }, check);
  check();
  return getStatus();
}

function stop() {
  if (config) {
    try { fs.unwatchFile(config.file); } catch (_) { /* ignore */ }
  }
  config = null;
  onUpdate = null;
  status = Object.assign({}, status, { running: false });
  return getStatus();
}

function getStatus() {
  return {
    running: status.running,
    file: status.file,
    lastUpdate: status.lastUpdate,
    lastError: status.lastError,
    values: status.lastValues,
    region: config ? config.region : null,
    templateKey: config ? config.templateKey : null,
  };
}

module.exports = { start, stop, getStatus };
