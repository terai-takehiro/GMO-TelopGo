/**
 * 設定画面UI + ランダウンの書き出し/読込 + 出力チャンネル管理
 */

/** 出力チャンネルの設定UI (設定タブ) */
const ChannelsUI = {
  rows: [],

  populate(channels) {
    this.rows = JSON.parse(JSON.stringify(channels && channels.length ? channels : [
      { id: 'tl1', label: 'TL1', region: 'tl1', color: '#e8b93c' },
      { id: 'tl2', label: 'TL2', region: 'tl2', color: '#4da3ff' },
    ]));
    this.render();
  },

  /** 系統プリセットをスロットへ適用: label/color を反映し、プリセットのテンプレを当該系統へ張替 */
  async applyPreset(presetId, ch) {
    const preset = (App.telopPresets || []).find((p) => p.id === presetId);
    if (!preset) return;
    ch.label = preset.name;
    ch.color = preset.color;
    const proj = App.graphicsProject;
    if (proj && proj.templates) {
      (preset.templateKeys || []).forEach((k) => {
        if (proj.templates[k]) proj.templates[k].region = ch.region;
      });
      await window.api.graphicsSaveProject(proj);
      if (typeof RundownUI !== 'undefined' && RundownUI.loaded) RundownUI.refreshTemplates();
    }
    this.render();
    await SettingsUI.save();
    App.setStatus(`${ch.label} にプリセット「${preset.name}」を適用しました`, 'success');
  },

  /** スロットの現在の枠 (label/color + 当該系統のテンプレ群) をプリセットとして保存 */
  async saveSlotAsPreset(ch) {
    const name = await AppModal.prompt('系統プリセットとして保存', { value: ch.label });
    if (!name) return;
    const proj = App.graphicsProject;
    const templateKeys = proj && proj.templates
      ? Object.keys(proj.templates).filter((k) => proj.templates[k].region === ch.region) : [];
    TelopPresetsUI.rows.push({
      id: `tp_${Date.now().toString(36)}`, name: name.slice(0, 20), color: ch.color, templateKeys,
    });
    TelopPresetsUI.render();
    SettingsUI.save();
    App.setStatus(`系統プリセット「${name}」を保存しました (${templateKeys.length}テンプレート)`, 'success');
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
      // 系統プリセットの適用 (この枠へ 名前/サイド 等をストックから割当)
      const presetSel = document.createElement('select');
      presetSel.className = 'input input--small';
      presetSel.title = 'ストックした系統プリセットをこの枠へ適用 (ラベル/色 + デザインを割当)';
      const ph = document.createElement('option');
      ph.value = ''; ph.textContent = 'プリセット適用…';
      presetSel.appendChild(ph);
      (App.telopPresets || []).forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.name;
        presetSel.appendChild(opt);
      });
      presetSel.addEventListener('change', () => {
        if (presetSel.value) this.applyPreset(presetSel.value, ch);
      });
      const savePreset = document.createElement('button');
      savePreset.className = 'btn btn--small';
      savePreset.textContent = '★ プリセット保存';
      savePreset.title = 'この枠の内容 (ラベル/色 + 割当デザイン) を系統プリセットとして保存';
      savePreset.addEventListener('click', () => this.saveSlotAsPreset(ch));

      const del = document.createElement('button');
      del.className = 'btn btn--small';
      del.textContent = '削除';
      del.title = 'チャンネルを削除 (このチャンネルのテンプレート/ページは送出できなくなります)';
      del.addEventListener('click', async () => {
        if (this.rows.length <= 1) {
          App.setStatus('最後のチャンネルは削除できません', 'error');
          return;
        }
        if (!(await AppModal.confirm('系統を削除', `系統「${ch.label}」を削除しますか?`, { danger: true, okLabel: '削除' }))) return;
        this.rows.splice(i, 1);
        this.render();
      });
      row.appendChild(color);
      row.appendChild(label);
      row.appendChild(region);
      row.appendChild(presetSel);
      row.appendChild(savePreset);
      row.appendChild(del);
      wrap.appendChild(row);
    });
    const add = document.createElement('button');
    add.className = 'btn btn--small';
    add.textContent = '＋チャンネル追加';
    add.addEventListener('click', async () => {
      const region = await AppModal.prompt('系統を追加', { placeholder: 'URL名 (半角英数, 例: tl3)' });
      if (!region) return;
      const slug = region.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!slug || this.rows.some((r) => r.region === slug)) {
        App.setStatus('URL名が不正か、すでに使われています', 'error');
        return;
      }
      const label = (await AppModal.prompt('表示名', { value: slug.toUpperCase(), message: '一覧に表示する名前 (例: TL3)' })) || slug;
      this.rows.push({ id: slug, label, region: slug, color: '#7c5cff' });
      this.render();
    });
    wrap.appendChild(add);
  },

  collect() {
    return JSON.parse(JSON.stringify(this.rows));
  },
};

