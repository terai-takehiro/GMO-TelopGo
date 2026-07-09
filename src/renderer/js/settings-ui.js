/**
 * 設定画面UI + ランダウンの書き出し/読込 + 出力チャンネル管理
 */

/** 出力チャンネルの設定UI (設定タブ) */
const ChannelsUI = {
  rows: [],

  populate(channels) {
    this.rows = JSON.parse(JSON.stringify(channels && channels.length ? channels : [
      { id: 'name', label: '名前', region: 'name', color: '#e8b93c' },
      { id: 'side', label: 'サイド', region: 'side', color: '#4da3ff' },
    ]));
    this.render();
  },

  render() {
    const wrap = document.getElementById('ch-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    this.rows.forEach((ch, i) => {
      const row = document.createElement('div');
      row.className = 'ch-row';
      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'de-prop-color';
      color.value = ch.color || '#4da3ff';
      color.addEventListener('change', () => { ch.color = color.value; });
      const label = document.createElement('input');
      label.type = 'text';
      label.className = 'input input--small';
      label.value = ch.label;
      label.placeholder = '表示名';
      label.maxLength = 20;
      label.addEventListener('change', () => { ch.label = label.value.trim() || ch.region; });
      const region = document.createElement('input');
      region.type = 'text';
      region.className = 'input input--small ch-region';
      region.value = ch.region;
      region.placeholder = 'URL名 (半角英数)';
      region.title = '出力URLのスラッグ (/output/jp/この名前)。半角英数のみ';
      region.addEventListener('change', () => {
        ch.region = region.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || ch.region;
        ch.id = ch.region;
        region.value = ch.region;
      });
      const del = document.createElement('button');
      del.className = 'btn btn--small';
      del.textContent = '✕';
      del.title = 'チャンネルを削除 (このチャンネルのテンプレート/ページは送出できなくなります)';
      del.addEventListener('click', () => {
        if (this.rows.length <= 1) {
          App.setStatus('最後のチャンネルは削除できません', 'error');
          return;
        }
        if (!confirm(`チャンネル「${ch.label}」を削除しますか?`)) return;
        this.rows.splice(i, 1);
        this.render();
      });
      row.appendChild(color);
      row.appendChild(label);
      row.appendChild(region);
      row.appendChild(del);
      wrap.appendChild(row);
    });
    const add = document.createElement('button');
    add.className = 'btn btn--small';
    add.textContent = '＋チャンネル追加';
    add.addEventListener('click', () => {
      const region = prompt('チャンネルのURL名 (半角英数, 例: score)');
      if (!region) return;
      const slug = region.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!slug || this.rows.some((r) => r.region === slug)) {
        App.setStatus('URL名が不正か、すでに使われています', 'error');
        return;
      }
      const label = prompt('表示名 (例: スコア)', slug) || slug;
      this.rows.push({ id: slug, label, region: slug, color: '#7c5cff' });
      this.render();
    });
    wrap.appendChild(add);
  },

  collect() {
    return JSON.parse(JSON.stringify(this.rows));
  },
};

const SettingsUI = {
  async init() {
    // 保存済み設定を読み込み
    const settings = await window.api.getSettings();
    this.populateFields(settings);

    // 設定保存ボタン
    document.getElementById('save-settings').addEventListener('click', () => this.save());

    // ランダウン書き出し/読込
    document.getElementById('project-save').addEventListener('click', () => this.saveProject());
    document.getElementById('project-load').addEventListener('click', () => this.loadProject());

    // ランダウンをロードして送出タブを描画
    if (typeof RundownUI !== 'undefined') {
      await RundownUI.load();
      RundownUI.updateNamePool();
    }
  },

  populateFields(settings) {
    // 出力チャンネル (他モジュールより先に反映する)
    App.channels = (settings.channels && settings.channels.length) ? settings.channels : [
      { id: 'name', label: '名前', region: 'name', color: '#e8b93c' },
      { id: 'side', label: 'サイド', region: 'side', color: '#4da3ff' },
    ];
    ChannelsUI.populate(App.channels);

    // 出力サーバ
    GraphicsUI.populateConfig(settings.graphics);

    // GPIOリモートボタン (チャンネル確定後)
    GpioRemote.populateConfig(settings.gpio);

    // リモート連携
    RemoteSync.populateConfig(settings.remote);

    // ライブデータ連携
    if (typeof LiveDataUI !== 'undefined') LiveDataUI.populateConfig(settings.liveData);
  },

  async save() {
    const settings = this.collectSettings();
    const result = await window.api.saveSettings(settings);
    const statusEl = document.getElementById('settings-status');
    if (result.success) {
      // チャンネル変更を即時反映できる範囲で反映
      App.channels = settings.channels;
      if (typeof GpioRemote !== 'undefined') GpioRemote.populateConfig(GpioRemote.collectConfig());
      if (typeof LiveDataUI !== 'undefined') LiveDataUI.renderRegionOptions();
      if (typeof RundownUI !== 'undefined' && RundownUI.loaded) RundownUI.renderAll();
      if (typeof GraphicsUI !== 'undefined' && GraphicsUI.status) GraphicsUI.renderUrls(GraphicsUI.status);
      statusEl.textContent = '保存しました';
      statusEl.style.color = 'var(--green)';
      App.setStatus('設定を保存しました', 'success');
    } else {
      statusEl.textContent = '保存に失敗しました';
      statusEl.style.color = 'var(--red)';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  },

  collectSettings() {
    return {
      graphics: GraphicsUI.collectConfig(),
      channels: ChannelsUI.collect(),
      gpio: GpioRemote.collectConfig(),
      remote: RemoteSync.collectConfig(),
      liveData: typeof LiveDataUI !== 'undefined' ? LiveDataUI.collectConfig() : undefined,
    };
  },

  // --- ランダウン書き出し (ファイルへ) ---
  async saveProject() {
    await window.api.saveSettings(this.collectSettings());
    App.setStatus('ランダウン書き出し中...');
    const result = await window.api.saveProject();
    if (!result) {
      App.setStatus('準備完了');
      return;
    }
    if (result.success) {
      App.setStatus(`ランダウンを書き出しました: ${result.filePath}`, 'success');
    } else if (result.error) {
      App.setStatus(`書き出しエラー: ${result.error}`, 'error');
    } else {
      App.setStatus('準備完了');
    }
  },

  // --- ランダウン読込 (旧プロジェクト形式は自動変換) ---
  async loadProject() {
    App.setStatus('ランダウン読込中...');
    const result = await window.api.loadProject();
    if (!result) {
      App.setStatus('準備完了');
      return;
    }
    if (!result.success) {
      App.setStatus(`読込エラー: ${result.error || ''}`, 'error');
      return;
    }

    App.rundown = result.rundown;
    if (typeof RundownUI !== 'undefined') {
      RundownUI.currentCornerId = null;
      RundownUI.selectedPageId = null;
      RundownUI.ensureSelections();
      RundownUI.renderAll();
      RundownUI.updateNamePool();
    }

    // 設定も含まれていれば反映
    const settings = await window.api.getSettings();
    this.populateFields(settings);

    App.setStatus(result.migrated
      ? '旧形式のプロジェクトをランダウンへ変換して読み込みました'
      : 'ランダウンを読み込みました', 'success');
  },
};

document.addEventListener('DOMContentLoaded', () => SettingsUI.init());
