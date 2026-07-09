/**
 * ショットタイプ定義
 */
const SHOT_TYPES = {
  nameOnly: { label: '名前のみ', personCount: 1, hasTitle: false },
  '1S':     { label: '1S',       personCount: 1, hasTitle: true },
  '2S':     { label: '2S',       personCount: 2, hasTitle: true },
  '3S':     { label: '3S',       personCount: 3, hasTitle: true },
  '4S':     { label: '4S',       personCount: 4, hasTitle: true },
};

/**
 * グローバルアプリケーション状態
 */
const App = {
  // 名前プール (Excelインポート元): [{ titleJp, nameJp, titleEn, nameEn }, ...]
  namePool: [],
  // 名前テロップ スケジュール: [{ shotType, persons: [{ titleJp, nameJp, titleEn, nameEn }] }, ...]
  nameData: [],
  // サイドテロップデータ: [{ textJp, textEn }, ...]
  sideData: [],

  // 送出状態
  broadcast: {
    name: {
      mode: 'schedule',    // 'schedule' | 'karuta'
      currentIndex: 0,     // スケジュールモードの現在位置
      selectedIndex: -1,   // かるたモードの選択位置
      isOnAir: false,
      onAirIndex: -1,
      onAirShotType: null, // 現在ON AIR中のショットタイプ
    },
    side: {
      mode: 'schedule',
      currentIndex: 0,
      selectedIndex: -1,
      isOnAir: false,
      onAirIndex: -1,
    },
  },

  /**
   * ステータスバーにメッセージを表示
   */
  setStatus(message, type = 'info') {
    const el = document.getElementById('status-text');
    el.textContent = message;
    el.style.color = type === 'error' ? 'var(--red)' : type === 'success' ? 'var(--green)' : 'var(--text-muted)';
  },
};

// --- 終了時の確認 (送出中 / デザイン未保存) ---
let allowAppClose = false;
window.addEventListener('beforeunload', (e) => {
  if (allowAppClose) return;

  const reasons = [];
  if (App.broadcast.name.isOnAir || App.broadcast.side.isOnAir) {
    reasons.push('・テロップが送出中です (終了するとvMixの表示が消えます)');
  }
  if (typeof DesignEditor !== 'undefined' && DesignEditor.dirty) {
    reasons.push('・デザインに未保存の変更があります');
  }
  if (reasons.length === 0) return;

  // いったん終了をキャンセルし、確認してから閉じ直す
  e.preventDefault();
  e.returnValue = false;
  setTimeout(() => {
    if (confirm(`${reasons.join('\n')}\n\nこのまま終了しますか?`)) {
      allowAppClose = true;
      window.close();
    }
  }, 0);
});

// --- テンプレートダウンロード ---
document.getElementById('dl-template-name')?.addEventListener('click', async () => {
  const result = await window.api.downloadTemplate('name');
  if (result?.success) {
    App.setStatus('名前テロップテンプレートを保存しました', 'success');
  } else if (result?.error) {
    App.setStatus(`テンプレート保存エラー: ${result.error}`, 'error');
  }
});

document.getElementById('dl-template-side')?.addEventListener('click', async () => {
  const result = await window.api.downloadTemplate('side');
  if (result?.success) {
    App.setStatus('サイドテロップテンプレートを保存しました', 'success');
  } else if (result?.error) {
    App.setStatus(`テンプレート保存エラー: ${result.error}`, 'error');
  }
});
