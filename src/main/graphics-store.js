/**
 * グラフィックスプロジェクト管理
 *
 * テンプレートJSON (project.json) と素材ファイル (assets/) を userData 配下で管理する。
 * 初回起動時は現行の放送デザイン (青座布団の名前スーパー + 左上サイドスーパー) を
 * 再現した既定テンプレートを生成する。
 * ※ Phase 1ではJSON直接編集、Phase 2でデザインエディタから編集する。
 */
const fs = require('fs');
const path = require('path');

let graphicsDir = '';
let assetsDirPath = '';
let projectPath = '';
let setsDirPath = '';
let registryPath = '';
let backupsDirPath = '';
let presetsPath = '';
let project = null;
/** デザインセットの一覧と現在のセット { activeId, sets: [{id, name}] } */
let registry = null;

/** 保存時に自動生成する世代バックアップの保持数 */
const BACKUP_KEEP = 30;

/** @param {string} baseDir Electronの userData ディレクトリ */
function init(baseDir) {
  graphicsDir = path.join(baseDir, 'graphics');
  assetsDirPath = path.join(graphicsDir, 'assets');
  projectPath = path.join(graphicsDir, 'project.json');
  setsDirPath = path.join(graphicsDir, 'sets');
  registryPath = path.join(graphicsDir, 'sets.json');
  backupsDirPath = path.join(graphicsDir, 'backups');
  presetsPath = path.join(graphicsDir, 'style-presets.json');
  fs.mkdirSync(assetsDirPath, { recursive: true });
  fs.mkdirSync(setsDirPath, { recursive: true });
  fs.mkdirSync(backupsDirPath, { recursive: true });

  if (!fs.existsSync(projectPath)) {
    project = buildDefaultProject();
    saveProject();
  } else {
    reload();
  }

  // セット管理への移行: 既存環境は現在のデザインを「既定デザイン」として登録
  if (!fs.existsSync(registryPath)) {
    registry = { activeId: 'default', sets: [{ id: 'default', name: '既定デザイン' }] };
    fs.writeFileSync(setFilePath('default'), JSON.stringify(project), 'utf-8');
    saveRegistry();
  } else {
    try {
      registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
    } catch (_) {
      registry = { activeId: 'default', sets: [{ id: 'default', name: '既定デザイン' }] };
      fs.writeFileSync(setFilePath('default'), JSON.stringify(project), 'utf-8');
      saveRegistry();
    }
  }
}

function setFilePath(id) {
  return path.join(setsDirPath, `${String(id).replace(/[^\w-]/g, '_')}.json`);
}

function saveRegistry() {
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

/** 旧 region (name/side) を汎用TL枠 (tl1/tl2) へ張り替える */
const REGION_REMAP = { name: 'tl1', side: 'tl2' };
function migrateRegions(proj) {
  let changed = false;
  Object.values((proj && proj.templates) || {}).forEach((tpl) => {
    if (tpl && REGION_REMAP[tpl.region]) { tpl.region = REGION_REMAP[tpl.region]; changed = true; }
  });
  return changed;
}

function reload() {
  try {
    project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
    // 旧バージョンのサンプルに含まれていた実在の人名・社名を架空のものへ置換
    const dirtySamples = sanitizeSamples(project);
    const dirtyRegions = migrateRegions(project);
    if (dirtySamples || dirtyRegions) saveProject();
  } catch (err) {
    // 壊れたJSONは既定テンプレートで復旧 (元ファイルは退避)
    try { fs.renameSync(projectPath, `${projectPath}.broken`); } catch (_) { /* ignore */ }
    project = buildDefaultProject();
    saveProject();
  }
  return project;
}

/** 旧既定テンプレートのサンプル文字列 → 架空の名前・社名への置換表 */
const SAMPLE_REPLACEMENTS = [
  ['森山 真吾', '見本 太郎'],
  ['Shingo Moriyama', 'Taro Mihon'],
  ['GMOペイメントゲートウェイ', '株式会社サンプルネット'],
  ['GMO Payment Gateway', 'Sample Net Inc.'],
  ['GMOイズム　唱和', 'サンプルイベント　開催中'],
  ['GMO ISM Chorus', 'Sample Event Now'],
];

function sanitizeSamples(proj) {
  let changed = false;
  Object.values(proj.templates || {}).forEach((template) => {
    Object.values(template.variants || {}).forEach((variant) => {
      (variant.layers || []).forEach((layer) => {
        if (layer.type !== 'text' || !layer.sample) return;
        SAMPLE_REPLACEMENTS.forEach(([from, to]) => {
          if (layer.sample.includes(from)) {
            layer.sample = layer.sample.split(from).join(to);
            changed = true;
          }
        });
      });
    });
  });
  return changed;
}

function saveProject() {
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf-8');
  // 現在のセットファイルにも同期 (セット切替で編集内容が失われないように)
  if (registry && registry.activeId) {
    fs.writeFileSync(setFilePath(registry.activeId), JSON.stringify(project), 'utf-8');
  }
  writeBackup();
}

/** 保存のたびに世代バックアップを残す (最新BACKUP_KEEP件を保持) */
let backupSeq = 0;
function writeBackup() {
  if (!backupsDirPath) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupSeq = (backupSeq + 1) % 1000;
    const name = `project-${stamp}-${String(backupSeq).padStart(3, '0')}.json`;
    fs.writeFileSync(path.join(backupsDirPath, name), JSON.stringify(project), 'utf-8');
    const files = fs.readdirSync(backupsDirPath).filter((f) => f.endsWith('.json')).sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(backupsDirPath, files.shift()));
    }
  } catch (_) { /* バックアップ失敗は本体保存を妨げない */ }
}

