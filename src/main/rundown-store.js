/**
 * ランダウン (送出リスト) 管理
 *
 * v3: 送出モードを最上位に分離する。
 *   rundown = {
 *     version: 3,
 *     activeMode: 'cg' | 'telop',
 *     cg:    { programs, activeProgramId, activeBroadcastId },
 *     telop: { programs, activeProgramId, activeBroadcastId },
 *     namePool,
 *   }
 * 各モードツリーは TELOP BOX流の4階層:
 *   番組 (program) > 放送 (broadcast) > コーナー (corner) > ページ (page)
 * ページ = テンプレート + 値 (CG) または 静止画/作画 (電テロ)。
 * コーナーは pages (プレイリスト) と standby (素材集) を持つ。
 * userData/rundown.json に自動保存する。
 */
const fs = require('fs');
const path = require('path');

let rundownPath = '';
let data = null;

/** 旧チャンネルID/region の汎用TL枠への読み替え (name→tl1 / side→tl2) */
const CH_REMAP = { name: 'tl1', side: 'tl2' };
function remapChannel(id) {
  return CH_REMAP[id] || id;
}

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 46656).toString(36)}`;
}

function defaultCorner(mode) {
  return {
    id: uid('cn'),
    name: mode === 'telop' ? '電テロ1' : 'コーナー1',
    color: mode === 'telop' ? '#e8b160' : '#4da3ff',
    mode,
    locked: false,
    autoFollow: 'off',
    pages: [],
    standby: [],
  };
}

/** 1モード分の既定ツリー (番組>放送>コーナー) */
function defaultTree(mode) {
  const corner = defaultCorner(mode);
  const broadcast = { id: uid('bc'), name: '放送1', corners: [corner] };
  const program = { id: uid('pg'), name: '既定番組', broadcasts: [broadcast] };
  return { programs: [program], activeProgramId: program.id, activeBroadcastId: broadcast.id };
}

function buildDefault() {
  return {
    version: 3,
    activeMode: 'cg',
    cg: defaultTree('cg'),
    telop: defaultTree('telop'),
    namePool: [],
  };
}

/** ツリー内の全 id を再採番 (ツリー間の id 衝突を避ける) */
function regenTreeIds(tree) {
  (tree.programs || []).forEach((prog) => {
    prog.id = uid('pg');
    (prog.broadcasts || []).forEach((bc) => {
      bc.id = uid('bc');
      (bc.corners || []).forEach((cn) => {
        cn.id = uid('cn');
        ['pages', 'standby'].forEach((listName) => {
          (cn[listName] || []).forEach((pg) => { pg.id = uid('pg'); });
        });
      });
    });
  });
  const first = tree.programs && tree.programs[0];
  tree.activeProgramId = first ? first.id : null;
  tree.activeBroadcastId = first && first.broadcasts[0] ? first.broadcasts[0].id : null;
}

/** ページ1件を正規化 (kind 補完 + 電テロページの channelId 読み替え) */
function normalizePage(pg) {
  if (!pg.kind) pg.kind = 'cg';
  if (pg.channelId) pg.channelId = remapChannel(pg.channelId);
}

/** v2 (トップレベル programs) を v3 (cg/telop 2ツリー) へ分割移行 */
function migrateV2toV3(old) {
  const buildSplit = (wantTelop) => {
    const programs = (old.programs || []).map((prog) => ({
      ...prog,
      id: prog.id,
      broadcasts: (prog.broadcasts || []).map((bc) => {
        const corners = (bc.corners || [])
          .filter((cn) => (cn.mode === 'telop') === wantTelop)
          .map((cn) => ({ ...cn, mode: wantTelop ? 'telop' : 'cg' }));
        corners.forEach((cn) => ['pages', 'standby'].forEach((L) => (cn[L] || []).forEach(normalizePage)));
        if (corners.length === 0) corners.push(defaultCorner(wantTelop ? 'telop' : 'cg'));
        return { ...bc, corners };
      }),
    }));
    if (programs.length === 0) return defaultTree(wantTelop ? 'telop' : 'cg');
    return {
      programs,
      activeProgramId: programs[0].id,
      activeBroadcastId: programs[0].broadcasts[0] ? programs[0].broadcasts[0].id : null,
    };
  };
  const cg = buildSplit(false);
  const telop = buildSplit(true);
  regenTreeIds(telop); // telopツリーは cgツリーとの id 衝突を避けるため再採番
  return {
    version: 3,
    activeMode: 'cg',
    cg,
    telop,
    namePool: old.namePool || [],
  };
}

/** 永続データを正規化する (旧バージョン補完 / v2→v3移行) */
function normalize(rd) {
  if (!rd) return buildDefault();
  // v2 (トップレベル programs) は v3 へ移行
  if (Array.isArray(rd.programs) && !rd.cg) {
    return migrateV2toV3(rd);
  }
  // v3: 欠損補完
  rd.version = 3;
  if (rd.activeMode !== 'telop') rd.activeMode = 'cg';
  delete rd.sports; // v3.0: スポーツ送出を廃止 (旧データを破棄)
  ['cg', 'telop'].forEach((mode) => {
    if (!rd[mode] || !Array.isArray(rd[mode].programs) || rd[mode].programs.length === 0) {
      rd[mode] = defaultTree(mode);
    }
    rd[mode].programs.forEach((prog) => {
      (prog.broadcasts || []).forEach((bc) => {
        (bc.corners || []).forEach((cn) => {
          if (!cn.mode) cn.mode = mode;
          ['pages', 'standby'].forEach((L) => (cn[L] || []).forEach(normalizePage));
        });
      });
    });
    const first = rd[mode].programs[0];
    if (!rd[mode].activeProgramId) rd[mode].activeProgramId = first.id;
    if (!rd[mode].activeBroadcastId && first.broadcasts[0]) rd[mode].activeBroadcastId = first.broadcasts[0].id;
  });
  if (!Array.isArray(rd.namePool)) rd.namePool = [];
  return rd;
}

function init(baseDir) {
  fs.mkdirSync(baseDir, { recursive: true });
  rundownPath = path.join(baseDir, 'rundown.json');
  if (fs.existsSync(rundownPath)) {
    try {
      data = normalize(JSON.parse(fs.readFileSync(rundownPath, 'utf-8')));
      save(); // 移行結果を書き戻す
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
  if (!newData || (!newData.cg && !Array.isArray(newData.programs))) {
    throw new Error('ランダウンデータが不正です。');
  }
  data = normalize(newData);
  save();
}

function save() {
  if (!rundownPath) return;
  fs.writeFileSync(rundownPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 旧形式プロジェクト ({namePool, nameData, sideData}) をランダウンへ変換する。
 * 生成物は CG モードツリーへ格納し、電テロツリーは既定を1つ用意する。
 * @returns 変換後のランダウン全体 (v3)
 */
function migrateLegacy(legacy) {
  const rd = buildDefault();
  rd.namePool = legacy.namePool || [];
  const program = rd.cg.programs[0];
  program.name = '移行された番組';
  const broadcast = program.broadcasts[0];
  broadcast.name = '移行データ';
  broadcast.corners = [];

  const PERSON_PREFIXES = ['', '2nd', '3rd', '4th'];
  const nameCorner = {
    id: uid('cn'), name: '名前テロップ', color: '#e8b93c', mode: 'cg', locked: false, autoFollow: 'off', pages: [], standby: [],
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
      id: uid('pg'), pageNo: String(101 + i), kind: 'cg',
      templateKey: `name-${row.shotType || '1S'}`, values, note: '', duration: 0, locked: false,
    });
  });

  const sideCorner = {
    id: uid('cn'), name: 'サイドテロップ', color: '#4da3ff', mode: 'cg', locked: false, autoFollow: 'off', pages: [], standby: [],
  };
  (legacy.sideData || []).forEach((row, i) => {
    sideCorner.pages.push({
      id: uid('pg'), pageNo: String(201 + i), kind: 'cg',
      templateKey: 'side', values: { textJp: row.textJp || '', textEn: row.textEn || '' }, note: '', duration: 0, locked: false,
    });
  });

  if (nameCorner.pages.length) broadcast.corners.push(nameCorner);
  if (sideCorner.pages.length) broadcast.corners.push(sideCorner);
  if (broadcast.corners.length === 0) broadcast.corners.push(defaultCorner('cg'));
  rd.cg.activeProgramId = program.id;
  rd.cg.activeBroadcastId = broadcast.id;
  return rd;
}

function getPath() {
  return rundownPath;
}

module.exports = { init, get, set, save, migrateLegacy, buildDefault, normalize, getPath, uid, remapChannel };
