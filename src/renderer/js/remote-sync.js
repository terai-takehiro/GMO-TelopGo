/**
 * リモート連携 (2台運用) — 状態同期と送出コマンドのルーティング
 *
 * 同期対象:
 *   - テロップデータ (名前プール / 名前スケジュール / サイドテロップ)
 *   - 送出状態 (ON AIR / NEXT / モード)
 *   500ms間隔で全量スナップショットを比較し、変化があればピアへ送信 (最終書き込み優先)。
 *
 * 送出コマンドのルーティング:
 *   「出力担当」(vMixが参照する出力サーバを動かすPC) でないPCで CHANGE / TAKE / CLEAR
 *   (GPIOボタン含む) を操作すると、コマンドが担当PCへ転送されて実行される。
 *
 * メッセージプロトコル (JSON):
 *   hello       {role}                     クライアント→ホスト (接続時)
 *   hello-ack   {config:{outputSide}}      ホスト→クライアント (設定配布 + 直後にstate-sync)
 *   state-sync  {snapshot}                 双方向 (ホストが他クライアントへ中継)
 *   command     {action, telopType}        送出コマンド (受信側は担当の場合のみ実行)
 */
const RemoteSync = {
  /** 同期ポーリング間隔 (ms) */
  POLL_INTERVAL_MS: 500,

  role: 'standalone',      // 'standalone' | 'host' | 'client'
  connected: false,
  outputSide: 'host',      // 出力担当PC (vMixが参照する出力サーバを動かすPC。ホストから配布された実効値)
  lastSnapshotJson: '',
  pendingSnapshot: null,   // 入力編集中に受信したスナップショット (blur後に適用)
  receivedInitialState: false, // クライアント: ホストの初期状態を受信するまで送信を抑止
  autoStartDone: false,

  init() {
    document.getElementById('remote-apply').addEventListener('click', () => this.applyAndStart());
    document.getElementById('remote-stop').addEventListener('click', () => this.stopLink());

    // モードに応じた入力欄の表示切替
    document.querySelectorAll('input[name="remote-mode"]').forEach((radio) => {
      radio.addEventListener('change', () => this.updateModeUi());
    });

    window.api.onRemoteMessage((msg) => this.onMessage(msg));
    window.api.onRemoteStatus((status) => this.onStatus(status));

    // レンダラーリロード時に既存リンク状態を反映
    window.api.remoteStatus().then((status) => this.onStatus(status));

    setInterval(() => this.poll(), this.POLL_INTERVAL_MS);
  },

  // ===== 設定UI =====

  populateConfig(remote) {
    if (!remote) return;
    const mode = remote.mode || 'standalone';
    const radio = document.querySelector(`input[name="remote-mode"][value="${mode}"]`);
    if (radio) radio.checked = true;
    document.getElementById('remote-port').value = remote.port || 8765;
    document.getElementById('remote-host-address').value = remote.hostAddress || '';
    const side = (remote.outputSide || remote.singularSide) === 'client' ? 'client' : 'host';
    document.getElementById('remote-output-side').value = side;
    this.outputSide = side;
    this.updateModeUi();

    // 起動時自動開始 (初回のみ)
    if (mode !== 'standalone' && !this.autoStartDone) {
      this.autoStartDone = true;
      this.startLink(true);
    }
  },

  collectConfig() {
    return {
      mode: document.querySelector('input[name="remote-mode"]:checked').value,
      port: Math.max(1, Math.min(65535, parseInt(document.getElementById('remote-port').value, 10) || 8765)),
      hostAddress: document.getElementById('remote-host-address').value.trim(),
      outputSide: document.getElementById('remote-output-side').value === 'client' ? 'client' : 'host',
    };
  },

  updateModeUi() {
    const mode = document.querySelector('input[name="remote-mode"]:checked').value;
    document.getElementById('remote-host-address-row').classList.toggle('hidden', mode !== 'client');
  },

  // ===== リンク開始/停止 =====

  async applyAndStart() {
    // 設定を保存してからリンクを再起動
    await SettingsUI.save();
    await this.startLink(false);
  },

  async startLink(silent) {
    const cfg = this.collectConfig();
    this.outputSide = cfg.outputSide;
    this.receivedInitialState = false;

    if (cfg.mode === 'standalone') {
      await window.api.remoteStop();
      if (!silent) App.setStatus('リモート連携を停止しました (スタンドアロン)');
      return;
    }

    if (!silent) App.setStatus(`リモート連携を開始中... (${cfg.mode === 'host' ? `ポート${cfg.port}で待受` : `${cfg.hostAddress}:${cfg.port}へ接続`})`);
    const result = await window.api.remoteStart(cfg);
    if (!result.ok) {
      App.setStatus(`リモート連携エラー: ${result.error}`, 'error');
    }
  },

  async stopLink() {
    const radio = document.querySelector('input[name="remote-mode"][value="standalone"]');
    if (radio) radio.checked = true;
    this.updateModeUi();
    await window.api.remoteStop();
    App.setStatus('リモート連携を停止しました');
  },

  // ===== 状態変化 =====

  onStatus(status) {
    this.role = status.role;
    const wasConnected = this.connected;
    this.connected = status.connected;

    const statusEl = document.getElementById('remote-conn-status');
    const barEl = document.getElementById('status-remote');
    if (typeof HeaderStatus !== 'undefined') HeaderStatus.setRemote(status.role, status.connected, status.clientCount || 0);

    if (status.role === 'standalone') {
      statusEl.textContent = '停止中';
      statusEl.classList.remove('connected');
      barEl.textContent = 'リンク: -';
      barEl.style.color = '';
    } else if (status.role === 'host') {
      const label = status.connected ? `待受中 (${status.clientCount}台接続)` : `待受中 (ポート${status.port})`;
      statusEl.textContent = label;
      statusEl.classList.toggle('connected', status.connected);
      barEl.textContent = `リンク: ホスト ${status.connected ? `(${status.clientCount}台)` : '(待機)'}`;
      barEl.style.color = status.connected ? 'var(--green)' : '';
    } else {
      statusEl.textContent = status.connected ? '接続中' : `再接続中... (${status.hostAddress}:${status.port})`;
      statusEl.classList.toggle('connected', status.connected);
      barEl.textContent = `リンク: ${status.connected ? '接続中' : '切断'}`;
      barEl.style.color = status.connected ? 'var(--green)' : 'var(--red)';
    }
    if (status.lastError) statusEl.title = status.lastError;

    // クライアント: 接続確立時にホストへ挨拶 (ホストが設定と初期状態を返す)
    if (this.role === 'client' && this.connected && !wasConnected) {
      this.receivedInitialState = false;
      window.api.remoteSend({ type: 'hello', payload: { role: 'client' } });
    }
  },

  // ===== メッセージ処理 =====

  onMessage(msg) {
    switch (msg.type) {
      case 'hello':
        // ホスト: 実効設定を配布し、現在の状態を正として送る
        if (this.role === 'host') {
          this.outputSide = this.collectConfig().outputSide;
          window.api.remoteSend({ type: 'hello-ack', payload: { config: { outputSide: this.outputSide } } });
          this.lastSnapshotJson = JSON.stringify(this.snapshot());
          window.api.remoteSend({ type: 'state-sync', payload: this.snapshot() });
        }
        break;

      case 'hello-ack':
        if (this.role === 'client') {
          this.outputSide = msg.payload.config.outputSide === 'client' ? 'client' : 'host';
          document.getElementById('remote-output-side').value = this.outputSide;
          if (typeof GraphicsUI !== 'undefined') GraphicsUI.applyPreview(GraphicsUI.status);
        }
        break;

      case 'state-sync':
        this.receivedInitialState = true;
        if (this.isEditing()) {
          this.pendingSnapshot = msg.payload;
        } else {
          this.applySnapshot(msg.payload);
        }
        break;

      case 'command':
        // 出力担当のPCのみ実行 (担当のBroadcastメソッドはローカル実行になる)
        if (this.isExecutor()) {
          const { action, telopType } = msg.payload; // telopType = チャンネルID
          if (action === 'take') Broadcast.doTake(telopType);
          else if (action === 'update' || action === 'change') Broadcast.doUpdate(telopType);
          else if (action === 'clear') Broadcast.doClear(telopType);
          else if (action === 'clearback') Broadcast.doClearBack(telopType);
          else if (action === 'stop') Broadcast.doStop(telopType);
          else if (action === 'apply-edit') Broadcast.applyOnAirEdit(telopType);
        }
        break;

      default:
        break;
    }
  },

  // ===== 送出コマンドのルーティング =====

  /** このPCが送出 (出力サーバへの配信) を実行すべきか */
  isExecutor() {
    if (this.role === 'standalone' || !this.connected) return true; // 未接続時はローカル実行にフォールバック
    return this.role === this.outputSide;
  },

  /** 送出操作を相手PCへ委譲すべきか (Broadcastから呼ばれる) */
  shouldDelegate() {
    return this.role !== 'standalone' && this.connected && !this.isExecutor();
  },

  async sendCommand(action, telopType) {
    const result = await window.api.remoteSend({ type: 'command', payload: { action, telopType } });
    if (result.sent) {
      App.setStatus(`${action.toUpperCase()} コマンドを${this.outputSide === 'host' ? 'ホスト' : 'クライアント'}PCへ送信しました`);
    } else {
      App.setStatus('リンク未接続のためコマンドを送信できませんでした', 'error');
    }
  },

  // ===== 状態同期 =====

  snapshot() {
    return {
      v: 2,
      rundown: App.rundown,
      broadcast: App.broadcast,
    };
  },

  /** 送出タブの入力欄を編集中か (編集中はリモート状態の適用を保留) */
  isEditing() {
    const el = document.activeElement;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !!el.closest('#tab-onair');
  },

  poll() {
    if (this.role === 'standalone' || !this.connected || !App.rundown) return;

    // 編集が終わったら保留中のリモート状態を適用
    if (this.pendingSnapshot && !this.isEditing()) {
      this.applySnapshot(this.pendingSnapshot);
      this.pendingSnapshot = null;
    }

    // クライアントはホストの初期状態を受け取るまで自分の状態を送らない
    // (接続直後にクライアントの空データでホストを上書きしないため)
    if (this.role === 'client' && !this.receivedInitialState) return;

    const json = JSON.stringify(this.snapshot());
    if (json !== this.lastSnapshotJson) {
      this.lastSnapshotJson = json;
      window.api.remoteSend({ type: 'state-sync', payload: JSON.parse(json) });
    }
  },

  applySnapshot(snap) {
    if (!snap || !snap.rundown) return;

    App.rundown = snap.rundown;
    if (snap.broadcast) {
      Object.entries(snap.broadcast).forEach(([channelId, st]) => {
        Object.assign(App.chState(channelId), st);
      });
    }

    // ランダウンの永続化とUI再描画
    App.saveRundown();
    if (typeof RundownUI !== 'undefined' && RundownUI.loaded) {
      RundownUI.ensureSelections();
      RundownUI.renderAll();
      RundownUI.updateNamePool();
    }
    Broadcast.updateGlobalOnAir();

    // 適用結果を自分の最新状態として記録 (エコー送信を防ぐ)
    this.lastSnapshotJson = JSON.stringify(this.snapshot());
  },
};

document.addEventListener('DOMContentLoaded', () => RemoteSync.init());
