/**
 * Google Fonts 取得モジュール
 *
 * 指定ファミリーのCSS (css2 API) を取得し、参照されるフォントファイル (woff2) を
 * すべてassetsディレクトリへダウンロードして、URLをローカル配信パスに書き換えた
 * CSSファイルを保存する。
 *
 * 取得時のみインターネット接続が必要。取得後は出力サーバからLAN配信されるため、
 * vMix側のPCにフォントをインストールしなくても同一表示になる (文字化け防止)。
 * ※ Google Fonts はOFL等の再配布可能なライセンスで提供されている。
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

/** woff2形式のCSSを受け取るためのUA (旧UAだとttf/woffが返る) */
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_CSS_BASE = 'https://fonts.googleapis.com';

function httpGet(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': CHROME_UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        resolve(httpGet(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} (${url})`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('タイムアウトしました'));
    });
  });
}

function slugify(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/**
 * Google Fontsのファミリーを取得してローカル保存する
 * @param {string} family 例: 'Noto Sans JP'
 * @param {number[]} weights 例: [400, 700]
 * @param {string} assetsDir 保存先
 * @param {string} [cssBase] テスト用のcss2 APIベースURL上書き
 * @returns {Promise<{family: string, cssFile: string, files: string[]}>}
 */
async function fetchFamily(family, weights, assetsDir, cssBase = DEFAULT_CSS_BASE) {
  const famParam = family.trim().replace(/ /g, '+');
  const wght = (weights && weights.length ? weights : [400]).join(';');
  const cssUrl = `${cssBase}/css2?family=${famParam}:wght@${wght}&display=block`;

  let css;
  try {
    css = (await httpGet(cssUrl)).toString('utf-8');
  } catch (err) {
    throw new Error(`Google Fontsに接続できません (取得時のみインターネット接続が必要です): ${err.message}`);
  }

  // CSS内のフォントURLをすべてダウンロードし、ローカルパスへ書き換える
  const urls = [...new Set([...css.matchAll(/url\((https?:[^)]+)\)/g)].map((m) => m[1]))];
  if (urls.length === 0) {
    throw new Error('フォントファイルが見つかりませんでした (ファミリー名を確認してください)');
  }

  const slug = slugify(family);
  const files = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const ext = (url.match(/\.(woff2?|ttf|otf)(\?|$)/) || [])[1] || 'woff2';
    const name = `gf_${slug}_${i}.${ext}`;
    const data = await httpGet(url);
    fs.writeFileSync(path.join(assetsDir, name), data);
    css = css.split(url).join(`/assets/${name}`);
    files.push(name);
  }

  const cssFile = `gf_${slug}.css`;
  fs.writeFileSync(path.join(assetsDir, cssFile), css, 'utf-8');
  return { family, cssFile, files };
}

module.exports = { fetchFamily };
