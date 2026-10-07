/**
 * デザイン・設定の同期 (2台運用)
 *
 * ホストPCは描画 (出力サーバ) と GPIO を担当し、作画・送出の操作はクライアントPCで行う運用のため、
 * クライアントで保存したデザイン (テンプレート + 素材) と系統関連の設定をホストへ反映する。
 *
 * 同期するもの:
 *   - 現在のデザイン (graphics project: テンプレート・素材の参照) と、参照している素材ファイル
 *   - 設定: channels / telopPresets / outputGroups / nameFields
 * 同期しないもの (PC固有): 出力サーバのポート・GPIO・リモート連携設定・ライブデータ・操作設定
 *
 * 方向:
 *   - クライアント → ホスト: クライアントがデザイン/設定を保存したとき自動 (schedulePush)、または手動 (push)
 *   - ホスト → クライアント: クライアントが明示的に取り込みを要求したとき (pull) のみ。
 *     接続しただけで互いのデザインが上書きされないようにするため、自動では行わない
 *
 * プロトコル (remote-link 上のJSON。素材は名前が不変 (タイムスタンプ付き) なので、受信側に無い/サイズが違うものだけ転送):
 *   design-pull   {}                            クライアント→ホスト: ホストのデザインの送信を要求
 *   design-offer  {id, project, settings, assets:[{file,size}]}  送信側→受信側: デザイン一式の提案
 *   design-need   {id, files:[name]}            受信側→送信側: 足りない素材の要求
 *   design-file   {id, file, data(base64)}      送信側→受信側: 素材ファイル
 *   design-result {id, ok, error?}              受信側→送信側: 適用結果
 *
 * 送出リスト (state-sync で同期) が参照する素材 (電テロの静止画・作画内の画像) は、デザインと別に
 * 受信側が不足分を要求して取り寄せる (どちらのPCで取り込んだ画像でも出力担当PCで描画できるように):
 *   design-asset-need {files:[name]}            不足側→相手: 素材の要求
 *   design-asset-file {file, data(base64)}      相手→不足側: 素材ファイル
 */
const fs = require('fs');
const path = require('path');

const SETTING_KEYS = ['channels', 'telopPresets', 'outputGroups', 'nameFields'];
const PUSH_DEBOUNCE_MS = 1000;

let deps = null;          // { remoteLink, graphicsStore, graphicsServer, settingsStore, notify }
let pushTimer = null;
let lastPushedHash = '';  // 直近に送信した内容 (変化が無い保存では再送しない)
let pullPending = false;  // クライアント: pull要求の応答待ち (この間だけホストからのofferを受け入れる)
let incoming = null;      // 素材の到着待ちの offer { id, payload, need:Set }
let seq = 0;
const assetWanted = new Map(); // 送出リスト用に相手へ要求中の素材 file -> 要求時刻
const ASSET_WANT_TTL_MS = 30000; // 応答が無い要求はこの時間後に再要求できるようにする

function init(d) {
  deps = d;
  deps.remoteLink.events.on('message', (msg) => {
    try { onMessage(msg); } catch (err) { notify('design-sync-status', { state: 'failed', error: err.message }); }
  });
  // 切断したら待ち状態を破棄
  deps.remoteLink.events.on('status', (st) => {
    if (!st.connected) { incoming = null; pullPending = false; assetWanted.clear(); }
  });
}

function notify(channel, payload) {
  if (deps && deps.notify) deps.notify(channel, payload);
}

function role() {
  return deps.remoteLink.getStatus().role;
}

function isConnected() {
  return deps.remoteLink.getStatus().connected;
}

function pickSettings() {
  const s = deps.settingsStore.getSettings();
  const out = {};
  SETTING_KEYS.forEach((k) => { out[k] = s[k]; });
  return out;
}

function assetPath(file) {
  return path.join(deps.graphicsStore.getAssetsDir(), path.basename(file));
}

