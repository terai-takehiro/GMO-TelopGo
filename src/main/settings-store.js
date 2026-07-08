const Store = require('electron-store');

const store = new Store({
  defaults: {
    graphics: {
      port: 8790,        // 出力サーバのポート (任意指定可)
      autoStart: true,   // アプリ起動時に出力サーバを自動起動
    },
    gpio: {
      enabled: false,
      deviceName: 'DIO000',
      pressLevel: 'on', // 'on': 押下=ON(立ち上がり) / 'off': 押下=OFF(立ち下がり)
      // 物理ボタン(EzV-400リモート相当) → 入力ビット割当と実行アクション
      buttons: {
        name: {
          stop:  { bit: -1, action: 'none' },
          clear: { bit: -1, action: 'clear' },
          top:   { bit: -1, action: 'top' },
          rev:   { bit: -1, action: 'rev' },
          skip:  { bit: -1, action: 'skip' },
          take:  { bit: -1, action: 'take' },
        },
        side: {
          stop:  { bit: -1, action: 'none' },
          clear: { bit: -1, action: 'clear' },
          top:   { bit: -1, action: 'top' },
          rev:   { bit: -1, action: 'rev' },
          skip:  { bit: -1, action: 'skip' },
          take:  { bit: -1, action: 'take' },
        },
      },
    },
    remote: {
      mode: 'standalone', // 'standalone' | 'host' | 'client'
      port: 8765,         // 待受/接続ポート (任意指定可)
      hostAddress: '',    // クライアント時の接続先ホストIP
      outputSide: 'host', // 出力担当PC (vMixが参照する出力サーバを動かすPC): 'host' | 'client'
    },
  },
});

function getSettings() {
  const remote = store.get('remote');
  // 旧設定 (singularSide) からの移行
  if (remote && !remote.outputSide && remote.singularSide) {
    remote.outputSide = remote.singularSide;
  }
  return {
    graphics: store.get('graphics'),
    gpio: store.get('gpio'),
    remote,
  };
}

function saveSettings(settings) {
  if (settings.graphics) store.set('graphics', settings.graphics);
  if (settings.gpio) store.set('gpio', settings.gpio);
  if (settings.remote) store.set('remote', settings.remote);
}

/** GPIOリモートボタン設定を取得 */
function getGpioConfig() {
  return store.get('gpio');
}

/** 出力サーバ設定を取得 */
function getGraphicsConfig() {
  return store.get('graphics');
}

module.exports = { getSettings, saveSettings, getGpioConfig, getGraphicsConfig };
