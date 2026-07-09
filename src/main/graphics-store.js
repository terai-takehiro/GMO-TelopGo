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
let project = null;

/** @param {string} baseDir Electronの userData ディレクトリ */
function init(baseDir) {
  graphicsDir = path.join(baseDir, 'graphics');
  assetsDirPath = path.join(graphicsDir, 'assets');
  projectPath = path.join(graphicsDir, 'project.json');
  fs.mkdirSync(assetsDirPath, { recursive: true });

  if (!fs.existsSync(projectPath)) {
    project = buildDefaultProject();
    saveProject();
  } else {
    reload();
  }
}

function reload() {
  try {
    project = JSON.parse(fs.readFileSync(projectPath, 'utf-8'));
    // 旧バージョンのサンプルに含まれていた実在の人名・社名を架空のものへ置換
    if (sanitizeSamples(project)) saveProject();
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
    title.autoFit = 'condense'; // 長い肩書は長体で自動調整
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
  name.autoFit = 'condense'; // 長い名前は長体で自動調整
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
        shadow: { x: 0, y: 3, blur: 10, color: 'rgba(0,20,60,0.65)' },
      }),
    ],
    animation: {
      in: { preset: 'wipe', direction: 'right', duration: 500, easing: 'ease-out' },
      out: { preset: 'fade', duration: 250, easing: 'ease-in' },
    },
  };
}

function buildDefaultProject() {
  const templates = {};
  Object.keys(NAME_LAYOUTS).forEach((shotType) => {
    templates[`name-${shotType}`] = {
      region: 'name',
      variants: {
        jp: buildNameVariant(shotType, 'Jp'),
        en: buildNameVariant(shotType, 'En'),
      },
    };
  });
  templates.side = {
    region: 'side',
    variants: {
      jp: buildSideVariant('Jp'),
      en: buildSideVariant('En'),
    },
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

module.exports = { init, reload, getProject, setProject, getProjectPath, getAssetsDir, buildDefaultProject, referencedAssetFiles };
