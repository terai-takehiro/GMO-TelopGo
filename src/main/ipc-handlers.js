const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const { readExcel } = require('./excel-reader');
const singularApi = require('./singular-api');
const { getSettings, saveSettings, getTelopConfig, getNameShotConfig } = require('./settings-store');

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
