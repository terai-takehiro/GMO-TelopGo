/**
 * グラフィックス出力サーバ
 *
 * HTML5テロップ出力ページを配信するHTTPサーバと、送出状態を配信するWebSocketサーバ。
 * vMix等のブラウザ入力で以下のURLを取り込む (1920x1080・透過):
 *
 *   /output/jp          日本語 (名前+サイドを1枚に重畳)
 *   /output/en          英語
 *   /output/jp/name     分割出力 (言語×リージョン、計4本)
 *   /output/jp/side ...
 *   /assets/<file>      画像素材
 *   /ws                 状態配信WebSocket
 *
 * リージョン (name / side) ごとにオンエア状態を保持し、
 * ページ再読込時も init メッセージで表示が復元される。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const events = new EventEmitter();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

let server = null;
let wss = null;
let sockets = new Set();
let currentPort = 0;
let lastError = '';
let staticDir = '';
let assetsDir = '';
let getProject = () => null;

/** リージョンごとのオンエア状態 */
const state = {
  name: { onAir: false, templateKey: null, values: {} },
  side: { onAir: false, templateKey: null, values: {} },
};

function configure(options) {
  staticDir = options.staticDir;
  assetsDir = options.assetsDir;
  getProject = options.getProject;
}

// ===== HTTP =====

function sendFile(res, filePath, extraHeaders) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }, extraHeaders || {}));
    res.end(data);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // 出力ページ: /output/:lang(/:region)?
  if (/^\/output\/(jp|en)(\/(name|side))?\/?$/.test(p)) {
    sendFile(res, path.join(staticDir, 'output.html'));
    return;
  }

  // 出力ページ用の静的ファイル
  if (p === '/static/output.js') { sendFile(res, path.join(staticDir, 'output.js')); return; }
  if (p === '/static/telop-renderer.js') { sendFile(res, path.join(staticDir, 'telop-renderer.js')); return; }
  if (p === '/static/telop-animator.js') { sendFile(res, path.join(staticDir, 'telop-animator.js')); return; }
  if (p === '/static/output.css') { sendFile(res, path.join(staticDir, 'output.css')); return; }

  // 素材 (画像/フォント) — パストラバーサル対策にbasenameのみ許可
  // CORSを許可し、エディタのPNG書き出し(Canvas)で画像を扱えるようにする
  if (p.startsWith('/assets/')) {
    const file = path.basename(decodeURIComponent(p.slice('/assets/'.length)));
    sendFile(res, path.join(assetsDir, file), { 'Access-Control-Allow-Origin': '*' });
    return;
  }

  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<meta charset="utf-8"><title>GMO TelopGo Output</title>'
      + '<h3>GMO TelopGo 出力サーバ</h3>'
      + '<ul><li><a href="/output/jp">/output/jp</a></li><li><a href="/output/en">/output/en</a></li>'
      + '<li><a href="/output/jp/name">/output/jp/name</a></li><li><a href="/output/jp/side">/output/jp/side</a></li>'
      + '<li><a href="/output/en/name">/output/en/name</a></li><li><a href="/output/en/side">/output/en/side</a></li></ul>');
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}

// ===== WebSocket =====

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  sockets.forEach((s) => {
    if (s.readyState === s.OPEN) s.send(raw);
  });
}

function initMessage() {
  return { type: 'init', payload: { project: getProject(), state } };
}

// ===== 制御API =====

function start(port) {
  return new Promise((resolve, reject) => {
    stop();
    const { WebSocketServer } = require('ws');

    server = http.createServer(handleRequest);
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (socket) => {
      sockets.add(socket);
      socket.send(JSON.stringify(initMessage()));
      socket.on('close', () => { sockets.delete(socket); events.emit('status'); });
      socket.on('error', () => { /* closeで処理 */ });
      events.emit('status');
    });

    server.on('error', (err) => {
      lastError = err.message;
      events.emit('status');
      reject(new Error(`出力サーバを起動できません: ${err.message}`));
    });

    server.listen(port, '0.0.0.0', () => {
      currentPort = port;
      lastError = '';
      events.emit('status');
      resolve();
    });
  });
}

function stop() {
  if (wss) {
    sockets.forEach((s) => { try { s.close(); } catch (_) { /* ignore */ } });
    sockets.clear();
    try { wss.close(); } catch (_) { /* ignore */ }
    wss = null;
  }
  if (server) {
    try { server.close(); } catch (_) { /* ignore */ }
    server = null;
    currentPort = 0;
    events.emit('status');
  }
}

function isRunning() {
  return server !== null;
}

function getStatus() {
  return {
    running: isRunning(),
    port: currentPort,
    clients: sockets.size,
    lastError,
    state,
  };
}

/**
 * TAKE: INアニメーション付きで表示 (animate=falseでカット差し替え=CHANGE)
 * values は全言語分のフィールド値。各出力ページが自分の言語分を描画する。
 */
function take(region, templateKey, values, animate = true) {
  state[region] = { onAir: true, templateKey, values };
  broadcast({ type: 'take', region, templateKey, values, animate });
}

/** CHANGE: アニメーションなしの即時差し替え */
function change(region, templateKey, values) {
  take(region, templateKey, values, false);
}

/** CLEAR: OUTアニメーションで消去 */
function clear(region) {
  state[region] = { onAir: false, templateKey: null, values: {} };
  broadcast({ type: 'clear', region });
}

/** テンプレート再読込を全出力ページへ配信 (エディタ保存時など) */
function refreshProject() {
  broadcast({ type: 'refresh', payload: { project: getProject(), state } });
}

module.exports = {
  events, configure, start, stop, isRunning, getStatus,
  take, change, clear, refreshProject,
};
