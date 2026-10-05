const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { readExcel } = require('./excel-reader');
const gpioDio = require('./gpio-dio');
const remoteLink = require('./remote-link');
const designSync = require('./design-sync');
const graphicsStore = require('./graphics-store');
const graphicsServer = require('./graphics-server');
const liveData = require('./live-data');
const googleFonts = require('./google-fonts');
const { getSettings, saveSettings, getGpioConfig, getGraphicsConfig, getChannels, getOutputGroups, getNameFields } = require('./settings-store');
const rundownStore = require('./rundown-store');

/** テンプレートのbindingフィールド一覧 (レイヤー順・重複なし) */
function templateBindings(templateKey) {
  const project = graphicsStore.getProject();
  const template = project && project.templates && project.templates[templateKey];
  if (!template) return [];
  const bindings = [];
  ['jp', 'en'].forEach((lang) => {
    const variant = template.variants && template.variants[lang];
    ((variant && variant.layers) || []).forEach((layer) => {
      if (layer.type === 'text' && layer.binding && !bindings.includes(layer.binding)) {
        bindings.push(layer.binding);
      }
    });
  });
  return bindings;
}

/**
 * テンプレートの文字フィールド一覧 (templateBindings と同じ順序) と、
 * 見出し用のレイヤー名・見本のサンプル文字
 */
function templateFields(templateKey) {
  const project = graphicsStore.getProject();
  const template = project && project.templates && project.templates[templateKey];
  if (!template) return [];
  const fields = [];
  ['jp', 'en'].forEach((lang) => {
    const variant = template.variants && template.variants[lang];
    ((variant && variant.layers) || []).forEach((layer) => {
      if (layer.type !== 'text' || !layer.binding || fields.some((f) => f.binding === layer.binding)) return;
      fields.push({ binding: layer.binding, label: layer.name || '', sample: layer.sample || layer.text || '' });
    });
  });
  return fields;
}

/**
 * Excel の列として使う変数 (取込/書き出し共通)。
 * template.excelColumns ([{binding, header, enabled}]) があればその順序・見出し・有効/無効に従い、
 * テンプレートから無くなった変数は除外、後から増えた変数は末尾に有効で追加する。
 * 設定が無ければ従来どおり全変数をレイヤー順で返す。
 * (デザインエディタの excelColumns() と同じ規則)
 */
function templateExcelColumns(templateKey) {
  const fields = templateFields(templateKey);
  const project = graphicsStore.getProject();
  const template = project && project.templates && project.templates[templateKey];
  const conf = Array.isArray(template && template.excelColumns) ? template.excelColumns : [];
  const byBinding = new Map(fields.map((f) => [f.binding, f]));
  const cols = [];
  const seen = new Set();
  conf.forEach((c) => {
    const f = c && byBinding.get(c.binding);
    if (!f || seen.has(c.binding)) return;
    seen.add(c.binding);
    cols.push({ ...f, header: String(c.header || '').trim(), enabled: c.enabled !== false });
  });
  fields.forEach((f) => {
    if (!seen.has(f.binding)) cols.push({ ...f, header: '', enabled: true });
  });
  return cols.filter((c) => c.enabled);
}

/** 氏名テロップ系テンプレート (name-*) の人数ごとの項目 (binding 名の接頭辞) */
const NAME_BATCH_PREFIXES = ['', '2nd', '3rd', '4th'];
const NAME_BATCH_LABELS = ['1st', '2nd', '3rd', '4th'];

/**
 * binding名 (例: 'titleJp' / '2ndNameEn') を人数インデックス pi・接頭辞から組み立てる。
 * 設定タブの「氏名テロップの項目名」でスロットごとに変数名を変更していれば、それを優先する。
 */
function nameBinding(prefix, field, lang) {
  // field: 'Title' | 'Name'。接頭辞なし(1人目)は先頭を小文字化 (titleJp / nameJp)
  const slot = prefix ? `${prefix}${field}${lang}` : `${field.charAt(0).toLowerCase()}${field.slice(1)}${lang}`;
  const nameFields = getNameFields();
  return (nameFields && nameFields[slot]) || slot;
}

/**
 * 氏名テロップ系テンプレート (name-*) のショットタイプ一覧。
 * 'nameOnly' を先頭に、以降は人数の昇順で並べる。
 */
