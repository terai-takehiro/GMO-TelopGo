/**
 * このPCのIPv4アドレス検出
 *
 * 他PC (vMix等) から出力サーバへ接続するURLに使うため、IPv4を「インターフェース名つき・届きやすい順」で返す。
 * os.networkInterfaces() で取れない環境がある (アプリに 127.0.0.1 しか出ない) ため、次の順にフォールバックする:
 *   1. os.networkInterfaces()
 *   2. Windows: `ipconfig` の出力を解析
 *   3. UDPソケットを外部アドレスへ connect してOSが選ぶ送信元IPを読む (実際には送信しない)
 */
const os = require('os');
const dgram = require('dgram');
const { execFile } = require('child_process');

/** 仮想/トンネル系のネットワークアダプタ名 (他PCから届かないIPになりやすい) */
const VIRTUAL_IFACE_RE = /vethernet|hyper-v|vmware|virtualbox|vbox|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap-|tunnel|npcap|pseudo/i;

function makeEntry(name, address, netmask) {
  return {
    name: name || '(不明)',
    address,
    netmask: netmask || '',
    linkLocal: address.startsWith('169.254.'),
    virtual: VIRTUAL_IFACE_RE.test(name || ''),
  };
}

/** 他PCから届きやすい順 (実アダプタ → 仮想アダプタ → 自動割当 169.254.x.x) */
function sortByReachability(list) {
  const rank = (i) => (i.linkLocal ? 2 : i.virtual ? 1 : 0);
  return list.slice().sort((a, b) => rank(a) - rank(b));
}

function fromOs() {
  const out = [];
  let ifaces = {};
  try { ifaces = os.networkInterfaces(); } catch (_) { return out; }
  Object.entries(ifaces).forEach(([name, list]) => {
    (list || []).forEach((iface) => {
      // Node のバージョンにより family が数値 (4) の場合がある
      const isV4 = iface.family === 'IPv4' || iface.family === 4;
      if (isV4 && !iface.internal) out.push(makeEntry(name, iface.address, iface.netmask));
    });
  });
  return out;
}

/**
 * `ipconfig` の出力からIPv4を取り出す (日本語/英語どちらの表記でも可)。
 *   "イーサネット アダプター LAN1:" / "Ethernet adapter LAN1:"  → アダプタ名の見出し (行頭から始まり ":" で終わる)
 *   "   IPv4 アドレス . . . . . . . . . . . .: 10.19.21.141"     → IPv4
 */
function parseIpconfig(text) {
  const out = [];
  let adapter = '';
  String(text || '').split(/\r?\n/).forEach((line) => {
    if (/^\S.*:\s*$/.test(line)) {
      adapter = line.replace(/:\s*$/, '').replace(/^.*?(adapter|アダプター)\s*/i, '').trim();
      return;
    }
    const m = /IPv4[^:]*:\s*(\d{1,3}(?:\.\d{1,3}){3})/i.exec(line);
    if (m) out.push(makeEntry(adapter, m[1], ''));
  });
  return out;
}

function fromIpconfig() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('ipconfig', { encoding: 'buffer', timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      let text;
      try { text = new TextDecoder('shift_jis').decode(stdout); } catch (_) { text = stdout.toString('latin1'); }
      resolve(parseIpconfig(text));
    });
  });
}

/** 既定経路で外へ出るときの送信元IP (UDP connect はパケットを送らない) */
function fromRouteProbe() {
  const targets = ['8.8.8.8', '10.255.255.255', '192.168.255.255'];
  const probe = (target) => new Promise((resolve) => {
    let done = false;
    const sock = dgram.createSocket('udp4');
    const finish = (addr) => { if (done) return; done = true; try { sock.close(); } catch (_) { /* ignore */ } resolve(addr); };
    sock.on('error', () => finish(null));
    try {
      sock.connect(80, target, () => {
        try { finish(sock.address().address); } catch (_) { finish(null); }
      });
    } catch (_) { finish(null); }
    setTimeout(() => finish(null), 1500);
  });
  return (async () => {
    for (const t of targets) {
      const addr = await probe(t);
      if (addr && addr !== '0.0.0.0' && !addr.startsWith('127.')) return [makeEntry('既定の経路', addr, '')];
    }
    return [];
  })();
}

/** このPCのIPv4一覧 (他PCから届きやすい順) */
async function listIPv4() {
  let list = fromOs();
  if (list.length === 0) list = await fromIpconfig();
  if (list.length === 0) list = await fromRouteProbe();
  // 同じIPの重複を除く
  const seen = new Set();
  list = list.filter((i) => (seen.has(i.address) ? false : (seen.add(i.address), true)));
  return sortByReachability(list);
}

module.exports = { listIPv4, parseIpconfig, VIRTUAL_IFACE_RE };
