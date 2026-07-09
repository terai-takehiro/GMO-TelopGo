/**
 * GPIOリモートボタン制御 (CONTEC DIO-1616BX-USB + EzV-400リモート)
 *
 * リモートボタンの接点をDIOユニットの入力ビットに接続し、
 * 「検出」でボタンを押す → 入力ビットを自動割当 (学習方式)。
 * 割り当てたビットの押下で送出操作 (TAKE / CHANGE / CLEAR / NEXT移動) を実行する。
 */
const GpioRemote = {
  /** 物理ボタン定義 (EzV-400リモートのボタン配列) */
  BUTTON_DEFS: [
    { key: 'stop',  label: 'STOP',  defaultAction: 'none' },
    { key: 'clear', label: 'CLEAR', defaultAction: 'clear' },
    { key: 'top',   label: 'TOP',   defaultAction: 'top' },
    { key: 'rev',   label: 'REV',   defaultAction: 'rev' },
    { key: 'skip',  label: 'SKIP',  defaultAction: 'skip' },
    { key: 'take',  label: 'TAKE',  defaultAction: 'take' },
  ],

  /** ボタンに割当可能なアクション */
  ACTION_DEFS: [
    { key: 'none',   label: 'なし' },
    { key: 'take',   label: 'TAKE (CHANGE+TAKE送出)' },
    { key: 'change', label: 'CHANGE (内容差し替え)' },
    { key: 'clear',  label: 'CLEAR (表示消去)' },
    { key: 'top',    label: '先頭へ (NEXTを1行目に)' },
    { key: 'skip',   label: '次へ (NEXTを1つ進める)' },
    { key: 'rev',    label: '前へ (NEXTを1つ戻す)' },
  ],

  TELOP_LABELS: { name: '名前テロップ', side: 'サイドテロップ' },

  /** 現在のマッピング設定 (UIと同期) */
  config: null,
  /** 学習待ちのボタン {type, key} */
  learnTarget: null,
  learnTimer: null,
  connected: false,
  autoConnectDone: false,

  init() {
    this.config = this.defaultConfig();

    // マッピングテーブル生成
    this.renderMappingTable('name');
    this.renderMappingTable('side');
    this.renderMonitor();

    // 接続操作
    document.getElementById('gpio-connect').addEventListener('click', () => this.connect());
    document.getElementById('gpio-disconnect').addEventListener('click', () => this.disconnect());
    document.getElementById('gpio-search-devices').addEventListener('click', () => this.searchDevices());

    // DIOイベント受信
    window.api.onGpioButton((bit) => this.onButton(bit));
    window.api.onGpioState((state) => this.updateMonitor(state));
    window.api.onGpioError((message) => {
      this.setConnected(false);
      App.setStatus(`GPIOエラー: ${message}`, 'error');
    });

    // 起動時に既に接続済みなら状態を反映 (レンダラーリロード対策)
    window.api.gpioStatus().then((status) => {
      if (status.connected) this.setConnected(true);
    });
  },

  defaultConfig() {
    const buttons = {};
    ['name', 'side'].forEach((type) => {
      buttons[type] = {};
      this.BUTTON_DEFS.forEach((def) => {
        buttons[type][def.key] = { bit: -1, action: def.defaultAction };
      });
    });
    return { enabled: false, deviceName: 'DIO000', pressLevel: 'on', buttons };
  },

  // ===== 設定UI =====

  renderMappingTable(type) {
    const tbody = document.getElementById(`gpio-map-${type}`);
    tbody.innerHTML = '';

    this.BUTTON_DEFS.forEach((def) => {
      const tr = document.createElement('tr');
      tr.dataset.type = type;
      tr.dataset.key = def.key;

      // ボタン名
      const tdLabel = document.createElement('td');
      tdLabel.className = 'gpio-btn-label';
      tdLabel.textContent = def.label;
      tr.appendChild(tdLabel);

      // 入力ビット選択
      const tdBit = document.createElement('td');
      const bitSelect = document.createElement('select');
      bitSelect.className = 'input input--small gpio-bit-select';
      const noneOpt = document.createElement('option');
      noneOpt.value = '-1';
      noneOpt.textContent = '未割当';
      bitSelect.appendChild(noneOpt);
      for (let i = 0; i < 16; i++) {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `IN ${i}`;
        bitSelect.appendChild(opt);
      }
      bitSelect.addEventListener('change', () => {
        this.config.buttons[type][def.key].bit = parseInt(bitSelect.value, 10);
      });
      tdBit.appendChild(bitSelect);
      tr.appendChild(tdBit);

      // 検出 (学習) ボタン
      const tdLearn = document.createElement('td');
      const learnBtn = document.createElement('button');
      learnBtn.className = 'btn btn--small gpio-learn-btn';
      learnBtn.textContent = '検出';
      learnBtn.addEventListener('click', () => this.startLearn(type, def.key, tr));
      tdLearn.appendChild(learnBtn);
      tr.appendChild(tdLearn);

      // アクション選択
      const tdAction = document.createElement('td');
      const actionSelect = document.createElement('select');
      actionSelect.className = 'input input--small gpio-action-select';
      this.ACTION_DEFS.forEach((ad) => {
        const opt = document.createElement('option');
        opt.value = ad.key;
        opt.textContent = ad.label;
        actionSelect.appendChild(opt);
      });
      actionSelect.value = def.defaultAction;
      actionSelect.addEventListener('change', () => {
        this.config.buttons[type][def.key].action = actionSelect.value;
      });
      tdAction.appendChild(actionSelect);
      tr.appendChild(tdAction);

      tbody.appendChild(tr);
    });
  },

  renderMonitor() {
    const monitor = document.getElementById('gpio-monitor');
    monitor.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const led = document.createElement('span');
      led.className = 'gpio-led';
      led.dataset.bit = i;
      led.title = `IN ${i}`;
      led.textContent = i;
      monitor.appendChild(led);
    }
  },

  updateMonitor(state) {
    document.querySelectorAll('#gpio-monitor .gpio-led').forEach((led) => {
      const bit = parseInt(led.dataset.bit, 10);
      led.classList.toggle('on', (state & (1 << bit)) !== 0);
    });
  },

  /** 保存済み設定をUIに反映 */
  populateConfig(gpio) {
    if (!gpio) return;
    this.config = this.defaultConfig();
    this.config.enabled = !!gpio.enabled;
    this.config.deviceName = gpio.deviceName || 'DIO000';
    this.config.pressLevel = gpio.pressLevel === 'off' ? 'off' : 'on';

    ['name', 'side'].forEach((type) => {
      const saved = (gpio.buttons && gpio.buttons[type]) || {};
      this.BUTTON_DEFS.forEach((def) => {
        const entry = saved[def.key];
        if (!entry) return;
        const target = this.config.buttons[type][def.key];
        target.bit = typeof entry.bit === 'number' ? entry.bit : -1;
        target.action = entry.action || def.defaultAction;
      });
    });

    document.getElementById('gpio-enabled').checked = this.config.enabled;
    document.getElementById('gpio-device-name').value = this.config.deviceName;
    document.getElementById('gpio-press-level').value = this.config.pressLevel;

    ['name', 'side'].forEach((type) => {
      document.querySelectorAll(`#gpio-map-${type} tr`).forEach((tr) => {
        const entry = this.config.buttons[type][tr.dataset.key];
        tr.querySelector('.gpio-bit-select').value = String(entry.bit);
        tr.querySelector('.gpio-action-select').value = entry.action;
      });
    });

    // 有効設定なら起動時に自動接続 (初回のみ)
    if (this.config.enabled && !this.autoConnectDone) {
      this.autoConnectDone = true;
      this.connect(true);
    }
  },

  /** UIの現在値から設定オブジェクトを収集 (SettingsUI.collectSettings から呼ばれる) */
  collectConfig() {
    this.config.enabled = document.getElementById('gpio-enabled').checked;
    this.config.deviceName = document.getElementById('gpio-device-name').value.trim() || 'DIO000';
    this.config.pressLevel = document.getElementById('gpio-press-level').value === 'off' ? 'off' : 'on';
    return JSON.parse(JSON.stringify(this.config));
  },

  // ===== 接続 =====

  async connect(silent = false) {
    const deviceName = document.getElementById('gpio-device-name').value.trim() || 'DIO000';
    const pressLevel = document.getElementById('gpio-press-level').value;

    // 接続時に現在の設定を自動保存 (保存し忘れると再起動で設定が消えるため)
    if (!silent) {
      await window.api.saveSettings(SettingsUI.collectSettings());
    }

    if (!silent) App.setStatus('GPIOデバイスに接続中...');
    const result = await window.api.gpioConnect({ deviceName, pressLevel });
    if (result.ok) {
      this.setConnected(true);
      App.setStatus(`GPIO接続成功 (${deviceName})`, 'success');
    } else {
      this.setConnected(false);
      App.setStatus(`GPIO接続失敗: ${result.error}`, silent ? 'info' : 'error');
      const statusEl = document.getElementById('gpio-conn-status');
      statusEl.title = result.error || '';
    }
  },

  async disconnect() {
    await window.api.gpioDisconnect();
    this.cancelLearn();
    this.setConnected(false);
    App.setStatus('GPIOを切断しました');
  },

  async searchDevices() {
    App.setStatus('GPIOデバイスを検索中...');
    const result = await window.api.gpioListDevices();
    if (!result.ok) {
      App.setStatus(`デバイス検索失敗: ${result.error}`, 'error');
      return;
    }
    const datalist = document.getElementById('gpio-device-list');
    datalist.innerHTML = '';
    result.devices.forEach((dev) => {
      const opt = document.createElement('option');
      opt.value = dev.deviceName;
      opt.textContent = `${dev.deviceName} (${dev.model})`;
      datalist.appendChild(opt);
    });
    if (result.devices.length > 0) {
      document.getElementById('gpio-device-name').value = result.devices[0].deviceName;
      App.setStatus(`${result.devices.length}台のDIOデバイスが見つかりました`, 'success');
    } else {
      App.setStatus('DIOデバイスが見つかりません。ドライバと接続を確認してください。', 'error');
    }
  },

  setConnected(connected) {
    this.connected = connected;
    const statusEl = document.getElementById('gpio-conn-status');
    statusEl.textContent = connected ? '接続中' : '未接続';
    statusEl.classList.toggle('connected', connected);

    const barEl = document.getElementById('status-gpio');
    barEl.textContent = connected ? 'GPIO: 接続中' : 'GPIO: 未接続';
    barEl.style.color = connected ? 'var(--green)' : '';

    if (!connected) this.updateMonitor(0);
  },

  // ===== 学習 (ビット割当) =====

  startLearn(type, key, tr) {
    if (!this.connected) {
      App.setStatus('先にGPIOデバイスへ接続してください。', 'error');
      return;
    }
    const hadPrevious = !!this.learnTarget;
    this.cancelLearn();
    this.learnTarget = { type, key };
    tr.classList.add('gpio-learning');
    const label = this.BUTTON_DEFS.find((d) => d.key === key).label;
    App.setStatus(`${hadPrevious ? '(前の検出をキャンセルしました) ' : ''}[${this.TELOP_LABELS[type]} ${label}] リモートのボタンを押してください... (10秒でキャンセル)`);
    this.learnTimer = setTimeout(() => {
      this.cancelLearn();
      App.setStatus('ボタン検出がタイムアウトしました。');
    }, 10000);
  },

  cancelLearn() {
    if (this.learnTimer) {
      clearTimeout(this.learnTimer);
      this.learnTimer = null;
    }
    this.learnTarget = null;
    document.querySelectorAll('.gpio-learning').forEach((el) => el.classList.remove('gpio-learning'));
  },

  /** 学習完了: 検出したビットを対象ボタンに割当。同じビットの既存割当は解除 */
  assignBit(bit) {
    const { type, key } = this.learnTarget;
    this.cancelLearn();

    // 他のボタンに同じビットが割当済みなら解除 (1ビット=1ボタン)
    ['name', 'side'].forEach((t) => {
      Object.entries(this.config.buttons[t]).forEach(([k, entry]) => {
        if (entry.bit === bit && !(t === type && k === key)) {
          entry.bit = -1;
          const row = document.querySelector(`#gpio-map-${t} tr[data-key="${k}"]`);
          if (row) row.querySelector('.gpio-bit-select').value = '-1';
        }
      });
    });

    this.config.buttons[type][key].bit = bit;
    const tr = document.querySelector(`#gpio-map-${type} tr[data-key="${key}"]`);
    if (tr) tr.querySelector('.gpio-bit-select').value = String(bit);

    // 割当は即座に自動保存する (保存し忘れ防止)
    window.api.saveSettings(SettingsUI.collectSettings());

    const label = this.BUTTON_DEFS.find((d) => d.key === key).label;
    App.setStatus(`[${this.TELOP_LABELS[type]} ${label}] に IN ${bit} を割り当てて保存しました。`, 'success');
  },

  // ===== ボタン押下 → アクション実行 =====

  onButton(bit) {
    if (this.learnTarget) {
      this.assignBit(bit);
      return;
    }
    ['name', 'side'].forEach((type) => {
      Object.entries(this.config.buttons[type]).forEach(([key, entry]) => {
        if (entry.bit === bit && entry.action !== 'none') {
          this.executeAction(type, entry.action, key);
        }
      });
    });
  },

  executeAction(type, action, buttonKey) {
    const data = Broadcast.getData(type);
    const state = App.broadcast[type];
    const label = `リモート[${this.TELOP_LABELS[type]} ${buttonKey.toUpperCase()}]`;

    switch (action) {
      case 'take':
        Broadcast.doTake(type);
        break;
      case 'change':
        Broadcast.doChange(type);
        break;
      case 'clear':
        Broadcast.doClear(type);
        break;
      case 'top':
        if (data.length === 0) break;
        Broadcast.selectItem(type, 0);
        App.setStatus(`${label} NEXTを先頭にしました`);
        break;
      case 'skip': {
        if (data.length === 0) break;
        const idx = state.currentIndex;
        const next = idx < 0 ? 0 : Math.min(idx + 1, data.length - 1);
        Broadcast.selectItem(type, next);
        App.setStatus(`${label} NEXT: ${next + 1}行目`);
        break;
      }
      case 'rev': {
        if (data.length === 0) break;
        const idx = state.currentIndex;
        const prev = idx < 0 ? data.length - 1 : Math.max(idx - 1, 0);
        Broadcast.selectItem(type, prev);
        App.setStatus(`${label} NEXT: ${prev + 1}行目`);
        break;
      }
      default:
        break;
    }
  },
};

document.addEventListener('DOMContentLoaded', () => GpioRemote.init());
