const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Excel
  openExcelFile: (telopType) => ipcRenderer.invoke('open-excel-file', telopType),

  // グラフィックス送出 (ページ = テンプレート + 値)
  graphicsTake: (templateKey, values, animate, logDetail) => ipcRenderer.invoke('graphics-take', templateKey, values, animate, logDetail),
  // 静的送出 (電テロ: 静止画/作画をテンプレート非依存で送出) payload={region, kind, still?|variant?}
  graphicsTakeStatic: (payload, animate, logDetail) => ipcRenderer.invoke('graphics-take-static', payload, animate, logDetail),
  graphicsClear: (region, logDetail) => ipcRenderer.invoke('graphics-clear', region, logDetail),
  graphicsStop: (region) => ipcRenderer.invoke('graphics-stop', region),
  openOnairLogs: () => ipcRenderer.invoke('open-onair-logs'),

  // ランダウン (番組>放送>コーナー>ページ)
  rundownGet: () => ipcRenderer.invoke('rundown-get'),
  rundownSet: (data) => ipcRenderer.invoke('rundown-set', data),
  templateBindings: (templateKey) => ipcRenderer.invoke('template-bindings', templateKey),
  excelImportPages: (templateKey) => ipcRenderer.invoke('excel-import-pages', templateKey),
  // 氏名テロップ一括 (「テンプレ」列の値から行ごとに使用テンプレートを自動判定)
  excelImportNamePages: () => ipcRenderer.invoke('excel-import-name-pages'),
  downloadNameBatchTemplate: () => ipcRenderer.invoke('download-name-batch-template'),

  // 出力サーバ管理
  graphicsServerStart: (port) => ipcRenderer.invoke('graphics-server-start', port),
  graphicsServerStop: () => ipcRenderer.invoke('graphics-server-stop'),
  graphicsServerStatus: () => ipcRenderer.invoke('graphics-server-status'),
  graphicsOpenProjectFile: () => ipcRenderer.invoke('graphics-open-project-file'),
  graphicsReloadProject: () => ipcRenderer.invoke('graphics-reload-project'),
  graphicsListSets: () => ipcRenderer.invoke('graphics-list-sets'),
  graphicsCreateSet: (name, fromCurrent) => ipcRenderer.invoke('graphics-create-set', name, fromCurrent),
  graphicsSwitchSet: (id) => ipcRenderer.invoke('graphics-switch-set', id),
  graphicsRenameSet: (id, name) => ipcRenderer.invoke('graphics-rename-set', id, name),
  graphicsDeleteSet: (id) => ipcRenderer.invoke('graphics-delete-set', id),
  graphicsSaveSetThumb: (dataUrl) => ipcRenderer.invoke('graphics-save-set-thumb', dataUrl),
  graphicsGetSetThumbs: () => ipcRenderer.invoke('graphics-set-thumbs'),
  graphicsStylePresets: () => ipcRenderer.invoke('graphics-style-presets'),
  graphicsStylePresetAdd: (name, style) => ipcRenderer.invoke('graphics-style-preset-add', name, style),
  graphicsStylePresetDelete: (id) => ipcRenderer.invoke('graphics-style-preset-delete', id),
  graphicsOpenBackups: () => ipcRenderer.invoke('graphics-open-backups'),
  graphicsExportPng: (dataUrl, suggestedName) => ipcRenderer.invoke('graphics-export-png', dataUrl, suggestedName),
  graphicsGetProject: () => ipcRenderer.invoke('graphics-get-project'),
  graphicsSaveProject: (project) => ipcRenderer.invoke('graphics-save-project', project),
  graphicsImportAsset: (source) => ipcRenderer.invoke('graphics-import-asset', source),
  graphicsImportFont: () => ipcRenderer.invoke('graphics-import-font'),
  graphicsFetchGoogleFont: (family, weights) => ipcRenderer.invoke('graphics-fetch-gfont', family, weights),
  getSystemFonts: () => ipcRenderer.invoke('system-fonts'),
  graphicsExportDesign: () => ipcRenderer.invoke('graphics-export-design'),
  graphicsImportDesign: () => ipcRenderer.invoke('graphics-import-design'),
  onGraphicsStatus: (callback) => ipcRenderer.on('graphics-status-changed', (_event, status) => callback(status)),

  // ライブデータ連携 (CSV/Excel監視)
  liveDataChooseFile: () => ipcRenderer.invoke('live-data-choose-file'),
  liveDataStart: (cfg) => ipcRenderer.invoke('live-data-start', cfg),
  liveDataStop: () => ipcRenderer.invoke('live-data-stop'),
  liveDataStatus: () => ipcRenderer.invoke('live-data-status'),
  onLiveDataUpdate: (callback) => ipcRenderer.on('live-data-update', (_event, status) => callback(status)),

  // アプリ情報
  getAppVersion: () => ipcRenderer.invoke('app-version'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Project save/load
  saveProject: (projectData) => ipcRenderer.invoke('save-project', projectData),
  loadProject: () => ipcRenderer.invoke('load-project'),

  // Template download
  downloadTemplate: (telopType) => ipcRenderer.invoke('download-template', telopType),

  // GPIOリモートボタン (CONTEC DIO)
  gpioConnect: (options) => ipcRenderer.invoke('gpio-connect', options),
  gpioDisconnect: () => ipcRenderer.invoke('gpio-disconnect'),
  gpioStatus: () => ipcRenderer.invoke('gpio-status'),
  gpioListDevices: () => ipcRenderer.invoke('gpio-list-devices'),
  onGpioButton: (callback) => ipcRenderer.on('gpio-button', (_event, bit) => callback(bit)),
  onGpioState: (callback) => ipcRenderer.on('gpio-state', (_event, state) => callback(state)),
  onGpioError: (callback) => ipcRenderer.on('gpio-error', (_event, message) => callback(message)),

  // リモート連携 (2台運用)
  remoteStart: (options) => ipcRenderer.invoke('remote-start', options),
  remoteStop: () => ipcRenderer.invoke('remote-stop'),
  remoteStatus: () => ipcRenderer.invoke('remote-status'),
  remoteSend: (message) => ipcRenderer.invoke('remote-send', message),
  onRemoteMessage: (callback) => ipcRenderer.on('remote-message', (_event, msg) => callback(msg)),
  onRemoteStatus: (callback) => ipcRenderer.on('remote-status-changed', (_event, status) => callback(status)),

  // デザイン・設定の同期 (クライアント → ホスト / ホストから取り込み)
  designSyncPush: () => ipcRenderer.invoke('design-sync-push'),
  designSyncPull: () => ipcRenderer.invoke('design-sync-pull'),
  onDesignSynced: (callback) => ipcRenderer.on('design-synced', (_event, info) => callback(info)),
  onDesignSyncStatus: (callback) => ipcRenderer.on('design-sync-status', (_event, info) => callback(info)),
  onAssetsSynced: (callback) => ipcRenderer.on('assets-synced', (_event, info) => callback(info)),
});