function getBackupsDir() {
  return backupsDirPath;
}

// ===== スタイルパレット (全デザインセット共通) =====

function readPresets() {
  try {
    const list = JSON.parse(fs.readFileSync(presetsPath, 'utf-8'));
    return Array.isArray(list) ? list : [];
  } catch (_) {
    return [];
  }
}

function listStylePresets() {
  return readPresets();
}

function addStylePreset(name, style) {
  const list = readPresets();
  const preset = {
    id: `sp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`,
    name: String(name || '').slice(0, 40) || '無題スタイル',
    style,
  };
  list.push(preset);
  fs.writeFileSync(presetsPath, JSON.stringify(list, null, 2), 'utf-8');
  return preset;
}

function deleteStylePreset(id) {
  const list = readPresets().filter((p) => p.id !== id);
  fs.writeFileSync(presetsPath, JSON.stringify(list, null, 2), 'utf-8');
  return list;
}

// ===== デザインセットのサムネイル =====

function thumbPath(id) {
  return path.join(setsDirPath, `${String(id).replace(/[^\w-]/g, '_')}.png`);
}

/** アクティブセットのサムネイルを保存する (エディタ保存時に生成されるPNG dataURL) */
function saveSetThumb(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!m || !registry || !registry.activeId) return false;
  fs.writeFileSync(thumbPath(registry.activeId), Buffer.from(m[1], 'base64'));
  return true;
}

/** セットID→サムネイルdataURL のマップを返す (存在するもののみ) */
function getSetThumbs() {
  const thumbs = {};
  if (!registry) return thumbs;
  registry.sets.forEach((s) => {
    const p = thumbPath(s.id);
    if (fs.existsSync(p)) {
      thumbs[s.id] = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
    }
  });
  return thumbs;
}

// ===== デザインセット管理 =====

function listSets() {
  return {
    activeId: registry.activeId,
    sets: registry.sets.map((s) => ({ id: s.id, name: s.name, active: s.id === registry.activeId })),
  };
}

/**
 * 新しいデザインセットを作成してアクティブにする
 * @param {string} name セット名
 * @param {boolean} fromCurrent true=現在のデザインを複製 / false=初期テンプレートから
 */
function createSet(name, fromCurrent) {
  const id = `set_${Date.now().toString(36)}_${Math.floor(Math.random() * 1000)}`;
  let content;
  if (fromCurrent) {
    content = JSON.parse(JSON.stringify(project));
  } else {
    content = buildDefaultProject();
    // フォント登録 (LINE Seed JP・持ち込みフォント) は素材共有のため引き継ぐ
    if (project && project.assets && project.assets.fonts) {
      content.assets.fonts = JSON.parse(JSON.stringify(project.assets.fonts));
    }
  }
  registry.sets.push({ id, name: name || '新しいデザイン' });
  registry.activeId = id;
  project = content;
  saveRegistry();
  saveProject();
  return id;
}

