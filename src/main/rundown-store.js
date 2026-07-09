/**
 * ランダウン (送出リスト) 管理
 *
 * TELOP BOX流の4階層でテロップを管理する:
 *   番組 (program) > 放送 (broadcast, 例: 日付) > コーナー (corner) > ページ (page)
 *
 * ページ = テンプレート + 値 (Viz Trioのページ概念):
 *   { id, pageNo, templateKey, values: {binding: 値}, note, duration, locked }
 * ページの出力チャンネルはテンプレートの region から決まる。
 *
 * コーナーは pages (プレイリスト=送出順) と standby (素材集=予備) を持つ。
 * userData/rundown.json に自動保存する。
 */
const fs = require('fs');
const path = require('path');

let rundownPath = '';
let data = null;

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}`;
}

function buildDefault() {
  const corner = { id: uid('cn'), name: 'コーナー1', color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [] };
  const broadcast = { id: uid('bc'), name: '放送1', corners: [corner] };
  const program = { id: uid('pg'), name: '既定番組', broadcasts: [broadcast] };
  return {
    version: 2,
    programs: [program],
    activeProgramId: program.id,
    activeBroadcastId: broadcast.id,
    namePool: [],
  };
}

function init(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  rundownPath = path.join(baseDir, 'rundown.json');
  if (fs.existsSync(rundownPath)) {
    try {
      data = JSON.parse(fs.readFileSync(rundownPath, 'utf-8'));
    } catch (_) {
      try { fs.renameSync(rundownPath, `${rundownPath}.broken`); } catch (_e) { /* ignore */ }
      data = buildDefault();
      save();
    }
  } else {
    data = buildDefault();
    save();
  }
  return data;
}

function get() {
  return data;
}

function set(newData) {
  if (!newData || !Array.isArray(newData.programs)) {
    throw new Error('ランダウンデータが不正です。');
  }
  data = newData;
  save();
}

function save() {
  if (!rundownPath) return;
  fs.writeFileSync(rundownPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 旧形式プロジェクト ({namePool, nameData, sideData}) をランダウンへ変換する。
 * 旧プロジェクトファイルの読込時に呼ばれる (機能維持のための互換パス)。
 * @returns 変換後のランダウン全体
 */
function migrateLegacy(legacy) {
  const rd = buildDefault();
  rd.namePool = legacy.namePool || [];
  const program = rd.programs[0];
  program.name = '移行された番組';
  const broadcast = program.broadcasts[0];
  broadcast.name = '移行データ';
  broadcast.corners = [];

  const PERSON_PREFIXES = ['', '2nd', '3rd', '4th'];
  const nameCorner = {
    id: uid('cn'), name: '名前テロップ', color: '#e8b93c', locked: false, autoFollow: 'off', pages: [], standby: [],
  };
  (legacy.nameData || []).forEach((row, i) => {
    const values = {};
    (row.persons || []).forEach((p, pi) => {
      const prefix = PERSON_PREFIXES[pi];
      values[prefix ? `${prefix}TitleJp` : 'titleJp'] = p.titleJp || '';
      values[prefix ? `${prefix}NameJp` : 'nameJp'] = p.nameJp || '';
      values[prefix ? `${prefix}TitleEn` : 'titleEn'] = p.titleEn || '';
      values[prefix ? `${prefix}NameEn` : 'nameEn'] = p.nameEn || '';
    });
    nameCorner.pages.push({
      id: uid('pg'),
      pageNo: String(101 + i),
      templateKey: `name-${row.shotType || '1S'}`,
      values,
      note: '',
      duration: 0,
      locked: false,
    });
  });

  const sideCorner = {
    id: uid('cn'), name: 'サイドテロップ', color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [],
  };
  (legacy.sideData || []).forEach((row, i) => {
    sideCorner.pages.push({
      id: uid('pg'),
      pageNo: String(201 + i),
      templateKey: 'side',
      values: { textJp: row.textJp || '', textEn: row.textEn || '' },
      note: '',
      duration: 0,
      locked: false,
    });
  });

  if (nameCorner.pages.length) broadcast.corners.push(nameCorner);
  if (sideCorner.pages.length) broadcast.corners.push(sideCorner);
  if (broadcast.corners.length === 0) {
    broadcast.corners.push({ id: uid('cn'), name: 'コーナー1', color: '#4da3ff', locked: false, autoFollow: 'off', pages: [], standby: [] });
  }
  rd.activeProgramId = program.id;
  rd.activeBroadcastId = broadcast.id;
  return rd;
}

function getPath() {
  return rundownPath;
}

module.exports = { init, get, set, save, migrateLegacy, buildDefault, getPath, uid };
