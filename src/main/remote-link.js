/**
 * リモート連携リンク (2台運用)
 *
 * LAN内の2台のPC間をWebSocketで接続し、テロップデータ・送出状態の同期と
 * 送出コマンドのルーティングを行うトランスポート層。
 * メッセージの中身の解釈はレンダラー側 (remote-sync.js) が行い、
 * このモジュールは配送のみを担当する。
 *
 * ロール:
 *   host   : WebSocketサーバとして待ち受け (GPIOユニットのあるPC)
 *   client : ホストのIP:ポートへ接続 (自動再接続あり)
 *
 * イベント:
 *   'message' (msg)    : ピアからJSONメッセージを受信
 *   'status'  (status) : 接続状態が変化
 */
const { EventEmitter } = require('events');

/** クライアントの自動再接続間隔 (ms) */
const RECONNECT_INTERVAL_MS = 3000;

const events = new EventEmitter();

let role = 'standalone'; // 'standalone' | 'host' | 'client'
let wss = null;          // ホスト: WebSocketServer
let hostSockets = new Set(); // ホスト: 接続中クライアント
let clientSocket = null; // クライアント: ホストへの接続
let clientConnected = false;
let reconnectTimer = null;
let currentPort = 0;
let currentHostAddress = '';
let lastError = '';

function emitStatus() {
  events.emit('status', getStatus());
}

/** ホストとして指定ポートで待ち受け開始 */
function startHost(port) {
  stop();
  const { WebSocketServer } = require('ws');
  role = 'host';
  currentPort = port;
  lastError = '';

  wss = new WebSocketServer({ port, host: '0.0.0.0' });

  wss.on('listening', () => emitStatus());

  wss.on('error', (err) => {
    lastError = `待受エラー: ${err.message}`;
    events.emit('status', getStatus());
  });

  wss.on('connection', (socket) => {
    hostSockets.add(socket);
    emitStatus();

    socket.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (_) {
        return;
      }
      // 他のクライアントへ中継 (送信元以外)
      hostSockets.forEach((s) => {
        if (s !== socket && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
      });
      events.emit('message', msg);
    });

    socket.on('close', () => {
      hostSockets.delete(socket);
      emitStatus();
    });

    socket.on('error', () => { /* closeで処理 */ });
  });
}

/** クライアントとしてホストへ接続 (切断時は自動再接続) */
function connectClient(hostAddress, port) {
  stop();
  role = 'client';
  currentPort = port;
  currentHostAddress = hostAddress;
  lastError = '';
  openClientSocket();
}

function openClientSocket() {
  if (role !== 'client') return;
  const WebSocket = require('ws');
  const socket = new WebSocket(`ws://${currentHostAddress}:${currentPort}`);
  clientSocket = socket;

  socket.on('open', () => {
    clientConnected = true;
    lastError = '';
    emitStatus();
  });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (_) {
      return;
    }
    events.emit('message', msg);
  });

  socket.on('close', () => {
    if (clientSocket !== socket) return; // 古い接続
    clientConnected = false;
    emitStatus();
    scheduleReconnect();
  });

  socket.on('error', (err) => {
    lastError = `接続エラー: ${err.message}`;
    // closeイベントで再接続がスケジュールされる
  });
}

function scheduleReconnect() {
  if (role !== 'client' || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    openClientSocket();
  }, RECONNECT_INTERVAL_MS);
}

/** ピアへJSONメッセージを送信 */
function send(msg) {
  const raw = JSON.stringify(msg);
  if (role === 'host') {
    hostSockets.forEach((s) => {
      if (s.readyState === s.OPEN) s.send(raw);
    });
    return hostSockets.size > 0;
  }
  if (role === 'client' && clientSocket && clientConnected) {
    clientSocket.send(raw);
    return true;
  }
  return false;
}

/** リンクを停止してスタンドアロンに戻す */
function stop() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (clientSocket) {
    try { clientSocket.removeAllListeners('close'); clientSocket.close(); } catch (_) { /* ignore */ }
    clientSocket = null;
    clientConnected = false;
  }
  if (wss) {
    hostSockets.forEach((s) => { try { s.close(); } catch (_) { /* ignore */ } });
    hostSockets.clear();
    try { wss.close(); } catch (_) { /* ignore */ }
    wss = null;
  }
  if (role !== 'standalone') {
    role = 'standalone';
    emitStatus();
  }
}

function getStatus() {
  return {
    role,
    connected: role === 'host' ? hostSockets.size > 0 : clientConnected,
    clientCount: hostSockets.size,
    port: currentPort,
    hostAddress: currentHostAddress,
    lastError,
  };
}

module.exports = { events, startHost, connectClient, send, stop, getStatus };
