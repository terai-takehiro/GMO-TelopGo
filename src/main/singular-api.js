const https = require('https');

const BASE_URL = 'app.singular.live';

/**
 * Singular Live REST APIにPATCHリクエストを送信する。
 * @param {string} appToken
 * @param {Array<Object>} payload
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
function patchControl(appToken, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const options = {
      hostname: BASE_URL,
      path: `/apiv2/controlapps/${appToken}/control`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

/**
 * テロップデータを更新する (CHANGE)。
 * @param {string} appToken
 * @param {string} subCompositionName
 * @param {Object} fieldData - { fieldName: value, ... }
 */
async function change(appToken, subCompositionName, fieldData) {
  const payload = [{
    subCompositionName,
    payload: fieldData,
  }];
  return patchControl(appToken, payload);
}

/**
 * アニメーションIn (TAKE)。
 */
async function take(appToken, subCompositionName) {
  const payload = [{
    subCompositionName,
    state: 'In',
  }];
  return patchControl(appToken, payload);
}

/**
 * アニメーションOut (CLEAR)。
 */
async function clear(appToken, subCompositionName) {
  const payload = [{
    subCompositionName,
    state: 'Out',
  }];
  return patchControl(appToken, payload);
}

/**
 * 接続テスト - GETでComposition情報を取得してみる。
 */
function testConnection(appToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      path: `/apiv2/controlapps/${appToken}/control`,
      method: 'GET',
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body });
      });
    });

    req.on('error', (err) => reject(err));
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

module.exports = { change, take, clear, testConnection };
