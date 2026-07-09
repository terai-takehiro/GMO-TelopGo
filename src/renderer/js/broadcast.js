/**
 * 送出制御 - スケジュールモード / かるたモード
 */
const Broadcast = {
  init() {
    this.bindControls('name');
    this.bindControls('side');
  },

  bindControls(type) {
    const state = App.broadcast[type];

    // モード切替
    document.querySelectorAll(`input[name="${type}-mode"]`).forEach((radio) => {
      radio.addEventListener('change', () => {
        state.mode = radio.value;
        this.updateModeVisibility(type);
        this.reset(type);
      });
    });

    // 送出ボタン
    document.getElementById(`${type}-change`).addEventListener('click', () => this.doChange(type));
    document.getElementById(`${type}-take`).addEventListener('click', () => this.doTake(type));
    document.getElementById(`${type}-clear`).addEventListener('click', () => this.doClear(type));
  },

  getData(type) {
    return type === 'name' ? App.nameData : App.sideData;
  },

  getTelopModule(type) {
    return type === 'name' ? NameTelop : SideTelop;
  },

  /**
   * 現在選択されている項目のインデックスを取得
   */
  getActiveIndex(type) {
    const state = App.broadcast[type];
    return state.currentIndex;
  },

  /**
   * リスト行クリックで項目を選択 (スケジュール/かるた共通)
   */
  selectItem(type, index) {
    const state = App.broadcast[type];
    state.currentIndex = index;

    // かるたリストのハイライト更新
    if (state.mode === 'karuta') {
      const list = document.getElementById(`${type}-karuta-list`);
      list.querySelectorAll('.karuta-item').forEach((el) => el.classList.remove('selected'));
      const item = list.querySelector(`[data-index="${index}"]`);
      if (item) item.classList.add('selected');
    }

    // テーブル行のハイライト (NEXT=緑)
    this.highlightRows(type);
    this.updateInfo(type);
    this.updateButtons(type);
  },

  /**
   * 行のハイライト更新: ON AIR=赤, NEXT=緑
   */
  highlightRows(type) {
    const state = App.broadcast[type];
    const module = this.getTelopModule(type);
    const tbody = module.tbody;
    if (!tbody) return;

    const rows = tbody.querySelectorAll('tr');
    rows.forEach((r) => r.classList.remove('selected', 'on-air'));

    // ON AIR行: 赤
    if (state.isOnAir && state.onAirIndex >= 0 && state.onAirIndex < rows.length) {
      rows[state.onAirIndex].classList.add('on-air');
    }

    // NEXT行: 緑 (ON AIRと同じ行でなければ)
    const activeIdx = this.getActiveIndex(type);
    if (activeIdx >= 0 && activeIdx < rows.length && activeIdx !== state.onAirIndex) {
      rows[activeIdx].classList.add('selected');
    }
  },

  /**
   * モード切替時のUI表示更新
   */
  updateModeVisibility(type) {
    const state = App.broadcast[type];
    const karutaList = document.getElementById(`${type}-karuta-list`);

    if (state.mode === 'schedule') {
      karutaList.classList.add('hidden');
    } else {
      karutaList.classList.remove('hidden');
      this.renderKarutaList(type);
    }
  },

  /**
   * かるたリスト描画
   */
  renderKarutaList(type) {
    const list = document.getElementById(`${type}-karuta-list`);
    const data = this.getData(type);
    const state = App.broadcast[type];
    list.innerHTML = '';

    data.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'karuta-item';
      div.dataset.index = i;

      if (type === 'name') {
        const shotDef = SHOT_TYPES[item.shotType] || { label: item.shotType };
        const names = (item.persons || []).map(p => p.nameJp || '').filter(Boolean).join(' / ');
        div.textContent = `${i + 1}. [${shotDef.label}] ${names}`;
      } else {
        div.textContent = `${i + 1}. ${item.textJp || ''}`;
      }

      if (i === state.currentIndex) div.classList.add('selected');

      div.addEventListener('click', () => this.selectItem(type, i));
      list.appendChild(div);
    });
  },

  /**
   * 情報表示を更新 (ON AIR / NEXT の2段表示)
   */
  updateInfo(type) {
    const state = App.broadcast[type];
    const data = this.getData(type);

    const onairEl = document.getElementById(`${type}-onair`);
    const nextEl = document.getElementById(`${type}-next`);

    // ON AIR表示 (行との対応が失われても送出中であることは表示し続ける)
    if (state.isOnAir && state.onAirIndex >= 0 && state.onAirIndex < data.length) {
      onairEl.innerHTML = this.formatItemHtml(type, data[state.onAirIndex]);
    } else if (state.isOnAir) {
      onairEl.innerHTML = '<span class="info-person">(送出中)</span>';
    } else {
      onairEl.innerHTML = '<span class="info-empty">---</span>';
    }

    // NEXT表示
    const activeIdx = this.getActiveIndex(type);
    if (activeIdx >= 0 && activeIdx < data.length) {
      nextEl.innerHTML = this.formatItemHtml(type, data[activeIdx]);
    } else if (data.length > 0) {
      nextEl.innerHTML = '<span class="info-empty">(未選択 — 行をクリックで選択)</span>';
    } else {
      nextEl.innerHTML = '<span class="info-empty">---</span>';
    }

  },

  /**
   * 項目をHTML形式でフォーマット
   * name: ショットタイプ + 人名一覧 (例: "2S / 寺井 / 佐藤")
   * side: テキスト表示
   */
  formatItemHtml(type, item) {
    if (type === 'name') {
      const shotDef = SHOT_TYPES[item.shotType] || { label: item.shotType };
      const persons = item.persons || [];
      if (persons.length === 0) return '<span class="info-empty">(空)</span>';

      let html = `<span class="info-shot-label">${this.esc(shotDef.label)}</span>`;
      persons.forEach((p) => {
        const name = p.nameJp || '';
        const title = p.titleJp || '';
        if (name) {
          html += `<span class="info-person">${this.esc(name)}`;
          if (title) html += ` <small>(${this.esc(title)})</small>`;
          html += '</span>';
        }
      });
      return html || '<span class="info-empty">(空)</span>';
    }
    // サイドテロップ
    if (item.textJp) {
      return `<div class="info-field"><span class="info-field-label">テキスト</span><span class="info-field-value">${this.esc(item.textJp)}</span></div>`;
    }
    return '<span class="info-empty">(空)</span>';
  },

  esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  /**
   * ボタンの有効/無効を更新
   */
  updateButtons(type) {
    const state = App.broadcast[type];
    const data = this.getData(type);
    const activeIdx = this.getActiveIndex(type);
    const hasSelection = activeIdx >= 0 && activeIdx < data.length;

    document.getElementById(`${type}-change`).disabled = !hasSelection;
    document.getElementById(`${type}-take`).disabled = !hasSelection;
    document.getElementById(`${type}-clear`).disabled = !state.isOnAir;
    this.updateGlobalOnAir();
  },

  /** ステータスバーの送出状態表示 (全タブから見える) */
  updateGlobalOnAir() {
    const el = document.getElementById('status-onair');
    if (!el) return;
    const parts = [];
    if (App.broadcast.name.isOnAir) parts.push('名前');
    if (App.broadcast.side.isOnAir) parts.push('サイド');
    el.textContent = parts.length ? `ON AIR: ${parts.join('+')}` : 'ON AIR: なし';
    el.style.color = parts.length ? 'var(--red)' : '';
    el.style.fontWeight = parts.length ? '700' : '';
  },

  /**
   * 並び替え後の状態追従: ON AIR / NEXT が同じ項目を指し続けるようインデックスを補正
   * @param {number[]} newOrder - 新順序での旧インデックス配列 (newOrder[newIdx] = oldIdx)
   */
  remapAfterReorder(type, newOrder) {
    const state = App.broadcast[type];
    if (state.onAirIndex >= 0) {
      state.onAirIndex = newOrder.indexOf(state.onAirIndex);
    }
    if (state.currentIndex >= 0) {
      state.currentIndex = newOrder.indexOf(state.currentIndex);
    }
    this.highlightRows(type);
    this.updateInfo(type);
    this.updateButtons(type);
    if (state.mode === 'karuta') {
      this.renderKarutaList(type);
    }
  },

  /**
   * 選択状態リセット (データ変更・モード切替時)
   *
   * 実際の出力は消えていないため、送出状態 (isOnAir / onAirShotType) は保持する。
   * 行との対応 (onAirIndex) だけ無効化し、CLEARは引き続き押せる。
   */
  reset(type) {
    const state = App.broadcast[type];
    state.currentIndex = -1;
    state.onAirIndex = -1;
    this.updateInfo(type);
    this.updateButtons(type);
    this.highlightRows(type);
    if (state.mode === 'karuta') {
      this.renderKarutaList(type);
    }
  },

  // --- API呼び出し ---

  async doChange(type) {
    // リモート連携時: 出力担当でなければ担当PCへコマンドを委譲
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('change', type);
    }
    const state = App.broadcast[type];
    const data = this.getData(type);
    const idx = this.getActiveIndex(type);
    if (idx < 0 || idx >= data.length) return;

    App.setStatus('CHANGE 送信中...');
    // CHANGE = アニメーションなしの即時差し替え
    const result = await window.api.graphicsChange(type, data[idx]);
    if (result.ok) {
      // NEXTをON AIRに繰り上げ
      state.isOnAir = true;
      state.onAirIndex = idx;
      if (type === 'name') {
        state.onAirShotType = data[idx].shotType;
      }

      // スケジュールモード: 次の項目があれば進む、なければNEXTを空に
      if (state.mode === 'schedule') {
        if (state.currentIndex < data.length - 1) {
          state.currentIndex++;
        } else {
          state.currentIndex = -1;
        }
      }

      this.highlightRows(type);
      this.updateInfo(type);
      this.updateButtons(type);
      App.setStatus('CHANGE 完了', 'success');
    } else {
      App.setStatus(`CHANGE エラー: ${result.error || result.status}`, 'error');
    }
    return result;
  },

  async doTake(type) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('take', type);
    }
    const state = App.broadcast[type];
    const data = this.getData(type);
    const idx = this.getActiveIndex(type);
    if (idx < 0 || idx >= data.length) return;

    const item = data[idx];

    App.setStatus('TAKE 送信中...');
    // ローカルエンジンはテンプレート差し替えを一括処理する (旧ショットのCLEARは不要)
    const result = await window.api.graphicsTake(type, item);
    if (result.ok) {
      state.isOnAir = true;
      state.onAirIndex = idx;
      if (type === 'name') {
        state.onAirShotType = item.shotType;
      }
      this.highlightRows(type);
      this.updateInfo(type);
      this.updateButtons(type);

      // スケジュールモード: 次へ進む
      if (state.mode === 'schedule') {
        if (state.currentIndex < data.length - 1) {
          state.currentIndex++;
        } else {
          state.currentIndex = -1;
        }
        this.highlightRows(type);
        this.updateInfo(type);
      }

      App.setStatus('TAKE 完了 - ON AIR', 'success');
    } else {
      App.setStatus(`TAKE エラー: ${result.error || result.status}`, 'error');
    }
  },

  async doClear(type) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('clear', type);
    }
    const state = App.broadcast[type];

    App.setStatus('CLEAR 送信中...');
    const result = await window.api.graphicsClear(type);

    if (result.ok) {
      state.isOnAir = false;
      state.onAirIndex = -1;
      if (type === 'name') {
        state.onAirShotType = null;
      }
      this.highlightRows(type);
      this.updateInfo(type);
      this.updateButtons(type);
      App.setStatus('CLEAR 完了', 'success');
    } else {
      App.setStatus(`CLEAR エラー: ${result.error || result.status}`, 'error');
    }
  },

};

document.addEventListener('DOMContentLoaded', () => Broadcast.init());
