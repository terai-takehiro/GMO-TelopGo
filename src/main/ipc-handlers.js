const { ipcMain, dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const XLSX = require('xlsx');
const { readExcel } = require('./excel-reader');
const singularApi = require('./singular-api');
const gpioDio = require('./gpio-dio');
const remoteLink = require('./remote-link');
const { getSettings, saveSettings, getTelopConfig, getNameShotConfig, getGpioConfig } = require('./settings-store');

/** ショットタイプのフィールドプレフィックス */
const PERSON_PREFIXES = ['', '2nd', '3rd', '4th'];

function registerIpcHandlers() {
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

  // --- Singular API ---
  ipcMain.handle('singular-change', async (_event, telopType, rowData) => {
    if (telopType === 'name') {
      return handleNameChange(rowData);
    }
    // side telop
    const config = getTelopConfig('side');
    if (!config.appToken || !config.subCompositionName) {
      return { ok: false, error: '設定が未入力です。設定タブでApp TokenとSub-Composition名を入力してください。' };
    }
    const fieldData = {};
    if (rowData.textJp !== undefined) fieldData[config.fields.textJp] = rowData.textJp;
    if (rowData.textEn !== undefined) fieldData[config.fields.textEn] = rowData.textEn;
    try {
      return await singularApi.change(config.appToken, config.subCompositionName, fieldData);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('singular-take', async (_event, telopType, shotType) => {
    if (telopType === 'name') {
      const config = getNameShotConfig(shotType);
      if (!config.appToken || !config.subCompositionName) {
        return { ok: false, error: `${shotType}の設定が未入力です。` };
      }
      try {
        return await singularApi.take(config.appToken, config.subCompositionName);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    // side telop
    const config = getTelopConfig('side');
    if (!config.appToken || !config.subCompositionName) {
      return { ok: false, error: '設定が未入力です。' };
    }
    try {
      return await singularApi.take(config.appToken, config.subCompositionName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('singular-clear', async (_event, telopType, shotType) => {
    if (telopType === 'name') {
      const config = getNameShotConfig(shotType);
      if (!config.appToken || !config.subCompositionName) {
        return { ok: false, error: `${shotType}の設定が未入力です。` };
      }
      try {
        return await singularApi.clear(config.appToken, config.subCompositionName);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }
    // side telop
    const config = getTelopConfig('side');
    if (!config.appToken || !config.subCompositionName) {
      return { ok: false, error: '設定が未入力です。' };
    }
    try {
      return await singularApi.clear(config.appToken, config.subCompositionName);
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('singular-test-connection', async (_event, telopType) => {
    const config = telopType === 'name' ? getTelopConfig('name') : getTelopConfig('side');
    if (!config.appToken) {
      return { ok: false, error: 'App Tokenが未入力です。' };
    }
    try {
      return await singularApi.testConnection(config.appToken);
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

  // DIOイベントを全ウィンドウへ転送
  const broadcastToWindows = (channel, payload) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    });
  };
  gpioDio.events.on('button', (bit) => broadcastToWindows('gpio-button', bit));
  gpioDio.events.on('state', (state) => broadcastToWindows('gpio-state', state));
  gpioDio.events.on('error', (message) => broadcastToWindows('gpio-error', message));

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
}

/** 名前テロップ CHANGE処理 */
function handleNameChange(rowData) {
  const shotType = rowData.shotType;
  const persons = rowData.persons;
  if (!shotType || !persons) {
    return { ok: false, error: 'ショットタイプまたは出演者データが不正です。' };
  }

  const config = getNameShotConfig(shotType);
  if (!config.appToken || !config.subCompositionName) {
    return { ok: false, error: `${shotType}の設定が未入力です。設定タブで設定してください。` };
  }

  const fieldData = {};
  const fields = config.fields;

  persons.forEach((person, i) => {
    const prefix = PERSON_PREFIXES[i];
    if (shotType === 'nameOnly' && i === 0) {
      // 名前のみ: titleフィールドなし
      if (fields.nameJp) fieldData[fields.nameJp] = person.nameJp || '';
      if (fields.nameEn) fieldData[fields.nameEn] = person.nameEn || '';
    } else {
      const tJp = prefix ? `${prefix}TitleJp` : 'titleJp';
      const nJp = prefix ? `${prefix}NameJp` : 'nameJp';
      const tEn = prefix ? `${prefix}TitleEn` : 'titleEn';
      const nEn = prefix ? `${prefix}NameEn` : 'nameEn';
      if (fields[tJp]) fieldData[fields[tJp]] = person.titleJp || '';
      if (fields[nJp]) fieldData[fields[nJp]] = person.nameJp || '';
      if (fields[tEn]) fieldData[fields[tEn]] = person.titleEn || '';
      if (fields[nEn]) fieldData[fields[nEn]] = person.nameEn || '';
    }
  });

  try {
    return singularApi.change(config.appToken, config.subCompositionName, fieldData);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { registerIpcHandlers };