/** 送信用パッケージ (デザイン + 設定 + 参照素材の一覧) */
function buildPackage() {
  const project = deps.graphicsStore.getProject();
  const assets = [];
  deps.graphicsStore.referencedAssetFiles(project).forEach((file) => {
    try {
      assets.push({ file, size: fs.statSync(assetPath(file)).size });
    } catch (_) { /* 存在しない素材は送らない */ }
  });
  return { project, settings: pickSettings(), assets };
}

function sendOffer(pkg) {
  const id = `ds${Date.now().toString(36)}${(seq += 1)}`;
  const sent = deps.remoteLink.send({ type: 'design-offer', payload: { id, ...pkg } });
  return sent ? id : null;
}

// ===== 送信側 =====

/** クライアント: 保存時に呼ぶ。内容が前回送信と同じなら何もしない (デバウンス) */
function schedulePush() {
  if (!deps || role() !== 'client' || !isConnected()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    push(false);
  }, PUSH_DEBOUNCE_MS);
}

/** クライアント → ホストへデザイン・設定を送る。force=true なら内容が同じでも送る */
function push(force = true) {
  if (!deps || role() !== 'client') return { ok: false, error: 'クライアントとして接続しているときのみ送信できます。' };
  if (!isConnected()) return { ok: false, error: 'ホストに接続されていません。' };
  const pkg = buildPackage();
  const hash = JSON.stringify([pkg.project, pkg.settings]);
  if (!force && hash === lastPushedHash) return { ok: true, skipped: true };
  const id = sendOffer(pkg);
  if (!id) return { ok: false, error: '送信に失敗しました。' };
  lastPushedHash = hash;
  notify('design-sync-status', { state: 'sent', direction: 'push' });
  return { ok: true, id };
}

/** クライアント: ホストのデザイン・設定の取り込みを要求する (応答のofferだけ受け入れる) */
function pull() {
  if (!deps || role() !== 'client') return { ok: false, error: 'クライアントとして接続しているときのみ取り込めます。' };
  if (!isConnected()) return { ok: false, error: 'ホストに接続されていません。' };
  pullPending = true;
  deps.remoteLink.send({ type: 'design-pull', payload: {} });
  notify('design-sync-status', { state: 'sent', direction: 'pull' });
  return { ok: true };
}

// ===== 受信側 =====

function onMessage(msg) {
  if (!deps || !msg || typeof msg.type !== 'string' || !msg.type.startsWith('design-')) return;
  const payload = msg.payload || {};
  const r = role();

  switch (msg.type) {
    case 'design-pull':
      // ホスト: クライアントの要求に応じて自分のデザインを送る
      if (r === 'host') sendOffer(buildPackage());
      break;

    case 'design-offer': {
      // ホストはクライアントのデザインを常に受け入れる。クライアントは自分が要求したときだけ受け入れる
      if (!(r === 'host' || (r === 'client' && pullPending))) return;
      if (!payload.project || !payload.project.templates) return;
      if (r === 'client') pullPending = false;
      const need = new Set();
      (payload.assets || []).forEach((a) => {
        let size = -1;
        try { size = fs.statSync(assetPath(a.file)).size; } catch (_) { /* 無い */ }
        if (size !== a.size) need.add(a.file);
      });
      if (need.size === 0) {
        apply(payload);
      } else {
        incoming = { id: payload.id, payload, need };
        deps.remoteLink.send({ type: 'design-need', payload: { id: payload.id, files: [...need] } });
      }
      break;
    }

    case 'design-need':
      // 要求された素材ファイルを送る
      (payload.files || []).forEach((file) => {
        try {
          const data = fs.readFileSync(assetPath(file)).toString('base64');
          deps.remoteLink.send({ type: 'design-file', payload: { id: payload.id, file, data } });
        } catch (_) { /* 読めない素材は送らない (受信側は不足のまま適用しない) */ }
      });
      break;

    case 'design-file':
      if (!incoming || incoming.id !== payload.id || !incoming.need.has(payload.file)) return;
      fs.writeFileSync(assetPath(payload.file), Buffer.from(payload.data || '', 'base64'));
      incoming.need.delete(payload.file);
      if (incoming.need.size === 0) {
        const p = incoming.payload;
        incoming = null;
        apply(p);
      }
      break;

    case 'design-asset-need':
      // 相手の送出リストが参照する素材のうち、こちらにあるものを送る
      (payload.files || []).forEach((file) => {
        if (typeof file !== 'string' || !file) return;
        try {
          const data = fs.readFileSync(assetPath(file)).toString('base64');
          deps.remoteLink.send({ type: 'design-asset-file', payload: { file, data } });
        } catch (_) { /* こちらにも無い素材は送らない */ }
      });
      break;

    case 'design-asset-file':
      if (typeof payload.file !== 'string' || !assetWanted.has(payload.file)) return;
      assetWanted.delete(payload.file);
      fs.writeFileSync(assetPath(payload.file), Buffer.from(payload.data || '', 'base64'));
      // 取り寄せ前に送出済みの静止画も描き直す
      deps.graphicsServer.refreshProject();
      notify('assets-synced', { file: payload.file });
      break;

    case 'design-result':
      notify('design-sync-status', payload.ok
        ? { state: 'applied', direction: r === 'client' ? 'push' : 'pull' }
        : { state: 'failed', error: payload.error || '相手PCでの適用に失敗しました' });
      break;

    default:
      break;
  }
}