function nameShotTypes() {
  const project = graphicsStore.getProject();
  const keys = Object.keys((project && project.templates) || {})
    .filter((k) => k.startsWith('name-'))
    .map((k) => k.slice('name-'.length));
  return keys.sort((a, b) => {
    const order = (t) => (t === 'nameOnly' ? -1 : parseInt(t, 10) || 999);
    return order(a) - order(b);
  });
}

/**
 * 「テンプレ」列の値(行)から、氏名テロップ一括取込用のページ群を組み立てる。
 * テンプレート自体に存在する binding にのみ値を詰め、存在しないテンプレ値の行はスキップする。
 */
function buildNameBatchPages(dataRows) {
  const pages = [];
  const skipped = [];
  dataRows.forEach((row, i) => {
    const shotType = String(row[0] || '').trim();
    const templateKey = `name-${shotType}`;
    const bindings = new Set(templateBindings(templateKey));
    if (!shotType || bindings.size === 0) {
      skipped.push({ row: i + 2, shotType, reason: `テンプレ「${shotType}」に対応するテンプレートが見つかりません` });
      return;
    }
    const values = {};
    NAME_BATCH_PREFIXES.forEach((prefix, pi) => {
      const nameBindJp = nameBinding(prefix, 'Name', 'Jp');
      if (!bindings.has(nameBindJp)) return; // このテンプレートにはこの人数分の枠がない
      const base = 1 + pi * 4;
      const titleBindJp = nameBinding(prefix, 'Title', 'Jp');
      const titleBindEn = nameBinding(prefix, 'Title', 'En');
      const nameBindEn = nameBinding(prefix, 'Name', 'En');
      if (bindings.has(titleBindJp)) values[titleBindJp] = String(row[base] || '');
      values[nameBindJp] = String(row[base + 1] || '');
      if (bindings.has(titleBindEn)) values[titleBindEn] = String(row[base + 2] || '');
      values[nameBindEn] = String(row[base + 3] || '');
    });
    pages.push({ templateKey, values });
  });
  return { pages, skipped };
}

/** テンプレートの出力リージョン(チャンネル)を解決 */
function templateRegion(templateKey) {
  const project = graphicsStore.getProject();
  const template = project && project.templates && project.templates[templateKey];
  if (!template || !template.region) {
    throw new Error(`テンプレートが見つかりません: ${templateKey}`);
  }
  return template.region;
}

// ===== オンエア操作ログ =====
let logsDirPath = '';
function appendOnairLog(action, detail) {
  if (!logsDirPath) return;
  try {
    fs.mkdirSync(logsDirPath, { recursive: true });
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    const time = now.toTimeString().slice(0, 8);
    fs.appendFileSync(
      path.join(logsDirPath, `onair-${day}.log`),
      `${time}\t${action}\t${detail || ''}\n`, 'utf-8');
  } catch (_) { /* ログ失敗は送出を妨げない */ }
}

/** インストール済みの日本語フォントのファミリー名一覧 (初回のみ取得しキャッシュ) */
let systemFontsCache = null;

/**
 * Windows: WPF で各フォントが「あ」(U+3042) のグリフを持つかを調べ、日本語フォントだけを列挙する。
 * 名前は日本語名 (ja-jp) があればそれを、無ければ既定名を使う。
 * PowerShell の既定出力は Shift_JIS のため、UTF-8 に切り替えてから出力する (文字化け対策)。
 */
const WIN_JA_FONTS_SCRIPT = [
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName PresentationCore',
  "$ja = [Windows.Markup.XmlLanguage]::GetLanguage('ja-jp')",
  'foreach ($f in [Windows.Media.Fonts]::SystemFontFamilies) {',
  '  $ok = $false',
  '  foreach ($t in $f.GetTypefaces()) {',
  '    $g = $null',
  '    if ($t.TryGetGlyphTypeface([ref]$g)) { $ok = $g.CharacterToGlyphMap.ContainsKey(0x3042); break }',
  '  }',
  '  if ($ok) {',
  '    $n = $f.FamilyNames[$ja]',
  "    if (-not $n) { $n = ($f.Source -split '#')[-1] }",
  '    $n',
  '  }',
  '}',
].join('\n');

