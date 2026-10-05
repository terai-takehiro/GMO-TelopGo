const { app, BrowserWindow } = require('electron');
const path = require('path');
const { registerIpcHandlers } = require('./src/main/ipc-handlers');
const gpioDio = require('./src/main/gpio-dio');
const remoteLink = require('./src/main/remote-link');
const graphicsServer = require('./src/main/graphics-server');

// GPU アクセラレーション最適化
// ※v3.10.0 でこれらを外したところ、GPUブロックリスト対象のPCでソフトウェア描画になり
//   UIの見た目が劣化したため元に戻した。タブ切替で残像が出る個体は起動引数 --disable-gpu で切り分ける。
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

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
