/**
 * 設定画面UI + プロジェクト保存/読込
 */
const SettingsUI = {
  async init() {
    // 保存済み設定を読み込み
    const settings = await window.api.getSettings();
    this.populateFields(settings);

    // 設定保存ボタン
    document.getElementById('save-settings').addEventListener('click', () => this.save());

    // プロジェクト保存/読込
    document.getElementById('project-save').addEventListener('click', () => this.saveProject());
    document.getElementById('project-load').addEventListener('click', () => this.loadProject());
  },

  populateFields(settings) {
    // 出力サーバ
    GraphicsUI.populateConfig(settings.graphics);

    // GPIOリモートボタン
    GpioRemote.populateConfig(settings.gpio);

    // リモート連携
    RemoteSync.populateConfig(settings.remote);
  },

  async save() {
    const settings = this.collectSettings();
    const result = await window.api.saveSettings(settings);
    const statusEl = document.getElementById('settings-status');
    if (result.success) {
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
      gpio: GpioRemote.collectConfig(),
      remote: RemoteSync.collectConfig(),
    };
  },

  // --- プロジェクト保存 ---
  async saveProject() {
    const settings = this.collectSettings();
    await window.api.saveSettings(settings);

    const projectData = {
      namePool: App.namePool,
      nameData: App.nameData,
      sideData: App.sideData,
    };

    App.setStatus('プロジェクト保存中...');
    const result = await window.api.saveProject(projectData);
    if (!result) {
      App.setStatus('準備完了');
      return;
    }
    if (result.success) {
      App.setStatus('プロジェクトを保存しました', 'success');
    } else {
      App.setStatus(`保存エラー: ${result.error || ''}`, 'error');
    }
  },

  // --- プロジェクト読込 ---
  async loadProject() {
    App.setStatus('プロジェクト読込中...');
    const result = await window.api.loadProject();
    if (!result) {
      App.setStatus('準備完了');
      return;
    }
    if (!result.success) {
      App.setStatus(`読込エラー: ${result.error || ''}`, 'error');
      return;
    }

    const data = result.data;

    // 設定を反映 (旧バージョンのプロジェクトはSingular項目を含むが無視される)
    if (data.settings) {
      this.populateFields(data.settings);
    }

    // 名前プールを反映
    if (data.namePool) {
      App.namePool = data.namePool;
      NameTelop.renderPool();
      NameTelop.updateDatalist();
    }

    // テロップデータを反映
    if (data.nameData) {
      App.nameData = data.nameData;
      NameTelop.renderAll();
      Broadcast.reset('name');
    }

    if (data.sideData) {
      App.sideData = data.sideData;
      SideTelop.renderAll();
      Broadcast.reset('side');
    }

    const count = (data.nameData ? data.nameData.length : 0) + (data.sideData ? data.sideData.length : 0);
    App.setStatus(`プロジェクトを読み込みました (${count}件)`, 'success');
  },
};

document.addEventListener('DOMContentLoaded', () => SettingsUI.init());