/** WPF が使えない環境向けのフォールバック (日本語判定なし・名前の文字化けのみ対策) */
const WIN_ALL_FONTS_SCRIPT = '[Console]::OutputEncoding = [Text.Encoding]::UTF8;'
  + '[void][Reflection.Assembly]::LoadWithPartialName("System.Drawing");'
  + '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { maxBuffer: 4 * 1024 * 1024, timeout: 30000, encoding: 'utf8' }, (err, stdout) => {
        resolve(err ? [] : String(stdout).replace(/^﻿/, '').split(/\r?\n/));
      });
  });
}

function listSystemFonts() {
  if (systemFontsCache) return Promise.resolve(systemFontsCache);

  const finish = (names) => {
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ja'));
    systemFontsCache = unique;
    return unique;
  };

  if (process.platform === 'win32') {
    return runPowerShell(WIN_JA_FONTS_SCRIPT).then(async (names) => {
      if (names.some((n) => n.trim())) return finish(names);
      return finish(await runPowerShell(WIN_ALL_FONTS_SCRIPT));
    });
  }

  // Linux/macOS (開発環境用): fontconfig で日本語対応フォントのみ
  return new Promise((resolve) => {
    execFile('fc-list', [':lang=ja', 'family'], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(finish([])); return; }
      // "FamilyA,FamilyB" 形式は先頭を採用、エスケープ文字を除去
      resolve(finish(stdout.split(/\r?\n/).map((line) => line.split(',')[0].replace(/\\/g, ''))));
    });
  });
}

/** 既定フォント (LINE Seed JP) が未取得なら起動時にバックグラウンドで自動取得する */
const DEFAULT_WEB_FONT = { family: 'LINE Seed JP', weights: [400, 700, 800] };

async function ensureDefaultWebFont() {
  try {
    const project = graphicsStore.getProject();
    const fonts = (project.assets && project.assets.fonts) || [];
    if (fonts.some((f) => f.family === DEFAULT_WEB_FONT.family)) return;

    const result = await require('./google-fonts').fetchFamily(
      DEFAULT_WEB_FONT.family, DEFAULT_WEB_FONT.weights, graphicsStore.getAssetsDir());

    // 取得中にプロジェクトが更新されている可能性があるため取り直す
    const latest = graphicsStore.getProject();
    latest.assets = latest.assets || { images: [], fonts: [] };
    latest.assets.fonts = latest.assets.fonts || [];
    if (!latest.assets.fonts.some((f) => f.family === result.family)) {
      latest.assets.fonts.push({ family: result.family, cssFile: result.cssFile, files: result.files });
      graphicsStore.setProject(latest);
      graphicsServer.refreshProject();
    }
  } catch (_) {
    // オフライン等で取得できない場合は次回起動時に再試行 (既定テンプレートは游ゴシックへフォールバック)
  }
}

/** 仮想/トンネル系のネットワークアダプタ名 (他PCから届かないIPになりやすい) */
const VIRTUAL_IFACE_RE = /vethernet|hyper-v|vmware|virtualbox|vbox|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap-|tunnel|npcap|pseudo/i;

/**
 * このPCのIPv4アドレス一覧 (インターフェース名つき)。
 * 他PCから届きやすい順 (実アダプタ → 仮想アダプタ → 自動割当 169.254.x.x) に並べる。
 */
