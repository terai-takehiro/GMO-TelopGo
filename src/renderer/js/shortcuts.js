/**
 * アプリ全体のキーボードショートカット
 *
 *   - 一覧のデータ (設定 › キーボードショートカット / Ctrl+/ で重ねて表示)
 *   - 画面をまたぐ共通キー: 保存 (Ctrl+S)・画面切替 (Ctrl+1〜4)・設定 (Ctrl+,)・一覧 (Ctrl+/)
 *   - メニューから届く 再読み込みの確認 (Ctrl+Shift+F5) と 表示倍率 (Ctrl+＋/−/0)
 *
 * 送出画面のキーは RundownUI.onKeyDown、デザイン画面のキーは DesignEditor.onKeyDown にある。
 */
const Shortcuts = {
  STATUS: { old: '既存', new: 'NEW', ext: '拡張', chg: '変更' },

  /** [操作, キー ("/"区切りで別のキー、"+"で同時押し), 区分, 補足] */
  DATA: {
    common: [
      ['保存', 'Ctrl+S', 'new', 'デザイン・送出リスト・設定をすぐ保存 (送出リストの自動保存はそのまま)'],
      ['元に戻す', 'Ctrl+Z', 'ext', '送出リストのページ編集 (追加・削除・並べ替え・文字の修正など) にも対応。送出操作 (TAKE / CLEAR) は対象外'],
      ['やり直し', 'Ctrl+Y / Ctrl+Shift+Z', 'ext', '同上'],
      ['切り取り', 'Ctrl+X', 'old', 'ページ・レイヤー'],
      ['コピー', 'Ctrl+C', 'old', 'ページ・レイヤー'],
      ['貼り付け', 'Ctrl+V', 'old', '選択中の後ろへ'],
      ['複製', 'Ctrl+D', 'new', '送出リストのページをすぐ後ろへ複製 (デザインは Ctrl+J)'],
      ['削除', 'Delete', 'ext', '送出リストのページにも対応 (確認あり・送出中は不可)'],
      ['検索', 'Ctrl+F', 'new', '送出リストの検索欄へ'],
      ['名前を変更', 'F2', 'new', '送出リストはページのタイトル欄へ、デザインは選択中のレイヤー名'],
      ['画面の切替', 'Ctrl+1〜4', 'new', 'ホーム / 送出 / デザイン / 設定'],
      ['設定を開く', 'Ctrl+,', 'new', ''],
      ['ショートカット一覧', 'Ctrl+/', 'new', 'この一覧を重ねて表示'],
      ['ヘルプ', 'F1', 'old', ''],
      ['全画面', 'F11', 'old', ''],
      ['閉じる / 選択解除', 'Esc', 'old', ''],
      ['画面の再読み込み', 'Ctrl+Shift+F5', 'chg', '以前は Ctrl+R で確認なしに再読み込みされていた → 送出中の誤操作を防ぐため変更し、確認を出す'],
      ['画面の表示倍率', 'Ctrl+＋ / Ctrl+− / Ctrl+0', 'old', 'デザイン画面ではキャンバスの拡大・縮小 / 画面に合わせる'],
    ],
    onair: [
      ['TAKE', 'Space / Enter', 'old', 'キー操作の対象TL'],
      ['UPDATE', 'Ctrl+Enter', 'new', 'アニメーションなしで差し替え'],
      ['CLEAR', 'Ctrl+Backspace', 'old', ''],
      ['CLEAR&BACK', 'Ctrl+Shift+Backspace', 'old', 'かるた取りの列は、直前に出していた札へ戻す'],
      ['NEXTを上下に移動', '↑ / ↓', 'old', 'かるた取りの列では前後の札へ'],
      ['先頭 / 末尾をNEXTに', 'Home / End', 'new', ''],
      ['コーナー移動', '← / →', 'old', ''],
      ['キー操作するTLを切替', 'Alt+1〜9 / Ctrl+Tab', 'new', 'Ctrl+Shift+Tab で前のTL'],
      ['ダイレクト送出', '数字 → Enter', 'old', 'もう一度 Enter で TAKE'],
      ['送出ロック', 'Ctrl+L', 'new', '選択中のページ'],
      ['ページを追加', 'Ctrl+N', 'new', 'キー操作の対象TLへ (電テロは画像を選ぶ)'],
      ['放送を開く', 'Ctrl+O', 'new', '番組 → 放送の選択'],
      ['画像を編集', 'Ctrl+E', 'new', '電テロの静止画・作画ページ'],
      ['送出ボタンの表示切替', 'Ctrl+B', 'new', '「送出ボタンを隠す」と同じ'],
    ],
    design: [
      ['保存', 'Ctrl+S', 'new', '画像の編集中は「保存して送出リストへ戻る」'],
      ['デザインを書き出し', 'Ctrl+Shift+S', 'new', ''],
      ['PNG で保存', 'Ctrl+Shift+E', 'new', ''],
      ['元に戻す / やり直し', 'Ctrl+Z / Ctrl+Y', 'old', ''],
      ['切り取り / コピー / 貼り付け', 'Ctrl+X / Ctrl+C / Ctrl+V', 'old', ''],
      ['複製', 'Ctrl+J', 'old', ''],
      ['すべて選択 / 選択解除', 'Ctrl+A / Ctrl+D', 'old', ''],
      ['グループ化 / 解除', 'Ctrl+G / Ctrl+Shift+G', 'old', ''],
      ['前面へ / 背面へ', 'Ctrl+] / Ctrl+[', 'old', '最前面・最背面は Shift を併用'],
      ['1px / 10px 移動', '矢印 / Shift+矢印', 'old', ''],
      ['比率を保って拡大縮小', 'Shift+角をドラッグ', 'old', ''],
      ['削除', 'Delete', 'old', ''],
      ['名前を変更', 'F2', 'new', '選択中のレイヤー・グループ'],
      ['文字 / 図形を追加', 'T / U', 'new', ''],
      ['キャンバスの拡大 / 縮小', 'Ctrl+＋ / Ctrl+−', 'new', 'アプリ全体の表示倍率の代わりに'],
      ['画面に合わせる / 100%', 'Ctrl+0 / Ctrl+Alt+0', 'new', ''],
      ['手のひら (表示位置の移動)', 'Space+ドラッグ', 'new', ''],
      ['IN / OUT の試写', 'Ctrl+P / Ctrl+Shift+P', 'new', ''],
    ],
  },
  TABS: [['common', '共通'], ['onair', '送出'], ['design', 'デザイン・画像編集']],

  init() {
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    const dlg = document.getElementById('shortcut-dialog');
    if (dlg) {
      document.getElementById('shortcut-dialog-close').addEventListener('click', () => dlg.close());
      dlg.addEventListener('mousedown', (e) => { if (e.target === dlg) dlg.close(); });
    }
    this.renderInto(document.getElementById('sc-settings-body'), 'settings');
    if (window.api && window.api.onReloadRequest) window.api.onReloadRequest(() => this.confirmReload());
    if (window.api && window.api.onAppZoom) window.api.onAppZoom((cmd) => this.onAppZoom(cmd));
  },

  activeTab() {
    const el = document.querySelector('.tab-content.active');
    return el ? el.id.replace(/^tab-/, '') : '';
  },

  gotoTab(name) {
    const btn = document.querySelector(`.tab-btn[data-tab="${name}"]`);
    if (btn) btn.click();
  },

  onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const dialogOpen = !!document.querySelector('dialog[open]');
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    // 一覧 (Ctrl+/) はダイアログ表示中でも開閉できる
    if (key === '/' || e.code === 'Slash') {
      e.preventDefault();
      this.toggleDialog();
      return;
    }
    if (dialogOpen) return;

    if (key === 's' && !e.shiftKey) {
      e.preventDefault();
      this.save();
      return;
    }
    if (!e.shiftKey && /^[1-4]$/.test(e.key)) {
      e.preventDefault();
      this.gotoTab(['home', 'onair', 'design', 'settings'][Number(e.key) - 1]);
      return;
    }
    if (key === ',' && !e.shiftKey) {
      e.preventDefault();
      this.gotoTab('settings');
    }
  },

  /** Ctrl+S: 表示中の画面に応じて保存 (入力中の欄は確定してから) */
  async save() {
    const tab = this.activeTab();
    const el = document.activeElement;
    if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) el.blur(); // change を発火させて確定
    if (tab === 'design' && typeof DesignEditor !== 'undefined') {
      DesignEditor.commitFocusedInput();
      await DesignEditor.save();
    } else if (tab === 'settings' && typeof SettingsUI !== 'undefined') {
      await SettingsUI.save();
    } else if (App.rundown) {
      await App.flushRundown();
      App.setStatus('送出リストを保存しました', 'success');
    }
  },

  /** メニューの 表示倍率 (Ctrl+＋/−/0): デザイン画面ではキャンバス、ほかはアプリ全体 */
  onAppZoom(cmd) {
    if (this.activeTab() === 'design' && typeof DesignEditor !== 'undefined' && DesignEditor.loaded
      && !document.querySelector('dialog[open]')) {
      if (cmd === 'reset') DesignEditor.setZoomValue('fit');
      else DesignEditor.zoomStep(cmd === 'in' ? 1 : -1);
      return;
    }
    if (window.api && window.api.uiZoom) window.api.uiZoom(cmd);
  },

  /** 画面の再読み込み (Ctrl+Shift+F5): 送出中や未保存のデザインがあれば確認する */
  async confirmReload() {
    const reasons = [];
    if (App.anyOnAir()) reasons.push('・テロップが送出中です (出力はそのまま続きますが、送出画面の状態は読み込み直されます)');
    if (typeof DesignEditor !== 'undefined' && DesignEditor.dirty) reasons.push('・デザインに未保存の変更があります (破棄されます)');
    const msg = `${reasons.length ? `${reasons.join('\n')}\n\n` : ''}画面を再読み込みしますか?`;
    if (!(await AppModal.confirm('画面の再読み込み', msg, { danger: reasons.length > 0, okLabel: '再読み込み' }))) return;
    await App.flushRundown();
    allowAppClose = true; // 終了確認 (beforeunload) を出さない
    location.reload();
  },

  toggleDialog() {
    const dlg = document.getElementById('shortcut-dialog');
    if (!dlg) return;
    if (dlg.open) { dlg.close(); return; }
    if (document.querySelector('dialog[open]')) return; // ほかのダイアログの上には重ねない
    const tab = this.activeTab();
    this.renderInto(document.getElementById('shortcut-dialog-body'), 'dialog', tab === 'design' ? 'design' : tab === 'onair' ? 'onair' : 'common');
    dlg.showModal();
  },

  /** 一覧を描画 (タブ + 「追加・変更のみ」 + 表) */
  renderInto(container, id, initialTab) {
    if (!container) return;
    const state = this[`_state_${id}`] || { tab: initialTab || 'common', onlyNew: false };
    if (initialTab) state.tab = initialTab;
    this[`_state_${id}`] = state;
    container.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'sc-bar';
    const tabs = document.createElement('div');
    tabs.className = 'sc-tabs';
    tabs.setAttribute('role', 'tablist');
    this.TABS.forEach(([key, label]) => {
      const b = document.createElement('button');
      b.className = `sc-tab${state.tab === key ? ' active' : ''}`;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.tab === key ? 'true' : 'false');
      b.textContent = `${label} `;
      const n = document.createElement('span');
      n.className = 'sc-count';
      n.textContent = this.DATA[key].length;
      b.appendChild(n);
      b.addEventListener('click', () => { state.tab = key; this.renderInto(container, id); });
      tabs.appendChild(b);
    });
    const only = document.createElement('label');
    only.className = 'sc-only';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.onlyNew;
    cb.addEventListener('change', () => { state.onlyNew = cb.checked; this.renderInto(container, id); });
    only.append(cb, document.createTextNode(' 追加・変更のみ表示'));
    const legend = document.createElement('div');
    legend.className = 'sc-legend';
    Object.entries(this.STATUS).forEach(([k, label]) => {
      const st = document.createElement('span');
      st.className = `sc-st sc-st--${k}`;
      st.textContent = label;
      legend.appendChild(st);
    });
    bar.append(tabs, only, legend);
    container.appendChild(bar);

    const table = document.createElement('table');
    table.className = 'sc-table';
    const head = document.createElement('tr');
    ['操作', 'キー', '区分', '補足'].forEach((t) => {
      const th = document.createElement('th');
      th.textContent = t;
      head.appendChild(th);
    });
    table.appendChild(head);
    this.DATA[state.tab].filter((r) => !state.onlyNew || r[2] !== 'old').forEach(([act, keys, st, note]) => {
      const tr = document.createElement('tr');
      const tdAct = document.createElement('td');
      tdAct.className = 'sc-act';
      tdAct.textContent = act;
      const tdKeys = document.createElement('td');
      tdKeys.className = 'sc-keys';
      keys.split(' / ').forEach((combo, ci) => {
        if (ci > 0) {
          const sep = document.createElement('span');
          sep.className = 'sc-sep';
          sep.textContent = '/';
          tdKeys.appendChild(sep);
        }
        combo.split('+').forEach((k, ki) => {
          if (ki > 0) {
            const plus = document.createElement('span');
            plus.className = 'sc-sep';
            plus.textContent = '+';
            tdKeys.appendChild(plus);
          }
          const kbd = document.createElement('kbd');
          kbd.className = 'sc-kbd';
          kbd.textContent = k;
          tdKeys.appendChild(kbd);
        });
      });
      const tdSt = document.createElement('td');
      const stEl = document.createElement('span');
      stEl.className = `sc-st sc-st--${st}`;
      stEl.textContent = this.STATUS[st];
      tdSt.appendChild(stEl);
      const tdNote = document.createElement('td');
      tdNote.className = 'sc-note';
      tdNote.textContent = note;
      tr.append(tdAct, tdKeys, tdSt, tdNote);
      table.appendChild(tr);
    });
    container.appendChild(table);
  },
};

document.addEventListener('DOMContentLoaded', () => Shortcuts.init());
