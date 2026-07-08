const { ipcMain, dialog, BrowserWindow, app, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
const { readExcel } = require('./excel-reader');
const gpioDio = require('./gpio-dio');
const remoteLink = require('./remote-link');
const graphicsStore = require('./graphics-store');
const graphicsServer = require('./graphics-server');
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
