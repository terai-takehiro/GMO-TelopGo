const { app, BrowserWindow, Menu } = require('electron');
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

  // 文字入力欄の右クリック: 切り取り/コピー/貼り付け (アプリ独自メニューを出す箇所は renderer 側で抑止される)
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: 'undo', label: '元に戻す' },
      { role: 'redo', label: 'やり直し' },
      { type: 'separator' },
      { role: 'cut', label: '切り取り', enabled: params.editFlags.canCut },
      { role: 'copy', label: 'コピー', enabled: params.editFlags.canCopy },
      { role: 'paste', label: '貼り付け', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', label: 'すべて選択' },
    ]).popup({ window: mainWindow });
  });
  mainWindow.maximize(); // 運用は全画面(最大化)が基本
}

// Windows: インストーラのショートカットと同じ AppUserModelID にして、
// タスクバーでアプリのアイコン・グループ化が正しく効くようにする
if (process.platform === 'win32') app.setAppUserModelId('com.gmo.telopgo');

app.whenReady().then(() => {
  // メニューバーは非表示だが、編集ショートカット (Ctrl+X/C/V/Z/A) を確実に効かせるため編集メニューを登録する
  // 再読み込みは送出中の誤操作 (Ctrl+R) で画面が読み直されないよう Ctrl+Shift+F5 にし、画面側で確認してから行う。
  // 表示倍率は画面側へ渡し、デザイン画面ではキャンバスの拡大・縮小に使う
  const toRenderer = (channel, arg) => (_item, win) => { if (win) win.webContents.send(channel, arg); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'editMenu' },
    {
      label: '表示',
      submenu: [
        { label: '再読み込み', accelerator: 'CmdOrCtrl+Shift+F5', click: toRenderer('app-reload-request') },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '実際のサイズ', accelerator: 'CmdOrCtrl+0', click: toRenderer('app-zoom', 'reset') },
        { label: '拡大', accelerator: 'CmdOrCtrl+Plus', click: toRenderer('app-zoom', 'in') },
        { label: '縮小', accelerator: 'CmdOrCtrl+-', click: toRenderer('app-zoom', 'out') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]));
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
