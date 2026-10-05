const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipc-handlers');
const gpioDio = require('./src/main/gpio-dio');
const remoteLink = require('./src/main/remote-link');
const graphicsServer = require('./src/main/graphics-server');

// GPU 設定は Chromium 既定に任せる。
// 以前の enable-zero-copy / ignore-gpu-blocklist / enable-gpu-rasterization は、
// 一部の Windows GPU でタブ切替時に前画面が残像のように重なって残る不具合の原因になるため外した。
// 描画で問題が出る環境では、起動引数 --disable-gpu で GPU を無効化して切り分けられる。

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#f0f4f8',
    // タスクバー/ウィンドウのアイコン (Windows は複数サイズ入りの .ico)
    icon: path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.maximize(); // 運用は全画面(最大化)が基本
}

// Windows: インストーラのショートカットと同じ AppUserModelID にして、
// タスクバーでアプリのアイコン・グループ化が正しく効くようにする
if (process.platform === 'win32') app.setAppUserModelId('com.gmo.telopgo');

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  gpioDio.disconnect();
  remoteLink.stop();
  graphicsServer.stop();
});
