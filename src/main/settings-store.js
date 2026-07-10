const Store = require('electron-store');

const store = new Store({
  defaults: {
    graphics: {
      port: 8790,        // 出力サーバのポート (任意指定可)
      autoStart: true,   // アプリ起動時に出力サーバを自動起動
    },
    // 出力チャンネル (系統)。既定は汎用的な TL1/TL2 (region=URLスラッグ)。任意に追加/編集
    channels: [
      { id: 'tl1', label: 'TL1', region: 'tl1', color: '#e8b93c' },
      { id: 'tl2', label: 'TL2', region: 'tl2', color: '#4da3ff' },
    ],
    // 系統プリセット (テロップ枠のストック): 各TL枠へ個別適用する {label,color,テンプレ群}
    // templateKeys のテンプレートは適用先スロットの region へ張り替えられる
    telopPresets: [
      { id: 'name', name: '名前', color: '#e8b93c', templateKeys: ['name-1S', 'name-2S', 'name-3S', 'name-4S'] },
      { id: 'side', name: 'サイド', color: '#4da3ff', templateKeys: ['side'] },
    ],
    // 出力グループ: 複数チャンネルを1つの出力URLへレイヤー合成する定義
    // channels配列の順 = レイヤー順 (先頭=背面 / 末尾=前面)。/output/jp/g/<id> で配信
    outputGroups: [],
    // 操作設定 (誤操作防止など)
    operation: {
      dblclickTake: true, // ページのダブルクリックで即TAKEする
    },
    gpio: {
      enabled: false,
      deviceName: 'DIO000',
      pressLevel: 'on', // 'on': 押下=ON(立ち上がり) / 'off': 押下=OFF(立ち下がり)
      // 物理ボタン(EzV-400リモート相当) → 入力ビット割当と実行アクション
      buttons: {
        tl1: {
          stop:  { bit: -1, action: 'none' },
          clear: { bit: -1, action: 'clear' },
          top:   { bit: -1, action: 'top' },
          rev:   { bit: -1, action: 'rev' },
          skip:  { bit: -1, action: 'skip' },
          take:  { bit: -1, action: 'take' },
        },
        tl2: {
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

const { CH_REMAP, migrateChannelList } = require('./channel-migrate');

function migrateChannelIds() {
  const chs = store.get('channels');
  if (!Array.isArray(chs)) return;
  const { channels, changed } = migrateChannelList(chs);
  if (!changed) return; // 移行不要
  store.set('channels', channels);
  const groups = store.get('outputGroups');
  if (Array.isArray(groups)) {
    store.set('outputGroups', groups.map((g) => ({
      ...g, channels: (g.channels || []).map((cid) => CH_REMAP[cid] || cid),
    })));
  }
  const gpio = store.get('gpio');
  if (gpio && gpio.buttons) {
    const nb = {};
    Object.entries(gpio.buttons).forEach(([k, v]) => { nb[CH_REMAP[k] || k] = v; });
    gpio.buttons = nb;
    store.set('gpio', gpio);
  }
}
migrateChannelIds();

function getSettings() {
  const remote = store.get('remote');
  // 旧設定 (singularSide) からの移行
  if (remote && !remote.outputSide && remote.singularSide) {
    remote.outputSide = remote.singularSide;
  }
  return {
    graphics: store.get('graphics'),
    channels: getChannels(),
    telopPresets: getTelopPresets(),
    outputGroups: getOutputGroups(),
    operation: store.get('operation'),
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
  if (Array.isArray(settings.telopPresets)) {
    store.set('telopPresets', sanitizeTelopPresets(settings.telopPresets));
  }
  if (Array.isArray(settings.outputGroups)) {
    store.set('outputGroups', sanitizeOutputGroups(settings.outputGroups));
  }
  if (settings.operation) store.set('operation', settings.operation);
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
    { id: 'tl1', label: 'TL1', region: 'tl1', color: '#e8b93c' },
    { id: 'tl2', label: 'TL2', region: 'tl2', color: '#4da3ff' },
  ];
}

/** 系統プリセット (テロップ枠のストック) を正規化 */
function sanitizeTelopPresets(presets) {
  const seen = new Set();
  const out = [];
  presets.forEach((p, i) => {
    const id = String(p.id || `preset${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `preset${i + 1}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: String(p.name || id).slice(0, 20),
      color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#4da3ff',
      templateKeys: [...new Set((Array.isArray(p.templateKeys) ? p.templateKeys : [])
        .filter((k) => typeof k === 'string' && k))],
    });
  });
  return out;
}

function getTelopPresets() {
  const presets = store.get('telopPresets');
  return Array.isArray(presets) ? presets : [];
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

module.exports = { getSettings, saveSettings, getGpioConfig, getGraphicsConfig, getChannels, getOutputGroups, getTelopPresets, migrateChannelList };