/** 指定セットへ切り替える (現在の編集は保存済み前提。project.jsonにも反映) */
function switchSet(id) {
  const entry = registry.sets.find((s) => s.id === id);
  if (!entry) throw new Error('デザインセットが見つかりません。');
  const file = setFilePath(id);
  if (!fs.existsSync(file)) throw new Error('デザインセットのファイルが見つかりません。');
  project = JSON.parse(fs.readFileSync(file, 'utf-8'));
  sanitizeSamples(project);
  migrateRegions(project);
  registry.activeId = id;
  saveRegistry();
  saveProject();
}

function renameSet(id, name) {
  const entry = registry.sets.find((s) => s.id === id);
  if (!entry) throw new Error('デザインセットが見つかりません。');
  entry.name = name;
  saveRegistry();
}

function deleteSet(id) {
  if (id === registry.activeId) throw new Error('使用中のデザインセットは削除できません。先に別のセットへ切り替えてください。');
  if (registry.sets.length <= 1) throw new Error('最後のデザインセットは削除できません。');
  registry.sets = registry.sets.filter((s) => s.id !== id);
  try { fs.unlinkSync(setFilePath(id)); } catch (_) { /* ignore */ }
  try { fs.unlinkSync(thumbPath(id)); } catch (_) { /* ignore */ }
  saveRegistry();
}

function getProject() {
  return project;
}

function setProject(next) {
  project = next;
  saveProject();
}

function getProjectPath() {
  return projectPath;
}

function getAssetsDir() {
  return assetsDirPath;
}

// ===== 既定テンプレート =====

