/**
 * CONTEC デジタル入出力ユニット制御モジュール (DIO-1616BX-USB 等)
 *
 * API-DIO(WDM) ドライバの cdio.dll を koffi (FFI) 経由で呼び出し、
 * 入力ポート (16bit) をポーリングしてリモートボタンの押下エッジを検出する。
 * EzV-400 等のリモートボタン(接点)をDIOユニットの入力に接続して使用する。
 *
 * イベント:
 *   'button' (bitNo)   : ボタン押下エッジを検出
 *   'state'  (state16) : 入力状態が変化 (16bitの現在値)
 *   'error'  (message) : ポーリング中のエラー (自動切断される)
 */
const { EventEmitter } = require('events');

/** 入力ポーリング周期 (ms) */
const POLL_INTERVAL_MS = 25;
/** チャタリング除去: デジタルフィルタ値 (250ns * 2^14 ≒ 4.1ms) */
const DIGITAL_FILTER_VALUE = 14;
/** チャタリング除去: 同一ビットの再検出を無視する時間 (ms) */
const SOFT_DEBOUNCE_MS = 80;

const events = new EventEmitter();

let api = null;        // cdio.dll の関数群 (遅延ロード)
let deviceId = null;   // DioInit で取得したデバイスID
let deviceName = '';
let pollTimer = null;
let prevState = 0;     // 前回の入力16bit状態
let pressLevel = 'on'; // 'on': 押下=ON(立ち上がり検出) / 'off': 押下=OFF(立ち下がり検出)
let lastError = '';
let lastPressAt = new Array(16).fill(0);

/** cdio.dll をロードして関数を定義する (初回のみ) */
function loadApi() {
  if (api) return api;
  if (process.platform !== 'win32') {
    throw new Error('CONTEC DIOドライバ(cdio.dll)はWindowsでのみ利用できます。');
  }
  const koffi = require('koffi');
  let lib;
  try {
    lib = koffi.load('cdio.dll');
  } catch (err) {
    throw new Error('cdio.dll をロードできません。CONTEC API-DIO(WDM) ドライバをインストールしてください。');
  }
  api = {
    DioInit: lib.func('long __stdcall DioInit(const char *DeviceName, _Out_ short *Id)'),
    DioExit: lib.func('long __stdcall DioExit(short Id)'),
    DioInpByte: lib.func('long __stdcall DioInpByte(short Id, short PortNo, _Out_ uint8_t *Data)'),
    DioSetDigitalFilter: lib.func('long __stdcall DioSetDigitalFilter(short Id, short FilterValue)'),
    DioGetErrorString: lib.func('long __stdcall DioGetErrorString(long ErrorCode, _Out_ char *ErrorString)'),
    DioQueryDeviceName: lib.func('long __stdcall DioQueryDeviceName(short Index, _Out_ char *DeviceName, _Out_ char *Device)'),
  };
  return api;
}

/** エラーコードをドライバのメッセージ文字列に変換 */
function errorText(code) {
  try {
    const buf = Buffer.alloc(256);
    api.DioGetErrorString(code, buf);
    const msg = buf.toString('ascii').split('\0')[0].trim();
    if (msg) return `${msg} (code=${code})`;
  } catch (_) { /* fall through */ }
  return `エラーコード ${code}`;
}

/** 入力ポート0/1を読み、16bit値として返す */
function readInputs() {
  const b0 = [0];
  const b1 = [0];
  let ret = api.DioInpByte(deviceId, 0, b0);
  if (ret !== 0) throw new Error(`入力読取失敗: ${errorText(ret)}`);
  ret = api.DioInpByte(deviceId, 1, b1);
  if (ret !== 0) throw new Error(`入力読取失敗: ${errorText(ret)}`);
  return ((b1[0] & 0xff) << 8) | (b0[0] & 0xff);
}

/** ポーリング1回分: エッジ検出してイベント発火 */
function poll() {
  let state;
  try {
    state = readInputs();
  } catch (err) {
    lastError = err.message;
    disconnect();
    events.emit('error', err.message);
    return;
  }

  const changed = state ^ prevState;
  if (changed) {
    // 押下エッジ: 押下=ON なら 0→1、押下=OFF なら 1→0 の変化ビット
    const pressedBits = pressLevel === 'off' ? (changed & ~state) : (changed & state);
    const now = Date.now();
    for (let bit = 0; bit < 16; bit++) {
      if (pressedBits & (1 << bit)) {
        if (now - lastPressAt[bit] < SOFT_DEBOUNCE_MS) continue;
        lastPressAt[bit] = now;
        events.emit('button', bit);
      }
    }
    prevState = state;
    events.emit('state', state);
  }
}

/**
 * デバイスに接続してポーリングを開始する
 * @param {{deviceName?: string, pressLevel?: 'on'|'off'}} options
 */
function connect(options = {}) {
  disconnect();

  const name = (options.deviceName || 'DIO000').trim();
  pressLevel = options.pressLevel === 'off' ? 'off' : 'on';

  let lib;
  try {
    lib = loadApi();
  } catch (err) {
    lastError = err.message;
    throw err;
  }
  const idOut = [0];
  const ret = lib.DioInit(name, idOut);
  if (ret !== 0) {
    lastError = `DioInit失敗: ${errorText(ret)}`;
    throw new Error(lastError);
  }
  deviceId = idOut[0];
  deviceName = name;
  lastError = '';

  // ハードウェア側のチャタリング除去 (未対応機種でも失敗は無視)
  try { lib.DioSetDigitalFilter(deviceId, DIGITAL_FILTER_VALUE); } catch (_) { /* ignore */ }

  // 初期状態を取り込む (接続時に押されているボタンを誤検出しない)
  prevState = readInputs();
  lastPressAt = new Array(16).fill(0);
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
  events.emit('state', prevState);
}

/** ポーリングを停止してデバイスを解放する */
function disconnect() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (deviceId !== null && api) {
    try { api.DioExit(deviceId); } catch (_) { /* ignore */ }
    deviceId = null;
  }
  deviceName = '';
  prevState = 0;
}

function isConnected() {
  return deviceId !== null && pollTimer !== null;
}

function getStatus() {
  return {
    connected: isConnected(),
    deviceName: isConnected() ? deviceName : '',
    platform: process.platform,
    lastError,
  };
}

/** インストール済みのCONTEC DIOデバイスを列挙する */
function listDevices() {
  const lib = loadApi();
  const devices = [];
  for (let i = 0; i < 32; i++) {
    const nameBuf = Buffer.alloc(256);
    const modelBuf = Buffer.alloc(256);
    const ret = lib.DioQueryDeviceName(i, nameBuf, modelBuf);
    if (ret !== 0) break;
    devices.push({
      deviceName: nameBuf.toString('ascii').split('\0')[0].trim(),
      model: modelBuf.toString('ascii').split('\0')[0].trim(),
    });
  }
  return devices;
}

module.exports = { events, connect, disconnect, isConnected, getStatus, listDevices };