/** 受信したデザイン・設定を適用する (素材ファイルは書き込み済み) */
function apply(payload) {
  const direction = role() === 'host' ? 'from-client' : 'from-host';
  try {
    const sameProject = JSON.stringify(deps.graphicsStore.getProject()) === JSON.stringify(payload.project);
    const incomingSettings = {};
    SETTING_KEYS.forEach((k) => { if (payload.settings && payload.settings[k] !== undefined) incomingSettings[k] = payload.settings[k]; });
    const sameSettings = JSON.stringify(pickSettings()) === JSON.stringify(
      Object.assign(pickSettings(), incomingSettings),
    );

    // 内容が同じなら書き込まない (保存のたびに世代バックアップが増えるのを避ける)
    if (!sameProject) deps.graphicsStore.setProject(payload.project);
    if (!sameSettings) deps.settingsStore.saveSettings(incomingSettings);
    if (!sameProject || !sameSettings) deps.graphicsServer.refreshProject();

    deps.remoteLink.send({ type: 'design-result', payload: { id: payload.id, ok: true } });
    if (!sameProject || !sameSettings) notify('design-synced', { direction });
    else notify('design-sync-status', { state: 'applied', direction, unchanged: true });
  } catch (err) {
    deps.remoteLink.send({ type: 'design-result', payload: { id: payload.id, ok: false, error: err.message } });
    notify('design-sync-status', { state: 'failed', error: err.message });
  }
}

// ===== 送出リストの素材 =====

/** 送出リストが参照する素材ファイル名 (電テロの静止画・作画内の画像) */
function rundownAssetFiles(rundown) {
  const files = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.kind === 'still' && node.still && node.still.file) files.add(node.still.file);
    if (node.kind === 'design' && node.design && node.design.variant) {
      (node.design.variant.layers || []).forEach((layer) => {
        if (layer && layer.type === 'image' && layer.file) files.add(layer.file);
      });
    }
    Object.values(node).forEach(walk);
  };
  walk(rundown);
  return [...files];
}

/** 送出リストの保存時に呼ぶ: 接続中なら、手元に無い参照素材を相手PCへ要求する */
function requestRundownAssets(rundown) {
  if (!deps || role() === 'standalone' || !isConnected()) return;
  const now = Date.now();
  const missing = rundownAssetFiles(rundown).filter((file) => {
    const since = assetWanted.get(file);
    if (since && now - since < ASSET_WANT_TTL_MS) return false;
    return !fs.existsSync(assetPath(file));
  });
  if (missing.length === 0) return;
  missing.forEach((file) => assetWanted.set(file, now));
  deps.remoteLink.send({ type: 'design-asset-need', payload: { files: missing } });
}

module.exports = { init, schedulePush, push, pull, requestRundownAssets };