/** 出力グループ (複数チャンネルを1URLへレイヤー合成) の設定UI */
const OutputGroupsUI = {
  rows: [],

  populate(groups) {
    this.rows = JSON.parse(JSON.stringify(Array.isArray(groups) ? groups : []));
    this.render();
  },

  render() {
    const wrap = document.getElementById('og-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    const channels = App.channels || [];
    this.rows.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'og-card';

      const head = document.createElement('div');
      head.className = 'og-head';
      const label = document.createElement('input');
      label.type = 'text';
      label.className = 'input input--small';
      label.value = g.label || '';
      label.placeholder = 'グループ名 (例: メイン)';
      label.maxLength = 20;
      label.addEventListener('change', () => { g.label = label.value.trim() || g.id; });
      const idInput = document.createElement('input');
      idInput.type = 'text';
      idInput.className = 'input input--small ch-region';
      idInput.value = g.id || '';
      idInput.placeholder = 'URL名';
      idInput.title = '出力URL: /output/jp/g/<この名前>。半角英数のみ';
      idInput.addEventListener('change', () => {
        g.id = idInput.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || g.id;
        idInput.value = g.id;
      });
      const del = document.createElement('button');
      del.className = 'btn btn--small';
      del.textContent = '削除';
      del.title = 'グループを削除';
      del.addEventListener('click', () => { this.rows.splice(i, 1); this.render(); });
      head.appendChild(label);
      head.appendChild(idInput);
      head.appendChild(del);
      card.appendChild(head);

      // チャンネル選択 (チェック=含める / 上下で重なり順=レイヤー順)
      g.channels = (g.channels || []).filter((cid) => channels.some((c) => c.region === cid));
      const selected = g.channels;
      const unselected = channels.filter((c) => !selected.includes(c.region)).map((c) => c.region);

      const list = document.createElement('div');
      list.className = 'og-channels';
      const hint = document.createElement('div');
      hint.className = 'settings-inline-hint';
      hint.textContent = '含めるチャンネル (上=背面 / 下=前面):';
      list.appendChild(hint);

      const renderChip = (region, isSel) => {
        const ch = channels.find((c) => c.region === region);
        const chip = document.createElement('div');
        chip.className = `og-chip${isSel ? ' sel' : ''}`;
        const dot = document.createElement('span');
        dot.className = 'og-chip-dot';
        dot.style.background = ch ? ch.color : '#888';
        chip.appendChild(dot);
        chip.appendChild(document.createTextNode(ch ? ch.label : region));
        if (isSel) {
          const up = document.createElement('button');
          up.className = 'og-chip-btn';
          up.textContent = '↑';
          up.title = '重なりを1つ背面へ (上=奥)';
          up.addEventListener('click', () => {
            const idx = selected.indexOf(region);
            if (idx > 0) { [selected[idx - 1], selected[idx]] = [selected[idx], selected[idx - 1]]; this.render(); }
          });
          const down = document.createElement('button');
          down.className = 'og-chip-btn';
          down.textContent = '↓';
          down.title = '重なりを1つ前面へ (下=手前)';
          down.addEventListener('click', () => {
            const idx = selected.indexOf(region);
            if (idx < selected.length - 1) { [selected[idx + 1], selected[idx]] = [selected[idx], selected[idx + 1]]; this.render(); }
          });
          const rm = document.createElement('button');
          rm.className = 'og-chip-btn';
          rm.textContent = '×';
          rm.title = 'このグループから外す';
          rm.addEventListener('click', () => { g.channels = selected.filter((r) => r !== region); this.render(); });
          chip.appendChild(up);
          chip.appendChild(down);
          chip.appendChild(rm);
        } else {
          const add = document.createElement('button');
          add.className = 'og-chip-btn';
          add.textContent = '＋';
          add.title = 'このグループに含める';
          add.addEventListener('click', () => { selected.push(region); this.render(); });
          chip.appendChild(add);
        }
        return chip;
      };

      selected.forEach((region) => list.appendChild(renderChip(region, true)));
      unselected.forEach((region) => list.appendChild(renderChip(region, false)));
      card.appendChild(list);
      wrap.appendChild(card);
    });

    const add = document.createElement('button');
    add.className = 'btn btn--small';
    add.textContent = '＋グループ追加';
    add.addEventListener('click', () => {
      const id = `g${this.rows.length + 1}`;
      this.rows.push({ id, label: `グループ${this.rows.length + 1}`, channels: [] });
      this.render();
    });
    wrap.appendChild(add);
  },

  collect() {
    return JSON.parse(JSON.stringify(this.rows));
  },
};

