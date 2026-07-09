const Store = require('electron-store');

const store = new Store({
  defaults: {
    graphics: {
      port: 8790,        // 出力サーバのポート (任意指定可)
      autoStart: true,   // アプリ起動時に出力サーバを自動起動
    },
    // 出力チャンネル (region=URLスラッグ)。設定タブで追加/編集できる
    channels: [
      { id: 'name', label: '名前', region: 'name', color: '#e8b93c' },
      { id: 'side', label: 'サイド', region: 'side', color: '#4da3ff' },
    ],
    // 出力グループ: 複数チャンネルを1つの出力URLへレイヤー合成する定義
    // channels配列の順 = レイヤー順 (先頭=背面 / 末尾=前面)。/output/jp/g/<id> で配信
    outputGroups: [],
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
    channels: getChannels(),
    outputGroups: getOutputGroups(),
    gpio: store.get('gpio'),
    remote,
    liveData: store.get('liveData'),
  };
}

function saveSettings(settings) {
  if (settings.graphics) store.set('graphics', settings.graphics);
  if (Array.isArray(settings.channels) && settings.channels.length > 0) {
    store.set('channels', sanitizeChannels(settings.channels));
  }
  if (Array.isArray(settings.outputGroups)) {
    store.set('outputGroups', sanitizeOutputGroups(settings.outputGroups));
  }
  if (settings.gpio) store.set('gpio', settings.gpio);
  if (settings.remote) store.set('remote', settings.remote);
  if (settings.liveData) store.set('liveData', settings.liveData);
}

/** 出力チャンネル一覧 (region重複や不正スラッグを除去) */
function sanitizeChannels(channels) {
  const seen = new Set();
  const out = [];
  channels.forEach((ch) => {
    const region = String(ch.region || ch.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!region || region === 'jp' || region === 'en' || seen.has(region)) return;
    seen.add(region);
    out.push({
      id: region,
      label: String(ch.label || region).slice(0, 20),
      region,
      color: /^#[0-9a-fA-F]{6}$/.test(ch.color || '') ? ch.color : '#4da3ff',
    });
  });
  return out.length ? out : undefined;
}

function getChannels() {
  const channels = store.get('channels');
  return Array.isArray(channels) && channels.length ? channels : [
    { id: 'name', label: '名前', region: 'name', color: '#e8b93c' },
    { id: 'side', label: 'サイド', region: 'side', color: '#4da3ff' },
  ];
}

/** 出力グループを正規化 (存在するチャンネルのみ・id採番・スラッグ整形) */
function sanitizeOutputGroups(groups) {
  const validRegions = new Set(getChannels().map((c) => c.region));
  const seen = new Set();
  const out = [];
  groups.forEach((g, i) => {
    const id = String(g.id || `grp${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `grp${i + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    const channels = [...new Set((Array.isArray(g.channels) ? g.channels : [])
      .filter((cid) => validRegions.has(cid)))];
    out.push({
      id,
      label: String(g.label || id).slice(0, 20),
      channels,
    });
  });
  return out;
}

function getOutputGroups() {
  const groups = store.get('outputGroups');
  return Array.isArray(groups) ? groups : [];
}

/** GPIOリモートボタン設定を取得 */
function getGpioConfig() {
  return store.get('gpio');
}

/** 出力サーバ設定を取得 */
function getGraphicsConfig() {
  return store.get('graphics');
}

module.exports = { getSettings, saveSettings, getGpioConfig, getGraphicsConfig, getChannels, getOutputGroups };
