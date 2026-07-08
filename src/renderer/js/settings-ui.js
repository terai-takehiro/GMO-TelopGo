/**
 * 設定画面UI + プロジェクト保存/読込
 */
const SettingsUI = {
  /** ショットタイプごとのフィールド定義 */
  SHOT_FIELD_DEFS: {
    nameOnly: [
      { key: 'nameJp', label: '名前(JP)', default: 'onlynameJp' },
      { key: 'nameEn', label: '名前(EN)', default: 'onlynameEn' },
    ],
    '1S': [
      { key: 'titleJp', label: '肩書(JP)', default: 'titleJp' },
      { key: 'nameJp', label: '名前(JP)', default: 'nameJp' },
      { key: 'titleEn', label: '肩書(EN)', default: 'titleEn' },
      { key: 'nameEn', label: '名前(EN)', default: 'nameEn' },
    ],
    '2S': [
      { key: 'titleJp', label: '1人目 肩書(JP)', default: 'titleJp' },
      { key: 'nameJp', label: '1人目 名前(JP)', default: 'nameJp' },
      { key: 'titleEn', label: '1人目 肩書(EN)', default: 'titleEn' },
      { key: 'nameEn', label: '1人目 名前(EN)', default: 'nameEn' },
      { key: '2ndTitleJp', label: '2人目 肩書(JP)', default: '2ndTitleJp' },
      { key: '2ndNameJp', label: '2人目 名前(JP)', default: '2ndNameJp' },
      { key: '2ndTitleEn', label: '2人目 肩書(EN)', default: '2ndTitleEn' },
      { key: '2ndNameEn', label: '2人目 名前(EN)', default: '2ndNameEn' },
    ],
    '3S': [
      { key: 'titleJp', label: '1人目 肩書(JP)', default: 'titleJp' },
      { key: 'nameJp', label: '1人目 名前(JP)', default: 'nameJp' },
      { key: 'titleEn', label: '1人目 肩書(EN)', default: 'titleEn' },
      { key: 'nameEn', label: '1人目 名前(EN)', default: 'nameEn' },
      { key: '2ndTitleJp', label: '2人目 肩書(JP)', default: '2ndTitleJp' },
      { key: '2ndNameJp', label: '2人目 名前(JP)', default: '2ndNameJp' },
      { key: '2ndTitleEn', label: '2人目 肩書(EN)', default: '2ndTitleEn' },
      { key: '2ndNameEn', label: '2人目 名前(EN)', default: '2ndNameEn' },
      { key: '3rdTitleJp', label: '3人目 肩書(JP)', default: '3rdTitleJp' },
      { key: '3rdNameJp', label: '3人目 名前(JP)', default: '3rdNameJp' },
      { key: '3rdTitleEn', label: '3人目 肩書(EN)', default: '3rdTitleEn' },
      { key: '3rdNameEn', label: '3人目 名前(EN)', default: '3rdNameEn' },
    ],
    '4S': [
      { key: 'titleJp', label: '1人目 肩書(JP)', default: 'titleJp' },
      { key: 'nameJp', label: '1人目 名前(JP)', default: 'nameJp' },
      { key: 'titleEn', label: '1人目 肩書(EN)', default: 'titleEn' },
      { key: 'nameEn', label: '1人目 名前(EN)', default: 'nameEn' },
      { key: '2ndTitleJp', label: '2人目 肩書(JP)', default: '2ndTitleJp' },
      { key: '2ndNameJp', label: '2人目 名前(JP)', default: '2ndNameJp' },
      { key: '2ndTitleEn', label: '2人目 肩書(EN)', default: '2ndTitleEn' },
      { key: '2ndNameEn', label: '2人目 名前(EN)', default: '2ndNameEn' },
      { key: '3rdTitleJp', label: '3人目 肩書(JP)', default: '3rdTitleJp' },
      { key: '3rdNameJp', label: '3人目 名前(JP)', default: '3rdNameJp' },
      { key: '3rdTitleEn', label: '3人目 肩書(EN)', default: '3rdTitleEn' },
      { key: '3rdNameEn', label: '3人目 名前(EN)', default: '3rdNameEn' },
      { key: '4thTitleJp', label: '4人目 肩書(JP)', default: '4thTitleJp' },
      { key: '4thNameJp', label: '4人目 名前(JP)', default: '4thNameJp' },
      { key: '4thTitleEn', label: '4人目 肩書(EN)', default: '4thTitleEn' },
      { key: '4thNameEn', label: '4人目 名前(EN)', default: '4thNameEn' },
    ],
  },

  async init() {
    // ショットタイプ設定UIを生成
    this.renderShotSettings();

    // 保存済み設定を読み込み
    const settings = await window.api.getSettings();
    this.populateFields(settings);

    // 設定保存ボタン
    document.getElementById('save-settings').addEventListener('click', () => this.save());

    // 接続テスト
    document.getElementById('name-test-conn').addEventListener('click', () => this.testConnection('name'));
    document.getElementById('side-test-conn').addEventListener('click', () => this.testConnection('side'));

    // プロジェクト保存/読込
    document.getElementById('project-save').addEventListener('click', () => this.saveProject());
    document.getElementById('project-load').addEventListener('click', () => this.loadProject());
  },

  /** 5ショットタイプの設定UIを動的生成 */
  renderShotSettings() {
    const container = document.getElementById('name-shot-settings');
    container.innerHTML = '';

    for (const [shotType, shotDef] of Object.entries(SHOT_TYPES)) {
      const fieldDefs = this.SHOT_FIELD_DEFS[shotType];
      if (!fieldDefs) continue;

      const details = document.createElement('details');
      details.className = 'shot-settings';

      const summary = document.createElement('summary');
      summary.textContent = `${shotDef.label} 設定`;
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'shot-settings-content';

      // Sub-Composition名
      const subRow = document.createElement('div');
      subRow.className = 'settings-row';
      subRow.innerHTML = `
        <label>Sub-Composition名</label>
        <input type="text" class="input" id="name-shot-${shotType}-sub-comp" placeholder="例: Name_${shotDef.label}">
      `;
      content.appendChild(subRow);

      // フィールドマッピング
      const mappingRow = document.createElement('div');
      mappingRow.className = 'settings-row';
      const mappingLabel = document.createElement('label');
      mappingLabel.textContent = 'フィールドマッピング';
      mappingRow.appendChild(mappingLabel);

      const mappingDiv = document.createElement('div');
      mappingDiv.className = 'field-mapping';

      fieldDefs.forEach((fd) => {
        const row = document.createElement('div');
        row.className = 'mapping-row';
        row.innerHTML = `
          <span class="mapping-label">${fd.label}</span>
          <input type="text" class="input input--small" id="name-shot-${shotType}-field-${fd.key}" placeholder="${fd.default}">
        `;
        mappingDiv.appendChild(row);
      });

      mappingRow.appendChild(mappingDiv);
      content.appendChild(mappingRow);

      details.appendChild(content);
      container.appendChild(details);
    }
  },

  populateFields(settings) {
    // Output URL
    if (settings.outputUrl !== undefined) {
      document.getElementById('output-url').value = settings.outputUrl;
      this.applyPreviewUrl(settings.outputUrl);
    }

    // 名前テロップ
    const n = settings.nameTelop;
    document.getElementById('name-token').value = n.appToken || '';

    // 各ショットタイプ設定
    const shots = n.shots || {};
    for (const [shotType, shotDef] of Object.entries(SHOT_TYPES)) {
      const shotConfig = shots[shotType] || {};
      const subCompEl = document.getElementById(`name-shot-${shotType}-sub-comp`);
      if (subCompEl) {
        subCompEl.value = shotConfig.subCompositionName || '';
      }

      const fields = shotConfig.fields || {};
      const fieldDefs = this.SHOT_FIELD_DEFS[shotType] || [];
      fieldDefs.forEach((fd) => {
        const el = document.getElementById(`name-shot-${shotType}-field-${fd.key}`);
        if (el) {
          el.value = fields[fd.key] || '';
        }
      });
    }

    // サイドテロップ
    const s = settings.sideTelop;
    document.getElementById('side-token').value = s.appToken || '';
    document.getElementById('side-sub-comp').value = s.subCompositionName || '';
    document.getElementById('side-field-text-jp').value = (s.fields && s.fields.textJp) || '';
    document.getElementById('side-field-text-en').value = (s.fields && s.fields.textEn) || '';

    // GPIOリモートボタン
    GpioRemote.populateConfig(settings.gpio);

    // リモート連携
    RemoteSync.populateConfig(settings.remote);
  },

  /** プレビューiframeにURLを反映 */
  applyPreviewUrl(url) {
    const namePreview = document.getElementById('name-preview');
    const sidePreview = document.getElementById('side-preview');
    if (url && url.startsWith('http')) {
      namePreview.src = url;
      sidePreview.src = url;
    } else {
      namePreview.src = 'about:blank';
      sidePreview.src = 'about:blank';
    }
  },

  async save() {
    const settings = this.collectSettings();
    const result = await window.api.saveSettings(settings);
    const statusEl = document.getElementById('settings-status');
    if (result.success) {
      statusEl.textContent = '保存しました';
      statusEl.style.color = 'var(--green)';
      App.setStatus('設定を保存しました', 'success');
      this.applyPreviewUrl(settings.outputUrl);
    } else {
      statusEl.textContent = '保存に失敗しました';
      statusEl.style.color = 'var(--red)';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  },

  collectSettings() {
    const shots = {};
    for (const [shotType] of Object.entries(SHOT_TYPES)) {
      const fieldDefs = this.SHOT_FIELD_DEFS[shotType] || [];
      const fields = {};
      fieldDefs.forEach((fd) => {
        const el = document.getElementById(`name-shot-${shotType}-field-${fd.key}`);
        fields[fd.key] = (el && el.value.trim()) || fd.default;
      });

      const subCompEl = document.getElementById(`name-shot-${shotType}-sub-comp`);
      shots[shotType] = {
        subCompositionName: (subCompEl && subCompEl.value.trim()) || '',
        fields,
      };
    }

    return {
      outputUrl: document.getElementById('output-url').value.trim(),
      nameTelop: {
        appToken: document.getElementById('name-token').value.trim(),
        shots,
      },
      sideTelop: {
        appToken: document.getElementById('side-token').value.trim(),
        subCompositionName: document.getElementById('side-sub-comp').value.trim(),
        fields: {
          textJp: document.getElementById('side-field-text-jp').value.trim() || 'textJp',
          textEn: document.getElementById('side-field-text-en').value.trim() || 'textEn',
        },
      },
      gpio: GpioRemote.collectConfig(),
      remote: RemoteSync.collectConfig(),
    };
  },

  async testConnection(type) {
    await this.save();

    const label = type === 'name' ? '名前テロップ' : 'サイドテロップ';
    App.setStatus(`${label} 接続テスト中...`);

    const result = await window.api.singularTestConnection(type);
    if (result.ok) {
      App.setStatus(`${label} 接続成功`, 'success');
      document.getElementById('status-api').textContent = 'API: 接続済';
      document.getElementById('status-api').style.color = 'var(--green)';
    } else {
      App.setStatus(`${label} 接続失敗: ${result.error || 'HTTP ' + result.status}`, 'error');
      document.getElementById('status-api').textContent = 'API: 接続失敗';
      document.getElementById('status-api').style.color = 'var(--red)';
    }
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

    // 設定を反映
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