/** テキストレイヤー生成ヘルパー */
function textLayer(opts) {
  return {
    id: opts.id,
    name: opts.name,
    type: 'text',
    binding: opts.binding,
    sample: opts.sample || '',
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    align: opts.align || 'left',
    vAlign: opts.vAlign || 'middle',
    autoFit: opts.autoFit,
    font: {
      // 既定はLINE Seed JP (起動時に自動取得。取得前は游ゴシックにフォールバック)
      family: opts.family || '"LINE Seed JP", "Yu Gothic UI", "Noto Sans JP", sans-serif',
      size: opts.size,
      weight: opts.weight || 700,
      color: opts.color || '#ffffff',
      letterSpacing: opts.letterSpacing || 0,
      lineHeight: opts.lineHeight || 1.25,
    },
    shadow: opts.shadow || null,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

/** 青座布団 (矩形) レイヤー */
function boxLayer(id, x, y, w, h) {
  return {
    id,
    name: '座布団',
    type: 'rect',
    x, y, w, h,
    fill: { type: 'gradient', from: '#0d6ab7', to: '#083d7a', angle: 180 },
    border: { width: 3, color: '#ffffff' },
    radius: 4,
    visible: true,
    locked: false,
    opacity: 1,
  };
}

/**
 * 名前スーパー1箱分のレイヤー群 (肩書2行=左上小 / 名前=右寄せ大)
 * @param {number} pi 人物インデックス (0始まり)
 * @param {string} lang 'Jp' | 'En'
 */
function namePersonLayers(pi, lang, box, opts) {
  const prefix = ['', '2nd', '3rd', '4th'][pi];
  const bindTitle = prefix ? `${prefix}Title${lang}` : `title${lang}`;
  const bindName = prefix ? `${prefix}Name${lang}` : `name${lang}`;
  const nameW = opts.nameW;
  const pad = opts.pad;

  const layers = [boxLayer(`box${pi + 1}`, box.x, box.y, box.w, box.h)];

  if (!opts.nameOnly) {
    const title = textLayer({
      id: `title${pi + 1}`, name: `肩書${pi + 1}`,
      binding: bindTitle,
      sample: lang === 'Jp' ? '最優秀新人賞\n株式会社サンプルネット' : 'Rookie of the Year\nSample Net Inc.',
      x: box.x + pad, y: box.y + 10, w: box.w - nameW - pad * 2, h: box.h - 20,
      size: opts.titleSize, weight: 700, align: 'left', vAlign: 'middle',
      lineHeight: 1.35,
    });
    title.autoFit = 'tracking'; // 短い肩書は字間を広げ、長い肩書は詰め+長体
    layers.push(title);
  }

  const name = textLayer({
    id: `name${pi + 1}`, name: `名前${pi + 1}`,
    binding: bindName,
    sample: lang === 'Jp' ? '見本 太郎' : 'Taro Mihon',
    x: opts.nameOnly ? box.x + pad : box.x + box.w - nameW - pad,
    y: box.y + 10,
    w: opts.nameOnly ? box.w - pad * 2 : nameW,
    h: box.h - 20,
    size: opts.nameSize, weight: 800,
    align: opts.nameOnly ? 'center' : 'right', vAlign: 'middle',
  });
  name.autoFit = 'tracking'; // 短い名前は字間を広げ、長い名前は詰め+長体
  layers.push(name);

  return layers;
}

/** ショットタイプごとの箱配置定義 (1920x1080基準・下位置) */
const NAME_LAYOUTS = {
  nameOnly: { boxes: [{ x: 120, y: 884, w: 680, h: 122 }], titleSize: 0,  nameSize: 48, nameW: 0,   pad: 30, nameOnly: true },
  '1S':     { boxes: [{ x: 120, y: 884, w: 820, h: 122 }], titleSize: 26, nameSize: 46, nameW: 340, pad: 28 },
  '2S':     { boxes: [{ x: 120, y: 884, w: 810, h: 122 }, { x: 990, y: 884, w: 810, h: 122 }],
              titleSize: 24, nameSize: 42, nameW: 300, pad: 26 },
  '3S':     { boxes: [{ x: 90, y: 884, w: 555, h: 122 }, { x: 705, y: 884, w: 555, h: 122 }, { x: 1320, y: 884, w: 555, h: 122 }],
              titleSize: 20, nameSize: 36, nameW: 230, pad: 22 },
  '4S':     { boxes: [{ x: 60, y: 890, w: 425, h: 116 }, { x: 522, y: 890, w: 425, h: 116 }, { x: 984, y: 890, w: 425, h: 116 }, { x: 1446, y: 890, w: 425, h: 116 }],
              titleSize: 17, nameSize: 30, nameW: 185, pad: 18 },
};

function buildNameVariant(shotType, lang) {
  const layout = NAME_LAYOUTS[shotType];
  const layers = [];
  layout.boxes.forEach((box, pi) => {
    layers.push(...namePersonLayers(pi, lang, box, layout));
  });
  return {
    layers,
    animation: {
      in: { preset: 'slide', direction: 'up', distance: 50, duration: 450, easing: 'ease-out', stagger: 70 },
      out: { preset: 'fade', duration: 250, easing: 'ease-in' },
    },
  };
}

function buildSideVariant(lang) {
  return {
    layers: [
      textLayer({
        id: 'sideText', name: 'サイドテキスト',
        binding: lang === 'Jp' ? 'textJp' : 'textEn',
        sample: lang === 'Jp' ? 'サンプルイベント　開催中' : 'Sample Event Now',
        x: 140, y: 48, w: 1400, h: 80,
        size: 54, weight: 800, align: 'left', vAlign: 'middle',
        letterSpacing: 0.02,
        autoFit: 'tracking', // 短文は字間を広げ、長文は詰め+長体

        shadow: { x: 0, y: 3, blur: 10, color: 'rgba(0,20,60,0.65)' },
      }),
    ],
    animation: {
      in: { preset: 'wipe', direction: 'right', duration: 500, easing: 'ease-out' },
      out: { preset: 'fade', duration: 250, easing: 'ease-in' },
    },
  };
}

// ===== スポーツスコアバグ (日本のスポーツ中継風) =====
// 描画プリミティブ (矩形の boxShadow / radii(角別) / polycustom斜めカット、
// 文字のグラデ塗り・多重縁取り・影) を活かした作り込み。
// binding規約はマニュアル参照。操作盤がこの binding名へ値を流し込む。

const SP = {
  navyFrom: '#20437a', navyTo: '#0a1830', // パネルのグラデ (上=明→下=暗)
  wellFrom: '#0b1626', wellTo: '#050b15',  // 得点ウェル (へこみ)
  gold: '#f5c542', dim: '#a8c0dd', ink: '#0a1526',
  home: { from: '#ff5f4d', to: '#c8200f' }, // ホーム=赤 (光沢グラデ)
  away: { from: '#5aa4ff', to: '#1462d4' },  // アウェイ=青
};
const spGrad = (from, to, angle) => ({ type: 'gradient', from, to, angle: angle === undefined ? 180 : angle });
/** リッチ矩形 */
function spRect(o) {
  return {
    id: o.id, name: o.name || o.id, type: 'rect',
    x: o.x, y: o.y, w: o.w, h: o.h,
    fill: o.fill, border: o.border || { width: 0, color: '#ffffff' },
    radius: o.radius, radii: o.radii, boxShadow: o.boxShadow,
    shape: o.shape, points: o.points,
    visible: true, locked: false, opacity: o.opacity !== undefined ? o.opacity : 1,
  };
}
/** リッチ文字 (グラデ塗り/縁取り/影対応) */
function spText(o) {
  const l = textLayer({
    id: o.id, name: o.name || o.id, binding: o.binding, sample: o.sample || '',
    x: o.x, y: o.y, w: o.w, h: o.h, size: o.size, weight: o.weight || 800,
    color: o.color || '#ffffff', align: o.align || 'center', vAlign: 'middle',
    letterSpacing: o.ls,
  });
  l.autoFit = o.fit || 'shrink';
  if (o.text !== undefined) { l.binding = undefined; l.text = o.text; }
  if (o.fill) l.fill = o.fill;
  if (o.strokes) l.strokes = o.strokes;
  if (o.shadow) l.shadow = o.shadow;
  if (o.trackMax !== undefined) l.font.trackMax = o.trackMax;
  return l;
}
// 大きな数字の共通スタイル (白→淡青グラデ + 濃紺縁取り + 影)
const SCORE_FILL = { type: 'gradient', from: '#ffffff', to: '#cfe0ff', angle: 180 };
const SCORE_STROKE = [{ width: 3, color: SP.ink }];
const SCORE_SHADOW = { x: 0, y: 3, blur: 8, color: 'rgba(0,0,0,0.55)' };

/**
 * スポーツ汎用スコアバグ (画面上部センターのバー)
 * binding規約: homeName/homeScore/awayName/awayScore/period/clock/homeSets/awaySets
 */
function buildSportsScoreVariant() {
  const y = 44; const h = 94;
  const L = 530; const W = 860; const R = L + W; // 530..1390 (中央960基準)
  const bw = 250; // チームブロック幅
  const cx = 960;
  return {
    layers: [
      // 本体パネル (ドロップシャドウ付き)
      spRect({ id: 'bar', name: 'バー', x: L, y, w: W, h, radii: [16, 16, 16, 16],
        fill: spGrad(SP.navyFrom, SP.navyTo), boxShadow: { x: 0, y: 8, blur: 28, color: 'rgba(0,0,0,0.55)' } }),
      // 上端の光沢ライン
      spRect({ id: 'barHi', name: 'ハイライト', x: L + 16, y: y + 4, w: W - 32, h: 3, radii: [3, 3, 3, 3],
        fill: spGrad('rgba(255,255,255,0.35)', 'rgba(255,255,255,0)'), opacity: 0.85 }),
      // ホームチームブロック (光沢グラデ)
      spRect({ id: 'homeBlock', name: 'ホーム枠', x: L, y, w: bw, h, radii: [16, 0, 0, 16],
        fill: spGrad(SP.home.from, SP.home.to) }),
      spRect({ id: 'homeGloss', name: 'ホーム光沢', x: L, y, w: bw, h: 40, radii: [16, 0, 0, 0],
        fill: spGrad('rgba(255,255,255,0.30)', 'rgba(255,255,255,0)') }),
      // アウェイチームブロック
      spRect({ id: 'awayBlock', name: 'アウェイ枠', x: R - bw, y, w: bw, h, radii: [0, 16, 16, 0],
        fill: spGrad(SP.away.from, SP.away.to) }),
      spRect({ id: 'awayGloss', name: 'アウェイ光沢', x: R - bw, y, w: bw, h: 40, radii: [0, 16, 0, 0],
        fill: spGrad('rgba(255,255,255,0.30)', 'rgba(255,255,255,0)') }),
      // 斜めカットのゴールドアクセント (チーム枠と得点の境目)
      spRect({ id: 'homeSlash', name: '斜め左', x: L + bw - 6, y, w: 22, h, shape: 'polycustom',
        points: [[0.5, 0], [1, 0], [0.5, 1], [0, 1]], fill: spGrad(SP.gold, '#d9a520'), opacity: 0.95 }),
      spRect({ id: 'awaySlash', name: '斜め右', x: R - bw - 16, y, w: 22, h, shape: 'polycustom',
        points: [[0, 0], [0.5, 0], [1, 1], [0.5, 1]], fill: spGrad(SP.gold, '#d9a520'), opacity: 0.95 }),
      // 得点ウェル (中央のへこみ)
      spRect({ id: 'scoreWell', name: '得点ウェル', x: cx - 172, y: y + 8, w: 344, h: h - 20, radii: [10, 10, 10, 10],
        fill: spGrad(SP.wellFrom, SP.wellTo), opacity: 0.6 }),
      // チーム名 (ブロック上・白抜き)
      spText({ id: 'homeName', name: 'ホーム名', binding: 'homeName', sample: 'HOME',
        x: L + 10, y: y + 10, w: bw - 20, h: h - 20, size: 36, weight: 900, fit: 'tracking', trackMax: 0.18,
        strokes: [{ width: 3, color: 'rgba(0,0,0,0.35)' }], shadow: { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.4)' } }),
      spText({ id: 'awayName', name: 'アウェイ名', binding: 'awayName', sample: 'AWAY',
        x: R - bw + 10, y: y + 10, w: bw - 20, h: h - 20, size: 36, weight: 900, fit: 'tracking', trackMax: 0.18,
        strokes: [{ width: 3, color: 'rgba(0,0,0,0.35)' }], shadow: { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.4)' } }),
      // 得点 (大きな数字・白→淡青グラデ)
      spText({ id: 'homeScore', name: 'ホーム得点', binding: 'homeScore', sample: '0',
        x: cx - 168, y: y + 4, w: 150, h: h - 12, size: 66, weight: 900,
        fill: SCORE_FILL, strokes: SCORE_STROKE, shadow: SCORE_SHADOW }),
      spText({ id: 'sep', name: '区切り', text: '−', x: cx - 26, y: y + 6, w: 52, h: h - 16,
        size: 44, weight: 800, color: SP.gold }),
      spText({ id: 'awayScore', name: 'アウェイ得点', binding: 'awayScore', sample: '0',
        x: cx + 18, y: y + 4, w: 150, h: h - 12, size: 66, weight: 900,
        fill: SCORE_FILL, strokes: SCORE_STROKE, shadow: SCORE_SHADOW }),
      // セット数 (セット制のみ・空なら非表示)
      spText({ id: 'homeSets', name: 'ホームセット', binding: 'homeSets', sample: '',
        x: cx - 200, y: y + 8, w: 34, h: 30, size: 22, weight: 900, color: SP.gold }),
      spText({ id: 'awaySets', name: 'アウェイセット', binding: 'awaySets', sample: '',
        x: cx + 166, y: y + 8, w: 34, h: 30, size: 22, weight: 900, color: SP.gold }),
      // ピリオド/時計の下タブ
      spRect({ id: 'subBar', name: '下タブ', x: cx - 170, y: y + h + 3, w: 340, h: 40, radii: [10, 10, 10, 10],
        fill: spGrad('#16305a', '#070f20'), boxShadow: { x: 0, y: 4, blur: 14, color: 'rgba(0,0,0,0.45)' } }),
      spText({ id: 'period', name: 'ピリオド', binding: 'period', sample: '第1ピリオド',
        x: cx - 162, y: y + h + 4, w: 172, h: 38, size: 21, weight: 700, color: SP.dim }),
      spRect({ id: 'subDiv', name: '仕切り', x: cx + 16, y: y + h + 11, w: 2, h: 24, fill: { type: 'solid', color: SP.gold }, opacity: 0.55 }),
      spText({ id: 'clock', name: '時計', binding: 'clock', sample: '00:00',
        x: cx + 20, y: y + h + 4, w: 148, h: 38, size: 26, weight: 900, color: SP.gold, ls: 0.04 }),
    ],
    animation: {
      in: { preset: 'slide', direction: 'down', distance: 40, duration: 420, easing: 'ease-out' },
      out: { preset: 'fade', duration: 250, easing: 'ease-in' },
    },
  };
}

/**
 * 野球スコアバグ (イニング/BSO/塁) — 画面左上のカウントボード
 * binding規約: homeName/homeScore/awayName/awayScore/inning/bases/bso
 *   + balls/strikes/outs (B/S/Oを個別に色分け表示。bso=結合文字列も併用可)
 */
function buildSportsBaseballVariant() {
  const x = 54; const y = 54; const w = 396; const h = 214;
  const inX = x + 12; const inW = w - 24; // 内側
  const rowH = 52;
  return {
    layers: [
      spRect({ id: 'panel', name: 'パネル', x, y, w, h, radii: [16, 16, 16, 16],
        fill: spGrad(SP.navyFrom, SP.navyTo), boxShadow: { x: 0, y: 8, blur: 28, color: 'rgba(0,0,0,0.55)' } }),
      spRect({ id: 'panelHi', name: 'ハイライト', x: x + 16, y: y + 4, w: w - 32, h: 3, radii: [3, 3, 3, 3],
        fill: spGrad('rgba(255,255,255,0.32)', 'rgba(255,255,255,0)'), opacity: 0.85 }),
      // アウェイ行
      spRect({ id: 'awayRow', name: 'アウェイ行', x: inX, y: y + 12, w: inW, h: rowH, radii: [8, 8, 8, 8],
        fill: { type: 'solid', color: 'rgba(255,255,255,0.06)' } }),
      spRect({ id: 'awayChip', name: 'アウェイ色', x: inX + 8, y: y + 22, w: 10, h: rowH - 20, radii: [3, 3, 3, 3],
        fill: spGrad(SP.away.from, SP.away.to) }),
      spText({ id: 'awayName', name: 'アウェイ名', binding: 'awayName', sample: 'AWAY',
        x: inX + 28, y: y + 12, w: 210, h: rowH, size: 30, weight: 800, align: 'left', fit: 'tracking', trackMax: 0.12 }),
      spText({ id: 'awayScore', name: 'アウェイ得点', binding: 'awayScore', sample: '0',
        x: x + w - 96, y: y + 10, w: 84, h: rowH + 4, size: 44, weight: 900,
        fill: SCORE_FILL, strokes: SCORE_STROKE, shadow: SCORE_SHADOW }),
      // ホーム行
      spRect({ id: 'homeRow', name: 'ホーム行', x: inX, y: y + 12 + rowH + 2, w: inW, h: rowH, radii: [8, 8, 8, 8],
        fill: { type: 'solid', color: 'rgba(255,255,255,0.03)' } }),
      spRect({ id: 'homeChip', name: 'ホーム色', x: inX + 8, y: y + 22 + rowH + 2, w: 10, h: rowH - 20, radii: [3, 3, 3, 3],
        fill: spGrad(SP.home.from, SP.home.to) }),
      spText({ id: 'homeName', name: 'ホーム名', binding: 'homeName', sample: 'HOME',
        x: inX + 28, y: y + 12 + rowH + 2, w: 210, h: rowH, size: 30, weight: 800, align: 'left', fit: 'tracking', trackMax: 0.12 }),
      spText({ id: 'homeScore', name: 'ホーム得点', binding: 'homeScore', sample: '0',
        x: x + w - 96, y: y + 10 + rowH + 2, w: 84, h: rowH + 4, size: 44, weight: 900,
        fill: SCORE_FILL, strokes: SCORE_STROKE, shadow: SCORE_SHADOW }),
      // 下部ウェル (イニング/塁/カウント)
      spRect({ id: 'countWell', name: 'カウント枠', x: inX, y: y + 12 + rowH * 2 + 6, w: inW, h: 74, radii: [10, 10, 10, 10],
        fill: spGrad(SP.wellFrom, SP.wellTo), opacity: 0.55 }),
      spText({ id: 'inning', name: 'イニング', binding: 'inning', sample: '1回表',
        x: inX + 12, y: y + 12 + rowH * 2 + 10, w: 150, h: 38, size: 26, weight: 900, color: SP.gold, align: 'left' }),
      spText({ id: 'bases', name: '塁', binding: 'bases', sample: '◇◇◇',
        x: x + w - 148, y: y + 12 + rowH * 2 + 10, w: 132, h: 38, size: 26, weight: 800, color: SP.gold, ls: 0.06 }),
      // B/S/O (個別色分け: ボール=緑 / ストライク=黄 / アウト=赤)
      spText({ id: 'bLabel', name: 'B', text: 'B', x: inX + 12, y: y + 12 + rowH * 2 + 46, w: 22, h: 28, size: 20, weight: 900, color: '#7fe6a6', align: 'left' }),
      spText({ id: 'balls', name: 'ボール', binding: 'balls', sample: '○○○', x: inX + 36, y: y + 12 + rowH * 2 + 46, w: 70, h: 28, size: 22, weight: 800, color: '#7fe6a6', align: 'left', ls: 0.04 }),
      spText({ id: 'sLabel', name: 'S', text: 'S', x: inX + 132, y: y + 12 + rowH * 2 + 46, w: 22, h: 28, size: 20, weight: 900, color: SP.gold, align: 'left' }),
      spText({ id: 'strikes', name: 'ストライク', binding: 'strikes', sample: '○○', x: inX + 156, y: y + 12 + rowH * 2 + 46, w: 52, h: 28, size: 22, weight: 800, color: SP.gold, align: 'left', ls: 0.04 }),
      spText({ id: 'oLabel', name: 'O', text: 'O', x: inX + 232, y: y + 12 + rowH * 2 + 46, w: 22, h: 28, size: 20, weight: 900, color: '#ff7a6b', align: 'left' }),
      spText({ id: 'outs', name: 'アウト', binding: 'outs', sample: '○○', x: inX + 256, y: y + 12 + rowH * 2 + 46, w: 52, h: 28, size: 22, weight: 800, color: '#ff7a6b', align: 'left', ls: 0.04 }),
    ],
    animation: {
      in: { preset: 'slide', direction: 'right', distance: 40, duration: 400, easing: 'ease-out' },
      out: { preset: 'fade', duration: 250, easing: 'ease-in' },
    },
  };
}

function buildDefaultProject() {
  const templates = {};
  Object.keys(NAME_LAYOUTS).forEach((shotType) => {
    templates[`name-${shotType}`] = {
      region: 'tl1',
      variants: {
        jp: buildNameVariant(shotType, 'Jp'),
        en: buildNameVariant(shotType, 'En'),
      },
    };
  });
  templates.side = {
    region: 'tl2',
    variants: {
      jp: buildSideVariant('Jp'),
      en: buildSideVariant('En'),
    },
  };
  // スポーツコーダー用スコアバグ (binding規約は各build関数のコメント参照)
  templates['sports-score'] = {
    region: 'tl1',
    variants: { jp: buildSportsScoreVariant(), en: buildSportsScoreVariant() },
  };
  templates['sports-baseball'] = {
    region: 'tl1',
    variants: { jp: buildSportsBaseballVariant(), en: buildSportsBaseballVariant() },
  };

  return {
    version: 1,
    canvas: { width: 1920, height: 1080 },
    assets: { images: [], fonts: [] },
    templates,
  };
}

/** プロジェクトが参照している素材ファイル名の一覧 (エクスポート用) */
function referencedAssetFiles(proj) {
  const files = new Set();
  const assets = proj.assets || {};
  (assets.fonts || []).forEach((f) => {
    if (f.file) files.add(f.file);
    if (f.cssFile) files.add(f.cssFile);
    (f.files || []).forEach((sub) => files.add(sub)); // WebフォントのCSSが参照するファイル群
  });
  (assets.images || []).forEach((f) => { if (f.file) files.add(f.file); });
  Object.values(proj.templates || {}).forEach((template) => {
    Object.values(template.variants || {}).forEach((variant) => {
      (variant.layers || []).forEach((layer) => {
        if (layer.type === 'image' && layer.file) files.add(layer.file);
      });
    });
  });
  return [...files];
}

module.exports = {
  init, reload, getProject, setProject, getProjectPath, getAssetsDir,
  buildDefaultProject, referencedAssetFiles,
  listSets, createSet, switchSet, renameSet, deleteSet,
  getBackupsDir, listStylePresets, addStylePreset, deleteStylePreset,
  saveSetThumb, getSetThumbs,
};