function lanInterfaces() {
  const out = [];
  Object.entries(os.networkInterfaces()).forEach(([name, ifaces]) => {
    (ifaces || []).forEach((iface) => {
      if (iface.family !== 'IPv4' || iface.internal) return;
      out.push({
        name,
        address: iface.address,
        netmask: iface.netmask,
        linkLocal: iface.address.startsWith('169.254.'),
        virtual: VIRTUAL_IFACE_RE.test(name),
      });
    });
  });
  const rank = (i) => (i.linkLocal ? 2 : i.virtual ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** LAN内のIPv4アドレス一覧 */
function lanAddresses() {
  return lanInterfaces().map((i) => i.address);
}

function registerIpcHandlers() {
  // --- グラフィックスエンジン初期化 ---
  graphicsStore.init(app.getPath('userData'));
  rundownStore.init(app.getPath('userData'));
  logsDirPath = path.join(app.getPath('userData'), 'logs');
  graphicsServer.configure({
    staticDir: path.join(__dirname, '..', 'output'),
    assetsDir: graphicsStore.getAssetsDir(),
    getProject: graphicsStore.getProject,
    getChannels,
    getGroups: getOutputGroups,
  });
  const graphicsConfig = getGraphicsConfig();
  if (graphicsConfig.autoStart) {
    graphicsServer.start(graphicsConfig.port).catch(() => { /* 状態はgetStatusで通知 */ });
  }
  ensureDefaultWebFont();

  // --- Excel ---
  ipcMain.handle('open-excel-file', async (_event, telopType) => {
    const result = await dialog.showOpenDialog({
      title: 'Excelファイルを選択',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const data = readExcel(result.filePaths[0], telopType);
      return { success: true, data, filePath: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- グラフィックス送出 (ページ = テンプレート + 値 を直接送出) ---
  ipcMain.handle('graphics-take', async (_event, templateKey, values, animate, logDetail) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      const region = templateRegion(templateKey);
      graphicsServer.take(region, templateKey, values || {}, animate !== false);
      appendOnairLog(animate !== false ? 'TAKE' : 'UPDATE', logDetail || `${region} ${templateKey}`);
      return { ok: true, region };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- 静的送出 (電テロ: 静止画/作画をテンプレート非依存で送出) ---
  ipcMain.handle('graphics-take-static', async (_event, payload, animate, logDetail) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      if (!payload || !payload.region) {
        return { ok: false, error: '出力先の系統が指定されていません。' };
      }
      const content = { kind: payload.kind };
      if (payload.kind === 'still') content.still = payload.still;
      else content.variant = payload.variant;
      graphicsServer.takeStatic(payload.region, content, animate !== false);
      appendOnairLog(animate !== false ? 'TAKE' : 'UPDATE', logDetail || `${payload.region} ${payload.kind}`);
      return { ok: true, region: payload.region };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-clear', async (_event, region, logDetail) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      graphicsServer.clear(region);
      appendOnairLog('CLEAR', logDetail || region);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-stop', async (_event, region) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      graphicsServer.stopAnim(region);
      appendOnairLog('STOP', region);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app-version', () => app.getVersion());

  ipcMain.handle('open-onair-logs', async () => {
    fs.mkdirSync(logsDirPath, { recursive: true });
    await shell.openPath(logsDirPath);
    return { ok: true };
  });

  // --- ランダウン (番組>放送>コーナー>ページ) の永続化 ---
  ipcMain.handle('rundown-get', async () => {
    return rundownStore.get();
  });

  ipcMain.handle('rundown-set', async (_event, data) => {
    try {
      rundownStore.set(data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- テンプレート情報 (ページエディタ用) ---
  ipcMain.handle('template-bindings', async (_event, templateKey) => {
    return { bindings: templateBindings(templateKey), region: (() => {
      try { return templateRegion(templateKey); } catch (_) { return null; }
    })() };
  });

  // --- Excel取込 (ページ一括: テンプレートのbinding列順) ---
  ipcMain.handle('excel-import-pages', async (_event, templateKey) => {
    const bindings = templateExcelColumns(templateKey).map((c) => c.binding);
    if (bindings.length === 0) {
      return { success: false, error: 'このテンプレートにはExcelの列として使う文字フィールドがありません。' };
    }
    const result = await dialog.showOpenDialog({
      title: 'Excelファイルを選択',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const workbook = XLSX.readFile(result.filePaths[0]);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ''));
      const pages = dataRows.map((row) => {
        const values = {};
        bindings.forEach((b, i) => { values[b] = String(row[i] !== undefined ? row[i] : ''); });
        return values;
      });
      return { success: true, pages, filePath: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Excel取込 (氏名テロップ一括: 「テンプレ」列の値から行ごとに使用テンプレートを自動判定) ---
  ipcMain.handle('excel-import-name-pages', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Excelファイルを選択 (氏名テロップ一括取込)',
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const workbook = XLSX.readFile(result.filePaths[0]);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      const dataRows = rows.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== ''));
      const { pages, skipped } = buildNameBatchPages(dataRows);
      return { success: true, pages, skipped, filePath: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Excelテンプレ書き出し (氏名テロップ一括: テンプレ列 + 1st〜4th分の列を1ファイルにまとめる) ---
  ipcMain.handle('download-name-batch-template', async () => {
    const shotTypes = nameShotTypes();
    if (shotTypes.length === 0) {
      return { success: false, error: '氏名テロップ系のテンプレートが見つかりません。' };
    }
    const header = [`テンプレ [${shotTypes.join('/')}]`];
    NAME_BATCH_LABELS.forEach((label) => {
      header.push(`${label}肩書(JP)`, `${label}名前(JP)`, `${label}肩書(EN)`, `${label}名前(EN)`);
    });
    const wsData = [header];
    shotTypes.forEach((shotType) => {
      const templateKey = `name-${shotType}`;
      const fieldSamples = {};
      templateFields(templateKey).forEach((f) => { fieldSamples[f.binding] = f.sample; });
      const row = [shotType];
      NAME_BATCH_PREFIXES.forEach((prefix) => {
        row.push(
          fieldSamples[nameBinding(prefix, 'Title', 'Jp')] || '',
          fieldSamples[nameBinding(prefix, 'Name', 'Jp')] || '',
          fieldSamples[nameBinding(prefix, 'Title', 'En')] || '',
          fieldSamples[nameBinding(prefix, 'Name', 'En')] || '',
        );
      });
      wsData.push(row);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = header.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    const saveResult = await dialog.showSaveDialog({
      title: 'テンプレートを保存',
      defaultPath: 'name-telop-batch-template.xlsx',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (saveResult.canceled || !saveResult.filePath) return { success: false };
    try {
      XLSX.writeFile(wb, saveResult.filePath);
      return { success: true, filePath: saveResult.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- 出力サーバ管理 ---
  ipcMain.handle('graphics-server-start', async (_event, port) => {
    try {
      const p = Math.max(1, Math.min(65535, parseInt(port, 10) || 8790));
      await graphicsServer.start(p);
      return { ok: true, status: graphicsServer.getStatus() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-server-stop', async () => {
    graphicsServer.stop();
    return { ok: true };
  });

  ipcMain.handle('graphics-server-status', async () => {
    return { ...graphicsServer.getStatus(), lanAddresses: lanAddresses(), lanInterfaces: lanInterfaces() };
  });

  // --- デザインエディタ ---
  ipcMain.handle('graphics-get-project', async () => {
    return graphicsStore.getProject();
  });

  ipcMain.handle('graphics-save-project', async (_event, project) => {
    try {
      if (!project || !project.templates) {
        return { ok: false, error: 'プロジェクトデータが不正です。' };
      }
      graphicsStore.setProject(project);
      graphicsServer.refreshProject();
      designSync.schedulePush(); // クライアント: 保存したデザインをホストへ反映
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // source 無し → OSダイアログ / 文字列 → そのパスをコピー / {name,data} → バッファを書き出し
  //   (ドラッグ&ドロップ取込では file.path 文字列またはバイト列が渡される)
  ipcMain.handle('graphics-import-asset', async (_event, source) => {
    try {
      const assetsDir = graphicsStore.getAssetsDir();
      // バイト列で受け取った場合 (file.path が使えない環境のフォールバック)
      if (source && typeof source === 'object' && source.data) {
        const safe = path.basename(source.name || 'image').replace(/[\\/:*?"<>|\s]/g, '_') || 'image';
        const file = `${Date.now()}_${safe}`;
        fs.writeFileSync(path.join(assetsDir, file), Buffer.from(source.data));
        return { ok: true, file };
      }
      let src = typeof source === 'string' && source ? source : null;
      if (!src) {
        const result = await dialog.showOpenDialog({
          title: '画像を選択',
          filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
          properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        src = result.filePaths[0];
      }
      const safe = path.basename(src).replace(/[\\/:*?"<>|\s]/g, '_');
      const file = `${Date.now()}_${safe}`;
      fs.copyFileSync(src, path.join(assetsDir, file));
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('system-fonts', async () => {
    return listSystemFonts();
  });

  // --- デザインセット管理 ---
  ipcMain.handle('graphics-list-sets', async () => {
    return graphicsStore.listSets();
  });

  ipcMain.handle('graphics-create-set', async (_event, name, fromCurrent) => {
    try {
      const id = graphicsStore.createSet(String(name || '').trim() || '新しいデザイン', !!fromCurrent);
      graphicsServer.refreshProject();
      designSync.schedulePush();
      return { ok: true, id, ...graphicsStore.listSets() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-switch-set', async (_event, id) => {
    try {
      graphicsStore.switchSet(id);
      graphicsServer.refreshProject();
      designSync.schedulePush();
      return { ok: true, ...graphicsStore.listSets() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-rename-set', async (_event, id, name) => {
    try {
      graphicsStore.renameSet(id, String(name || '').trim() || '新しいデザイン');
      return { ok: true, ...graphicsStore.listSets() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-delete-set', async (_event, id) => {
    try {
      graphicsStore.deleteSet(id);
      return { ok: true, ...graphicsStore.listSets() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-save-set-thumb', async (_event, dataUrl) => {
    try {
      return { ok: graphicsStore.saveSetThumb(dataUrl) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-set-thumbs', async () => {
    try {
      return graphicsStore.getSetThumbs();
    } catch (_) {
      return {};
    }
  });

  // --- スタイルパレット (全セット共通) ---
  ipcMain.handle('graphics-style-presets', async () => {
    return graphicsStore.listStylePresets();
  });

  ipcMain.handle('graphics-style-preset-add', async (_event, name, style) => {
    try {
      return { ok: true, preset: graphicsStore.addStylePreset(name, style) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-style-preset-delete', async (_event, id) => {
    try {
      return { ok: true, presets: graphicsStore.deleteStylePreset(id) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- バックアップ / PNG書き出し ---
  ipcMain.handle('graphics-open-backups', async () => {
    await shell.openPath(graphicsStore.getBackupsDir());
    return { ok: true };
  });

  ipcMain.handle('graphics-export-png', async (_event, dataUrl, suggestedName) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
    if (!m) return { ok: false, error: '画像データが不正です。' };
    const result = await dialog.showSaveDialog({
      title: 'PNGとして保存',
      defaultPath: String(suggestedName || 'telop.png').replace(/[\\/:*?"<>|]/g, '_'),
      filters: [{ name: 'PNG画像', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      fs.writeFileSync(result.filePath, Buffer.from(m[1], 'base64'));
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-fetch-gfont', async (_event, family, weights) => {
    try {
      const result = await googleFonts.fetchFamily(family, weights, graphicsStore.getAssetsDir());
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-import-font', async () => {
    const result = await dialog.showOpenDialog({
      title: 'フォントファイルを選択',
      filters: [{ name: 'フォント', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const src = result.filePaths[0];
      const base = path.basename(src);
      const safe = base.replace(/[\\/:*?"<>|\s]/g, '_');
      const file = `${Date.now()}_${safe}`;
      fs.copyFileSync(src, path.join(graphicsStore.getAssetsDir(), file));
      // ファミリー名の初期値は拡張子を除いたファイル名
      const family = base.replace(/\.(ttf|otf|woff2?|TTF|OTF)$/, '');
      return { ok: true, file, family };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- デザイン一式のエクスポート/インポート (テンプレート+素材をJSONに同梱) ---
  ipcMain.handle('graphics-export-design', async () => {
    const result = await dialog.showSaveDialog({
      title: 'デザインをエクスポート',
      defaultPath: 'telop-design.tgdesign',
      filters: [{ name: 'Telop Design', extensions: ['tgdesign'] }],
    });
    if (result.canceled || !result.filePath) return null;
    try {
      const project = graphicsStore.getProject();
      const files = {};
      graphicsStore.referencedAssetFiles(project).forEach((file) => {
        const p = path.join(graphicsStore.getAssetsDir(), path.basename(file));
        if (fs.existsSync(p)) files[file] = fs.readFileSync(p).toString('base64');
      });
      const data = { format: 'gmo-telopgo-design', version: 1, exportedAt: new Date().toISOString(), project, files };
      fs.writeFileSync(result.filePath, JSON.stringify(data), 'utf-8');
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-import-design', async () => {
    const result = await dialog.showOpenDialog({
      title: 'デザインをインポート',
      filters: [{ name: 'Telop Design', extensions: ['tgdesign', 'json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
      if (data.format !== 'gmo-telopgo-design' || !data.project || !data.project.templates) {
        return { ok: false, error: 'デザインファイルの形式が不正です。' };
      }
      Object.entries(data.files || {}).forEach(([file, base64]) => {
        fs.writeFileSync(path.join(graphicsStore.getAssetsDir(), path.basename(file)), Buffer.from(base64, 'base64'));
      });
      graphicsStore.setProject(data.project);
      graphicsServer.refreshProject();
      designSync.schedulePush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-open-project-file', async () => {
    await shell.openPath(graphicsStore.getProjectPath());
    return { ok: true, path: graphicsStore.getProjectPath() };
  });

  ipcMain.handle('graphics-reload-project', async () => {
    try {
      graphicsStore.reload();
      graphicsServer.refreshProject();
      designSync.schedulePush();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- Settings ---
  ipcMain.handle('get-settings', async () => {
    return getSettings();
  });

  ipcMain.handle('save-settings', async (_event, settings) => {
    saveSettings(settings);
    // チャンネル/出力グループの変更を出力ページへ即時反映
    if (graphicsServer.isRunning() && (settings.channels || settings.outputGroups)) {
      graphicsServer.refreshProject();
    }
    designSync.schedulePush(); // クライアント: 系統・出力グループ等の設定をホストへ反映
    return { success: true };
  });

  // --- Project Save/Load ---
  ipcMain.handle('save-project', async () => {
    const result = await dialog.showSaveDialog({
      title: 'ランダウンを書き出し',
      defaultPath: 'telop-rundown.json',
      filters: [{ name: 'Telop Rundown/Project', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const data = {
        version: 3,
        savedAt: new Date().toISOString(),
        settings: getSettings(),
        rundown: rundownStore.get(),
      };
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('load-project', async () => {
    const result = await dialog.showOpenDialog({
      title: 'ランダウンを読込 (旧プロジェクト形式も自動変換)',
      filters: [{ name: 'Telop Rundown/Project', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);

      let rundown;
      if (data.version === 3 && data.rundown) {
        rundown = data.rundown;
      } else if (data.version === 1 || data.version === 2 || data.nameData || data.sideData) {
        // 旧形式 (name/side行データ) → ランダウンへ自動移行
        if (data.version === 1 && data.nameData) {
          data.nameData = data.nameData.map((item) => ({
            shotType: '1S',
            persons: [{ titleJp: item.titleJp || '', nameJp: item.nameJp || '', titleEn: item.titleEn || '', nameEn: item.nameEn || '' }],
          }));
        }
        rundown = rundownStore.migrateLegacy(data);
      } else {
        return { success: false, error: 'サポートされていないプロジェクトバージョンです。' };
      }

      rundownStore.set(rundown);
      if (data.settings) {
        saveSettings(data.settings);
      }
      return { success: true, rundown, migrated: data.version !== 3 };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- Template Download ---
  ipcMain.handle('download-template', async (_event, telopType) => {
    const wb = XLSX.utils.book_new();
    let wsData;
    let defaultFilename;

    if (telopType === 'name') {
      wsData = [
        ['肩書(JP)', '名前(JP)', '肩書(EN)', '名前(EN)'],
        ['代表取締役', '見本 太郎', 'CEO', 'Taro Mihon'],
      ];
      defaultFilename = 'name-telop-template.xlsx';
    } else if (telopType === 'side' && !(graphicsStore.getProject() || {}).templates?.side) {
      // テンプレート 'side' が存在しない場合のみ旧固定列。存在すればデザインの変数 (binding) に従う
      wsData = [
        ['テキスト(JP)', 'テキスト(EN)'],
        ['サンプルテキスト', 'Sample text'],
      ];
      defaultFilename = 'side-telop-template.xlsx';
    } else {
      // 任意テンプレート: 列 = 文字フィールド (取込と同じ列順)。
      // 1行目 = 見出し (レイヤー名 [フィールド名])、2行目 = 見本 (デザインのサンプル文字)
      const fields = templateExcelColumns(telopType);
      if (fields.length === 0) return { success: false, error: 'テンプレートにExcelの列として使う文字フィールドがありません。' };
      wsData = [
        // 見出しは設定した列名を優先 (未設定ならレイヤー名 [変数名])
        fields.map((f) => f.header || (f.label && f.label !== f.binding ? `${f.label} [${f.binding}]` : f.binding)),
        fields.map((f) => f.sample || ''),
      ];
      const project = graphicsStore.getProject();
      const tpl = project && project.templates && project.templates[telopType];
      const base = (tpl && tpl.label) || telopType;
      defaultFilename = `${String(base).replace(/[\\/:*?"<>|]/g, '_')}_Excelテンプレ.xlsx`;
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = wsData[0].map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    const result = await dialog.showSaveDialog({
      title: 'テンプレートを保存',
      defaultPath: defaultFilename,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });

    if (result.canceled || !result.filePath) return { success: false };

    try {
      XLSX.writeFile(wb, result.filePath);
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // --- GPIOリモートボタン (CONTEC DIO) ---
  ipcMain.handle('gpio-connect', async (_event, options) => {
    const cfg = getGpioConfig();
    try {
      gpioDio.connect({
        deviceName: (options && options.deviceName) || cfg.deviceName,
        pressLevel: (options && options.pressLevel) || cfg.pressLevel,
      });
      return { ok: true, status: gpioDio.getStatus() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('gpio-disconnect', async () => {
    gpioDio.disconnect();
    return { ok: true };
  });

  ipcMain.handle('gpio-status', async () => {
    return gpioDio.getStatus();
  });

  ipcMain.handle('gpio-list-devices', async () => {
    try {
      return { ok: true, devices: gpioDio.listDevices() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // DIO/リンク/出力サーバのイベントを全ウィンドウへ転送
  const broadcastToWindows = (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    });
  };

  // --- ライブデータ連携 (CSV/Excel監視 → 送出中テロップへ自動反映) ---
  ipcMain.handle('live-data-choose-file', async () => {
    const result = await dialog.showOpenDialog({
      title: '監視するCSV/Excelファイルを選択',
      filters: [{ name: 'CSV / Excel', extensions: ['csv', 'xlsx', 'xlsm', 'xls'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { ok: true, file: result.filePaths[0] };
  });

  ipcMain.handle('live-data-start', async (_event, cfg) => {
    try {
      const st = liveData.start(cfg, (values) => {
        // 対象リージョンが送出中なら即CHANGEで差し替える (アニメなし)
        const state = graphicsServer.getStatus().state[cfg.region];
        if (state && state.onAir && (!cfg.templateKey || state.templateKey === cfg.templateKey)) {
          graphicsServer.change(cfg.region, state.templateKey, Object.assign({}, state.values, values));
        }
        broadcastToWindows('live-data-update', liveData.getStatus());
      });
      broadcastToWindows('live-data-update', st);
      return { ok: true, ...st };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('live-data-stop', async () => {
    const st = liveData.stop();
    broadcastToWindows('live-data-update', st);
    return { ok: true, ...st };
  });

  ipcMain.handle('live-data-status', async () => {
    return liveData.getStatus();
  });
  gpioDio.events.on('button', (bit) => broadcastToWindows('gpio-button', bit));
  gpioDio.events.on('state', (state) => broadcastToWindows('gpio-state', state));
  gpioDio.events.on('error', (message) => broadcastToWindows('gpio-error', message));
  graphicsServer.events.on('status', () => broadcastToWindows('graphics-status-changed', graphicsServer.getStatus()));

  // --- デザイン・設定の同期 (クライアント → ホスト。ホストのデザインの取り込みは手動) ---
  designSync.init({ remoteLink, graphicsStore, graphicsServer, settingsStore: { getSettings, saveSettings }, notify: broadcastToWindows });
  ipcMain.handle('design-sync-push', async () => designSync.push(true));
  ipcMain.handle('design-sync-pull', async () => designSync.pull());

  // --- リモート連携 (2台運用) ---
  ipcMain.handle('remote-start', async (_event, options) => {
    try {
      const port = Math.max(1, Math.min(65535, parseInt(options.port, 10) || 8765));
      if (options.mode === 'host') {
        remoteLink.startHost(port);
      } else if (options.mode === 'client') {
        if (!options.hostAddress) {
          return { ok: false, error: '接続先ホストのIPアドレスを入力してください。' };
        }
        remoteLink.connectClient(options.hostAddress, port);
      } else {
        remoteLink.stop();
      }
      return { ok: true, status: remoteLink.getStatus() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('remote-stop', async () => {
    remoteLink.stop();
    return { ok: true };
  });

  ipcMain.handle('remote-status', async () => {
    return remoteLink.getStatus();
  });

  ipcMain.handle('remote-send', async (_event, message) => {
    return { sent: remoteLink.send(message) };
  });

  remoteLink.events.on('message', (msg) => broadcastToWindows('remote-message', msg));
  remoteLink.events.on('status', (status) => broadcastToWindows('remote-status-changed', status));
}

module.exports = { registerIpcHandlers };
