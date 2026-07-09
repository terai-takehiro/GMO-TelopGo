const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { readExcel } = require('./excel-reader');
const gpioDio = require('./gpio-dio');
const remoteLink = require('./remote-link');
const graphicsStore = require('./graphics-store');
const graphicsServer = require('./graphics-server');
const googleFonts = require('./google-fonts');
const { getSettings, saveSettings, getGpioConfig, getGraphicsConfig } = require('./settings-store');

/** ショットタイプのフィールドプレフィックス */
const PERSON_PREFIXES = ['', '2nd', '3rd', '4th'];

/** 名前テロップの行データをテンプレートのバインド値へ変換 */
function nameValues(rowData) {
  const values = {};
  (rowData.persons || []).forEach((person, i) => {
    const prefix = PERSON_PREFIXES[i];
    values[prefix ? `${prefix}TitleJp` : 'titleJp'] = person.titleJp || '';
    values[prefix ? `${prefix}NameJp` : 'nameJp'] = person.nameJp || '';
    values[prefix ? `${prefix}TitleEn` : 'titleEn'] = person.titleEn || '';
    values[prefix ? `${prefix}NameEn` : 'nameEn'] = person.nameEn || '';
  });
  return values;
}

/** 送出データを (region, templateKey, values) に解決する */
function resolveGraphics(telopType, rowData) {
  if (telopType === 'name') {
    if (!rowData || !rowData.shotType || !rowData.persons) {
      throw new Error('ショットタイプまたは出演者データが不正です。');
    }
    return { region: 'name', templateKey: `name-${rowData.shotType}`, values: nameValues(rowData) };
  }
  return {
    region: 'side',
    templateKey: 'side',
    values: { textJp: (rowData && rowData.textJp) || '', textEn: (rowData && rowData.textEn) || '' },
  };
}

/** インストール済みフォントのファミリー名一覧 (初回のみ取得しキャッシュ) */
let systemFontsCache = null;

function listSystemFonts() {
  if (systemFontsCache) return Promise.resolve(systemFontsCache);

  return new Promise((resolve) => {
    const finish = (names) => {
      const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
      systemFontsCache = unique;
      resolve(unique);
    };

    if (process.platform === 'win32') {
      // System.Drawing でインストール済みフォントファミリーを列挙 (追加依存なし)
      const script = '[void][Reflection.Assembly]::LoadWithPartialName("System.Drawing");'
        + '(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
        { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          finish(err ? [] : stdout.split(/\r?\n/));
        });
      return;
    }

    // Linux/macOS (開発環境用): fontconfig があれば使用
    execFile('fc-list', [':', 'family'], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        finish([]);
        return;
      }
      // "FamilyA,FamilyB" 形式は先頭を採用、エスケープ文字を除去
      finish(stdout.split(/\r?\n/).map((line) => line.split(',')[0].replace(/\\/g, '')));
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

/** LAN内のIPv4アドレス一覧 */
function lanAddresses() {
  const addrs = [];
  Object.values(os.networkInterfaces()).forEach((ifaces) => {
    (ifaces || []).forEach((iface) => {
      if (iface.family === 'IPv4' && !iface.internal) addrs.push(iface.address);
    });
  });
  return addrs;
}

function registerIpcHandlers() {
  // --- グラフィックスエンジン初期化 ---
  graphicsStore.init(app.getPath('userData'));
  graphicsServer.configure({
    staticDir: path.join(__dirname, '..', 'output'),
    assetsDir: graphicsStore.getAssetsDir(),
    getProject: graphicsStore.getProject,
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

  // --- グラフィックス送出 (CHANGE / TAKE / CLEAR) ---
  ipcMain.handle('graphics-take', async (_event, telopType, rowData) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      const { region, templateKey, values } = resolveGraphics(telopType, rowData);
      graphicsServer.take(region, templateKey, values, true);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-change', async (_event, telopType, rowData) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      const { region, templateKey, values } = resolveGraphics(telopType, rowData);
      graphicsServer.change(region, templateKey, values);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-clear', async (_event, telopType) => {
    try {
      if (!graphicsServer.isRunning()) {
        return { ok: false, error: '出力サーバが停止しています。設定タブで起動してください。' };
      }
      graphicsServer.clear(telopType === 'name' ? 'name' : 'side');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
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
    return { ...graphicsServer.getStatus(), lanAddresses: lanAddresses() };
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
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('graphics-import-asset', async () => {
    const result = await dialog.showOpenDialog({
      title: '画像を選択',
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const src = result.filePaths[0];
      const safe = path.basename(src).replace(/[\\/:*?"<>|\s]/g, '_');
      const file = `${Date.now()}_${safe}`;
      fs.copyFileSync(src, path.join(graphicsStore.getAssetsDir(), file));
      return { ok: true, file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('system-fonts', async () => {
    return listSystemFonts();
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
    return { success: true };
  });

  // --- Project Save/Load ---
  ipcMain.handle('save-project', async (_event, projectData) => {
    const result = await dialog.showSaveDialog({
      title: 'プロジェクトを保存',
      defaultPath: 'telop-project.json',
      filters: [{ name: 'Telop Project', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { success: false };
    try {
      const data = {
        version: 2,
        savedAt: new Date().toISOString(),
        settings: getSettings(),
        ...projectData,
      };
      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('load-project', async () => {
    const result = await dialog.showOpenDialog({
      title: 'プロジェクトを読込',
      filters: [{ name: 'Telop Project', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const data = JSON.parse(raw);

      // v1 → v2 マイグレーション
      if (data.version === 1) {
        if (data.nameData) {
          data.nameData = data.nameData.map(item => ({
            shotType: '1S',
            persons: [{ titleJp: item.titleJp || '', nameJp: item.nameJp || '', titleEn: item.titleEn || '', nameEn: item.nameEn || '' }],
          }));
        }
        if (!data.namePool) data.namePool = [];
        data.version = 2;
      }

      if (data.version !== 2) {
        return { success: false, error: 'サポートされていないプロジェクトバージョンです。' };
      }
      if (data.settings) {
        saveSettings(data.settings);
      }
      return { success: true, data };
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
        ['代表取締役', '山田太郎', 'CEO', 'Taro Yamada'],
      ];
      defaultFilename = 'name-telop-template.xlsx';
    } else {
      wsData = [
        ['テキスト(JP)', 'テキスト(EN)'],
        ['サンプルテキスト', 'Sample text'],
      ];
      defaultFilename = 'side-telop-template.xlsx';
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
  gpioDio.events.on('button', (bit) => broadcastToWindows('gpio-button', bit));
  gpioDio.events.on('state', (state) => broadcastToWindows('gpio-state', state));
  gpioDio.events.on('error', (message) => broadcastToWindows('gpio-error', message));
  graphicsServer.events.on('status', () => broadcastToWindows('graphics-status-changed', graphicsServer.getStatus()));

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
