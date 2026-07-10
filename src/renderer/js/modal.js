/**
 * アプリ内モーダル (OSネイティブの prompt/confirm を置き換える統一UI)
 *
 *   const name = await AppModal.prompt('番組を追加', { placeholder: '番組名' });
 *   const ok   = await AppModal.confirm('削除', '番組「x」を削除しますか?', { danger: true });
 *
 * prompt はキャンセル時 null、confirm はキャンセル時 false を返す。
 */
const AppModal = {
  _resolve: null,

  init() {
    const dlg = document.getElementById('app-modal');
    if (!dlg) return;
    document.getElementById('am-ok').addEventListener('click', () => this._finish(true));
    document.getElementById('am-cancel').addEventListener('click', () => this._finish(false));
    document.getElementById('am-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._finish(true); }
    });
    // Escや外側クリックで閉じられた場合もキャンセル扱いで解決する
    dlg.addEventListener('close', () => {
      if (this._resolve) { const r = this._resolve; this._resolve = null; r(this._mode === 'prompt' ? null : false); }
    });
  },

  _open(mode, title, message, opts) {
    const dlg = document.getElementById('app-modal');
    this._mode = mode;
    document.getElementById('am-title').textContent = title || '';
    const msg = document.getElementById('am-msg');
    msg.textContent = message || '';
    msg.classList.toggle('hidden', !message);
    const input = document.getElementById('am-input');
    input.classList.toggle('hidden', mode !== 'prompt');
    input.value = (opts && opts.value) || '';
    input.placeholder = (opts && opts.placeholder) || '';
    const ok = document.getElementById('am-ok');
    ok.textContent = (opts && opts.okLabel) || 'OK';
    ok.classList.toggle('btn--danger', !!(opts && opts.danger));
    return new Promise((resolve) => {
      this._resolve = resolve;
      dlg.showModal();
      if (mode === 'prompt') { input.focus(); input.select(); }
    });
  },

  _finish(ok) {
    const dlg = document.getElementById('app-modal');
    const r = this._resolve;
    this._resolve = null;
    if (dlg.open) dlg.close();
    if (!r) return;
    if (this._mode === 'prompt') {
      r(ok ? document.getElementById('am-input').value.trim() : null);
    } else {
      r(!!ok);
    }
  },

  /** 文字列入力。キャンセルで null */
  prompt(title, opts) {
    return this._open('prompt', title, opts && opts.message, opts);
  },

  /** はい/いいえ確認。キャンセルで false */
  confirm(title, message, opts) {
    return this._open('confirm', title, message, opts);
  },
};

document.addEventListener('DOMContentLoaded', () => AppModal.init());