/** 系統プリセット (テロップ枠のストック) のライブラリ管理UI */
const TelopPresetsUI = {
  rows: [],

  populate(presets) {
    this.rows = JSON.parse(JSON.stringify(Array.isArray(presets) ? presets : []));
    this.render();
  },

  render() {
    const wrap = document.getElementById('tp-list');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (this.rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'og-empty';
      empty.textContent = 'プリセットはまだありません。系統の「★」で現在の枠を保存できます。';
      wrap.appendChild(empty);
    }
    this.rows.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'tp-row';
      const dot = document.createElement('span');
      dot.className = 'tp-dot';
      dot.style.background = p.color || '#4da3ff';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'input input--small';
      name.value = p.name || '';
      name.maxLength = 20;
      name.addEventListener('change', () => { p.name = name.value.trim() || p.id; });
      const meta = document.createElement('span');
      meta.className = 'tp-meta';
      meta.textContent = `デザイン${(p.templateKeys || []).length}件`;
      const del = document.createElement('button');
      del.className = 'btn btn--small';
      del.textContent = '削除';
      del.title = 'プリセットを削除';
      del.addEventListener('click', () => { this.rows.splice(i, 1); this.render(); });
      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(del);
      wrap.appendChild(row);
    });
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
    // ランダウン確定後にホーム画面を更新 (起動時ホームが最初に表示されるため)
    if (typeof HomeUI !== 'undefined') HomeUI.refresh();
  },

  populateFields(settings) {
    // 出力チャンネル (他モジュールより先に反映する)
    App.channels = (settings.channels && settings.channels.length) ? settings.channels : [
      { id: 'tl1', label: 'TL1', region: 'tl1', color: '#e8b93c' },
      { id: 'tl2', label: 'TL2', region: 'tl2', color: '#4da3ff' },
    ];
    // 系統プリセット (ChannelsUI のプリセット適用より先に反映)
    App.telopPresets = Array.isArray(settings.telopPresets) ? settings.telopPresets : [];
    TelopPresetsUI.populate(App.telopPresets);
    ChannelsUI.populate(App.channels);

    // 出力グループ (チャンネル確定後)
    App.outputGroups = Array.isArray(settings.outputGroups) ? settings.outputGroups : [];
    OutputGroupsUI.populate(App.outputGroups);

    // 操作設定 (誤操作防止)
    App.operation = settings.operation || { dblclickTake: true };
    const dblTake = document.getElementById('op-dbltake');
    if (dblTake) dblTake.checked = App.operation.dblclickTake !== false;

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
      App.outputGroups = settings.outputGroups || [];
      App.telopPresets = settings.telopPresets || [];
      App.operation = settings.operation || App.operation;
      TelopPresetsUI.populate(App.telopPresets);
      ChannelsUI.populate(App.channels);
      OutputGroupsUI.populate(App.outputGroups);
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
      telopPresets: TelopPresetsUI.collect(),
      outputGroups: OutputGroupsUI.collect(),
      operation: {
        dblclickTake: (() => {
          const el = document.getElementById('op-dbltake');
          return el ? el.checked : true;
        })(),
      },
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

/** 設定タブの左ナビ (セクション切替) */
const SettingsNav = {
  init() {
    document.querySelectorAll('#settings-nav .settings-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.show(btn.dataset.section));
    });
    this.show('output');
  },
  show(section) {
    document.querySelectorAll('#settings-nav .settings-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.section === section);
    });
    document.querySelectorAll('#tab-settings .settings-section').forEach((sec) => {
      sec.classList.toggle('active', sec.dataset.section === section);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => SettingsNav.init());
