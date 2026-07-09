/**
 * 出力サーバ (HTML5グラフィックス) 設定UI + プレビュー制御
 */
const GraphicsUI = {
  status: null, // 最新のサーバ状態

  init() {
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

    this.renderUrls(status);
    this.applyPreview(status);

    // デザインタブのサーバ停止警告バナーを更新
    if (typeof DesignEditor !== 'undefined' && DesignEditor.loaded) {
      DesignEditor.updateServerBanner(status);
    }
  },

  renderUrls(status) {
    const container = document.getElementById('graphics-urls');
    container.innerHTML = '';
    if (!status.running) {
      container.innerHTML = '<span class="settings-inline-hint">サーバ起動後に表示されます</span>';
      return;
    }
    const host = (status.lanAddresses && status.lanAddresses[0]) || '127.0.0.1';
    const urls = [
      { label: '日本語 (名前+サイド)', path: '/output/jp' },
      { label: '英語 (名前+サイド)', path: '/output/en' },
      { label: '日本語 名前のみ', path: '/output/jp/name' },
      { label: '日本語 サイドのみ', path: '/output/jp/side' },
      { label: '英語 名前のみ', path: '/output/en/name' },
      { label: '英語 サイドのみ', path: '/output/en/side' },
    ];
    urls.forEach(({ label, path }) => {
      const url = `http://${host}:${status.port}${path}`;
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
   * 送出画面のプレビューiframeにローカル出力を表示する。
   * 2台運用でこのPCが出力担当でない場合は、担当PC (ホスト) の出力を参照する。
   */
  applyPreview(status) {
    const namePreview = document.getElementById('name-preview');
    const sidePreview = document.getElementById('side-preview');

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

    const url = base ? `${base}/output/jp?preview=1` : 'about:blank';
    if (namePreview.src !== url) namePreview.src = url;
    if (sidePreview.src !== url) sidePreview.src = url;
  },
};

document.addEventListener('DOMContentLoaded', () => GraphicsUI.init());
