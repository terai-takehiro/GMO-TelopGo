/**
 * 出力サーバ (HTML5グラフィックス) 設定UI + プレビュー制御
 */
const GraphicsUI = {
  status: null, // 最新のサーバ状態

  init() {
    document.getElementById('graphics-firewall-copy').addEventListener('click', () => {
      const cmd = document.getElementById('graphics-firewall-cmd').textContent;
      if (!cmd) return;
      navigator.clipboard.writeText(cmd);
      App.setStatus('ファイアウォール許可のコマンドをコピーしました (管理者権限で実行してください)', 'success');
    });
    document.getElementById('graphics-start').addEventListener('click', () => this.start());
    document.getElementById('graphics-stop').addEventListener('click', () => this.stop());
    document.getElementById('graphics-open-template').addEventListener('click', async () => {
      const result = await window.api.graphicsOpenProjectFile();
      App.setStatus(`テンプレートJSON: ${result.path}`);
    });
    document.getElementById('graphics-reload-template').addEventListener('click', async () => {
      const result = await window.api.graphicsReloadProject();
      if (result.ok) {
        App.setStatus('テンプレートを再読込して出力へ反映しました', 'success');
      } else {
        App.setStatus(`テンプレート再読込エラー: ${result.error}`, 'error');
      }
    });
    document.getElementById('graphics-open-backups').addEventListener('click', async () => {
      if (window.api.graphicsOpenBackups) await window.api.graphicsOpenBackups();
    });
    document.getElementById('graphics-open-logs').addEventListener('click', async () => {
      if (window.api.openOnairLogs) await window.api.openOnairLogs();
    });

    window.api.onGraphicsStatus((status) => this.applyStatus(status));
    this.refreshStatus();
  },

  populateConfig(graphics) {
    if (!graphics) return;
    document.getElementById('graphics-port').value = graphics.port || 8790;
    document.getElementById('graphics-autostart').checked = graphics.autoStart !== false;
    this.refreshStatus();
  },

  collectConfig() {
    return {
      port: Math.max(1, Math.min(65535, parseInt(document.getElementById('graphics-port').value, 10) || 8790)),
      autoStart: document.getElementById('graphics-autostart').checked,
    };
  },

  async start() {
    const port = this.collectConfig().port;
    App.setStatus(`出力サーバを起動中... (ポート${port})`);
    const result = await window.api.graphicsServerStart(port);
    if (result.ok) {
      App.setStatus(`出力サーバを起動しました (ポート${port})`, 'success');
    } else {
      App.setStatus(`出力サーバ起動エラー: ${result.error}`, 'error');
    }
    this.refreshStatus();
  },

  async stop() {
    await window.api.graphicsServerStop();
    App.setStatus('出力サーバを停止しました');
    this.refreshStatus();
  },

  async refreshStatus() {
    const status = await window.api.graphicsServerStatus();
    this.applyStatus(status);
  },

  applyStatus(status) {
    this.status = status;

    const connEl = document.getElementById('graphics-conn-status');
    connEl.textContent = status.running ? `稼働中 (${status.clients}接続)` : '停止中';
    connEl.classList.toggle('connected', !!status.running);
    if (status.lastError) connEl.title = status.lastError;

    const barEl = document.getElementById('status-output');
    barEl.textContent = status.running ? `出力: ポート${status.port}` : '出力: 停止';
    barEl.style.color = status.running ? 'var(--green)' : '';
    if (typeof HeaderStatus !== 'undefined') HeaderStatus.setOutput(status.running, status.port);

    this.renderUrls(status);
    this.applyPreview(status);

    // デザインタブのサーバ停止警告バナーを更新
    if (typeof DesignEditor !== 'undefined' && DesignEditor.loaded) {
      DesignEditor.updateServerBanner(status);
    }
  },

  URL_HOST_KEY: 'telopgo.outputUrlHost',
  URL_HOST_CUSTOM_KEY: 'telopgo.outputUrlHostCustom',
  URL_ALPHAFIX_KEY: 'telopgo.outputUrlAlphaFix',
  CUSTOM_OPTION: '__custom__',

  _store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key) || '';
      localStorage.setItem(key, value);
    } catch (_) { /* 保存できない環境 */ }
    return '';
  },

  /** 出力URLに使うIP: 選択を保存していてまだ有効ならそれ、無ければ他PCから届きやすい順の先頭 */
  pickHost(status) {
    const list = (status && status.lanInterfaces) || [];
    const saved = this._store(this.URL_HOST_KEY);
    const custom = this._store(this.URL_HOST_CUSTOM_KEY);
    if (saved && (saved === '127.0.0.1' || saved === custom || list.some((i) => i.address === saved))) return saved;
    return (list[0] && list[0].address) || (status && status.lanAddresses && status.lanAddresses[0]) || '127.0.0.1';
  },

  /** IP/ホスト名の手入力 (自動検出できない環境用)。入力値は保存して選択する */
  async promptCustomHost() {
    const cur = this._store(this.URL_HOST_CUSTOM_KEY);
    const input = await AppModal.prompt('出力URLに使うIPアドレス (例: 10.19.21.141)', { value: cur, placeholder: '10.19.21.141' });
    if (input === null || input === undefined) return false;
    const v = String(input).trim();
    if (!/^[A-Za-z0-9.-]+$/.test(v)) {
      App.setStatus('IPアドレス/ホスト名は半角英数字・ドット・ハイフンで入力してください', 'error');
      return false;
    }
    this._store(this.URL_HOST_CUSTOM_KEY, v);
    this._store(this.URL_HOST_KEY, v);
    return true;
  },

  /** URLのIP選択肢 (インターフェース名つき) と警告表示 */
  renderHostSelect(status) {
    const sel = document.getElementById('graphics-url-host');
    const warn = document.getElementById('graphics-url-warn');
    if (!sel) return;
    const list = (status && status.lanInterfaces) || [];
    const current = this.pickHost(status);
    sel.innerHTML = '';
    list.forEach((i) => {
      const opt = document.createElement('option');
      opt.value = i.address;
      const tag = i.linkLocal ? ' / 自動割当 (他PCから届きません)' : i.virtual ? ' / 仮想アダプタ' : '';
      opt.textContent = `${i.address}  (${i.name}${tag})`;
      sel.appendChild(opt);
    });
    const custom = this._store(this.URL_HOST_CUSTOM_KEY);
    if (custom && !list.some((i) => i.address === custom)) {
      const opt = document.createElement('option');
      opt.value = custom;
      opt.textContent = `${custom}  (手動入力)`;
      sel.appendChild(opt);
    }
    const local = document.createElement('option');
    local.value = '127.0.0.1';
    local.textContent = '127.0.0.1  (このPCのみ)';
    sel.appendChild(local);
    const manual = document.createElement('option');
    manual.value = this.CUSTOM_OPTION;
    manual.textContent = '手動入力...';
    sel.appendChild(manual);
    sel.value = current;
    sel.onchange = async () => {
      if (sel.value === this.CUSTOM_OPTION) {
        await this.promptCustomHost();
      } else {
        this._store(this.URL_HOST_KEY, sel.value);
      }
      this.renderUrls(this.status);
    };

    const chosen = list.find((i) => i.address === current);
    if (list.length === 0 && !custom) warn.textContent = 'このPCのIPを自動検出できませんでした。「手動入力...」で ipconfig の IPv4 アドレスを入力してください';
    else if (chosen && chosen.linkLocal) warn.textContent = '自動割当IPです。DHCP/ケーブル接続を確認してください';
    else if (chosen && chosen.virtual) warn.textContent = '仮想アダプタのIPです。他PCから届かない場合は別のIPを選んでください';
    else if (current === '127.0.0.1') warn.textContent = 'このPC内のvMixでのみ使えます';
    else warn.textContent = list.length > 1 ? 'vMixのあるPCと同じネットワークのIPを選んでください' : '';
  },

  /** このPCのIP一覧を2台運用の設定にも表示 (クライアントの「接続先ホストIP」に入れる値の確認用) */
  renderLanIps(status) {
    const el = document.getElementById('remote-lan-ips');
    if (!el) return;
    const list = (status && status.lanInterfaces) || [];
    el.textContent = list.length ? `このPCのIP: ${list.map((i) => i.address).join(' / ')}` : '';
  },

  renderUrls(status) {
    const container = document.getElementById('graphics-urls');
    container.innerHTML = '';
    this.renderHostSelect(status);
    this.renderLanIps(status);
    const cmdEl = document.getElementById('graphics-firewall-cmd');
    if (cmdEl && status) {
      const port = status.port || this.collectConfig().port;
      cmdEl.textContent = `netsh advfirewall firewall add rule name="GMO TelopGo" dir=in action=allow protocol=TCP localport=${port}`;
    }
    if (!status.running) {
      container.innerHTML = '<span class="settings-inline-hint">サーバ起動後に表示されます</span>';
      return;
    }
    const host = this.pickHost(status);
    // 半透明補正 (KAIROS/vMix 等): 出力URLに ?alphafix=1 を付ける (フェード中に半透明部分が黒っぽく沈むのを打ち消す)
    const alphaFix = this._store(this.URL_ALPHAFIX_KEY) === '1';
    const fixRow = document.createElement('label');
    fixRow.className = 'graphics-url-option';
    const fixCheck = document.createElement('input');
    fixCheck.type = 'checkbox';
    fixCheck.checked = alphaFix;
    fixCheck.addEventListener('change', () => {
      this._store(this.URL_ALPHAFIX_KEY, fixCheck.checked ? '1' : '0');
      this.renderUrls(this.status || status);
    });
    fixRow.appendChild(fixCheck);
    fixRow.appendChild(document.createTextNode(' 半透明補正付きのURLにする (KAIROS・vMix などでフェード中に半透明部分が黒っぽくなる場合。受け側のURLを差し替えて使用)'));
    container.appendChild(fixRow);
    const query = alphaFix ? '?alphafix=1' : '';
    const urls = [
      { label: '日本語 (全チャンネル)', path: '/output/jp' },
      { label: '英語 (全チャンネル)', path: '/output/en' },
    ];
    (App.channels || []).forEach((ch) => {
      urls.push({ label: `日本語 ${ch.label}のみ`, path: `/output/jp/${ch.region}` });
      urls.push({ label: `英語 ${ch.label}のみ`, path: `/output/en/${ch.region}` });
    });
    (App.outputGroups || []).forEach((g) => {
      const members = (g.channels || [])
        .map((cid) => (App.channels.find((c) => c.region === cid) || {}).label || cid).join('+');
      urls.push({ label: `日本語 [G] ${g.label} (${members})`, path: `/output/jp/g/${g.id}` });
      urls.push({ label: `英語 [G] ${g.label} (${members})`, path: `/output/en/g/${g.id}` });
    });
    urls.forEach(({ label, path }) => {
      const url = `http://${host}:${status.port}${path}${query}`;
      const row = document.createElement('div');
      row.className = 'graphics-url-row';
      row.innerHTML = `<span class="graphics-url-label">${label}</span><code class="graphics-url">${url}</code>`;
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn btn--small';
      copyBtn.textContent = 'コピー';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(url);
        App.setStatus(`URLをコピーしました: ${url}`, 'success');
      });
      row.appendChild(copyBtn);
      container.appendChild(row);
    });
  },

  /**
   * プレビューの参照先ベースURL。出力サーバが動いていなければ null。
   * 2台運用でこのPCが出力担当でない場合は、担当PC (ホスト) の出力を参照する。
   */
  previewBase(status) {
    let base = null;
    if (status && status.running) {
      base = `http://127.0.0.1:${status.port}`;
    }
    // クライアント側で出力担当がホストの場合はホストの出力サーバを参照
    if (typeof RemoteSync !== 'undefined' && RemoteSync.role === 'client'
        && RemoteSync.connected && RemoteSync.outputSide === 'host') {
      const hostAddress = document.getElementById('remote-host-address').value.trim();
      const port = (status && status.port) || this.collectConfig().port;
      if (hostAddress) base = `http://${hostAddress}:${port}`;
    }
    return base;
  },

  /** 各TL列のOAモニターを最新のサーバ状態へ向ける */
  applyPreview(status) {
    if (typeof RundownUI !== 'undefined' && RundownUI.updateChannelMonitors) {
      RundownUI.updateChannelMonitors(status);
    }
  },
};

document.addEventListener('DOMContentLoaded', () => GraphicsUI.init());
