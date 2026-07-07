const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Excel
  openExcelFile: (telopType) => ipcRenderer.invoke('open-excel-file', telopType),

  // Singular API
  singularChange: (telopType, data) => ipcRenderer.invoke('singular-change', telopType, data),
  singularTake: (telopType, shotType) => ipcRenderer.invoke('singular-take', telopType, shotType),
  singularClear: (telopType, shotType) => ipcRenderer.invoke('singular-clear', telopType, shotType),
  singularTestConnection: (telopType) => ipcRenderer.invoke('singular-test-connection', telopType),

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
});
