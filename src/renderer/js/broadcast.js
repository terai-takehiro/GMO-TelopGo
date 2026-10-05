/**
 * 送出エンジン (v2.0 ページベース)
 *
 * チャンネルごとに ON AIR / NEXT のページポインタを持ち、
 * TELOP BOX流の動詞で操作する:
 *   TAKE   = NEXTをINアニメ付きで送出し、同コーナー内の次ページへNEXTを進める
 *   UPDATE = NEXTをアニメなしで即時差し替え (旧CHANGE)
 *   CLEAR  = OUTアニメで消去
 *   STOP   = 再生中アニメの一時停止/再開
 *   SKIP / BACK / TOP = NEXTポインタの移動
 *
 * 2台運用時は出力担当でないPCから操作するとコマンドが担当PCへ委譲される。
 * リハーサルモード中は出力サーバへ送らない (UI上の状態遷移のみ)。
 */
const Broadcast = {
  /** ページの内容要約 (ログ・表示用)。タイトルがあれば優先 */
  summarize(page) {
    if (page.title) return page.title;
    if (page.kind === 'still') return (page.still && page.still.file) || '(静止画)';
    if (page.kind === 'design') return '(作画)';
    const values = page.values || {};
    const texts = Object.entries(values)
      .filter(([k, v]) => v && /Jp$/i.test(k))
      .map(([, v]) => v);
    const joined = (texts.length ? texts : Object.values(values).filter(Boolean)).join(' / ');
    return joined.replace(/\n/g, ' ').slice(0, 60);
  },

  /**
   * ページの送出内容を出力サーバへ送る (種別で分岐)。
   *   cg              → graphicsTake(templateKey, values)  (リアルタイムCG)
   *   still / design  → graphicsTakeStatic({region, kind, still|variant})  (電テロ静的送出)
   * @returns {Promise<{ok, error?}>}
   */
  async sendPage(page, animate, detail) {
    if (page.kind === 'still' || page.kind === 'design') {
      const channel = App.channelById(App.channelOfPage(page));
      if (!channel) return { ok: false, error: '出力先の系統が見つかりません' };
      const payload = { region: channel.region, kind: page.kind };
      if (page.kind === 'still') payload.still = page.still;
      else payload.variant = (page.design && page.design.variant) || null;
      return window.api.graphicsTakeStatic(payload, animate, detail);
    }
    return window.api.graphicsTake(page.templateKey, page.values, animate, detail);
  },

  /** コーナー内で同チャンネルのページ一覧 (プレイリストのみ) */
  channelPagesInCorner(corner, channelId) {
    return (corner.pages || []).filter((pg) => App.channelOfPage(pg) === channelId);
  },

  /** NEXTをページIDで設定 */
  setNext(pageId) {
    const found = App.findPage(pageId);
    if (!found) return;
    const channelId = App.channelOfPage(found.page);
    if (!channelId) return;
    App.chState(channelId).nextPageId = pageId;
    this.notifyChanged();
  },

  clearNext(channelId) {
    App.chState(channelId).nextPageId = null;
    this.notifyChanged();
  },

  /** NEXT対象ページ (無ければnull) */
  nextPage(channelId) {
    const st = App.chState(channelId);
    if (!st.nextPageId) return null;
    const found = App.findPage(st.nextPageId);
    return found ? found : null;
  },

  // ===== 動詞 =====

  async doTake(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      if (typeof RundownUI !== 'undefined' && RundownUI.afterTake) RundownUI.afterTake();
      return RemoteSync.sendCommand('take', channelId);
    }
    const found = this.nextPage(channelId);
    if (!found) {
      App.setStatus('NEXTが未設定です (行をクリックで選択)', 'error');
      return;
    }
    const { page, corner } = found;
    if (page.locked || corner.locked) {
      App.setStatus(`ページ${page.pageNo} はロック中のため送出できません`, 'error');
      return;
    }

    const detail = `P${page.pageNo} ${this.summarize(page)}`;
    if (!App.rehearsal) {
      const result = await this.sendPage(page, true, detail);
      if (!result.ok) {
        App.setStatus(`TAKE エラー: ${result.error}`, 'error');
        return;
      }
    }

    const st = App.chState(channelId);
    st.onAirPageId = page.id;
    st.onAirSummary = detail;
    st.onAirAt = performance.now();

    // NEXTを同コーナー内・同チャンネルの次ページへ
    const siblings = this.channelPagesInCorner(corner, channelId);
    const idx = siblings.findIndex((pg) => pg.id === page.id);
    st.nextPageId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null;

    App.setStatus(`${App.rehearsal ? '[リハーサル] ' : ''}TAKE 完了 — P${page.pageNo} ON AIR`, 'success');
    this.notifyChanged();
    if (typeof RundownUI !== 'undefined' && RundownUI.afterTake) RundownUI.afterTake();
  },

  /** UPDATE: NEXTをアニメなしで即時差し替え (旧CHANGE) */
  async doUpdate(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('update', channelId);
    }
    const found = this.nextPage(channelId);
    if (!found) {
      App.setStatus('NEXTが未設定です (行をクリックで選択)', 'error');
      return;
    }
    const { page, corner } = found;
    if (page.locked || corner.locked) {
      App.setStatus(`ページ${page.pageNo} はロック中のため送出できません`, 'error');
      return;
    }

    const detail = `P${page.pageNo} ${this.summarize(page)}`;
    if (!App.rehearsal) {
      const result = await this.sendPage(page, false, detail);
      if (!result.ok) {
        App.setStatus(`UPDATE エラー: ${result.error}`, 'error');
        return;
      }
    }

    const st = App.chState(channelId);
    st.onAirPageId = page.id;
    st.onAirSummary = detail;
    st.onAirAt = performance.now();
    const siblings = this.channelPagesInCorner(corner, channelId);
    const idx = siblings.findIndex((pg) => pg.id === page.id);
    st.nextPageId = idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1].id : null;

    App.setStatus(`${App.rehearsal ? '[リハーサル] ' : ''}UPDATE 完了 — P${page.pageNo}`, 'success');
    this.notifyChanged();
  },

  /** オンエア中ページの現在の編集内容を出力へ反映 (オンエア差し替え) */
  async applyOnAirEdit(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('apply-edit', channelId);
    }
    const st = App.chState(channelId);
    if (!st.onAirPageId) return;
    const found = App.findPage(st.onAirPageId);
    if (!found) return;
    const detail = `P${found.page.pageNo} ${this.summarize(found.page)} (訂正)`;
    if (!App.rehearsal) {
      const result = await this.sendPage(found.page, false, detail);
      if (!result.ok) {
        App.setStatus(`反映エラー: ${result.error}`, 'error');
        return;
      }
    }
    st.onAirSummary = detail;
    App.setStatus('オンエア中のテロップへ反映しました', 'success');
    this.notifyChanged();
  },

  async doClear(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('clear', channelId);
    }
    const channel = App.channelById(channelId);
    if (!channel) return;

    if (!App.rehearsal) {
      const result = await window.api.graphicsClear(channel.region, `${channel.label}`);
      if (!result.ok) {
        App.setStatus(`CLEAR エラー: ${result.error}`, 'error');
        return;
      }
    }
    const st = App.chState(channelId);
    st.onAirPageId = null;
    st.onAirSummary = '';
    st.onAirAt = 0;
    App.setStatus(`${App.rehearsal ? '[リハーサル] ' : ''}CLEAR 完了 (${channel.label})`, 'success');
    this.notifyChanged();
  },

  /**
   * CLEAR&BACK: オンエア中を消して1つ前のページを即表示する (誤送出のリカバリー)。
   * 前のページが無い場合は通常のCLEARになる。NEXTは消したページへ戻す。
   */
  async doClearBack(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('clearback', channelId);
    }
    const channel = App.channelById(channelId);
    if (!channel) return;
    const st = App.chState(channelId);
    const curId = st.onAirPageId;

    // オンエア中ページの1つ前 (同コーナー・同系統) を探す
    let prev = null;
    const found = curId ? App.findPage(curId) : null;
    if (found && found.list === 'pages') {
      const siblings = this.channelPagesInCorner(found.corner, channelId);
      const idx = siblings.findIndex((pg) => pg.id === curId);
      if (idx > 0) prev = siblings[idx - 1];
    }

    if (prev) {
      const detail = `P${prev.pageNo} ${this.summarize(prev)} (C&B)`;
      if (!App.rehearsal) {
        const result = await this.sendPage(prev, false, detail);
        if (!result.ok) {
          App.setStatus(`CLEAR&BACK エラー: ${result.error}`, 'error');
          return;
        }
      }
      st.onAirPageId = prev.id;
      st.onAirSummary = detail;
      st.onAirAt = performance.now();
      st.nextPageId = curId; // 消したページをNEXTへ戻す (やり直しできる)
      App.setStatus(`${App.rehearsal ? '[リハーサル] ' : ''}CLEAR&BACK — P${prev.pageNo} に戻しました`, 'success');
      this.notifyChanged();
    } else {
      // 前のページが無い → 通常CLEAR
      await this.doClear(channelId);
    }
  },

  async doStop(channelId) {
    if (typeof RemoteSync !== 'undefined' && RemoteSync.shouldDelegate()) {
      return RemoteSync.sendCommand('stop', channelId);
    }
    const channel = App.channelById(channelId);
    if (!channel || App.rehearsal) return;
    await window.api.graphicsStop(channel.region);
    App.setStatus(`STOP (${channel.label}) — アニメーションを一時停止/再開`);
  },

  // ===== NEXTポインタ移動 (SKIP / BACK / TOP) =====

  /** 現在の基準ページ (NEXT優先、無ければON AIR) の同チャンネル兄弟リストと位置 */
  _cursor(channelId) {
    const st = App.chState(channelId);
    const baseId = st.nextPageId || st.onAirPageId;
    if (baseId) {
      const found = App.findPage(baseId);
      if (found && found.list === 'pages') {
        const siblings = this.channelPagesInCorner(found.corner, channelId);
        return { siblings, idx: siblings.findIndex((pg) => pg.id === baseId), corner: found.corner };
      }
    }
    // 基準なし: 表示中コーナー (RundownUI) の先頭
    const corner = (typeof RundownUI !== 'undefined' && RundownUI.currentCorner()) || App.corners()[0];
    if (!corner) return { siblings: [], idx: -1, corner: null };
    return { siblings: this.channelPagesInCorner(corner, channelId), idx: -1, corner };
  },

  moveNext(channelId, delta) {
    const { siblings, idx } = this._cursor(channelId);
    if (siblings.length === 0) return;
    let to;
    if (idx < 0) {
      to = delta > 0 ? 0 : siblings.length - 1;
    } else {
      to = Math.max(0, Math.min(siblings.length - 1, idx + delta));
    }
    App.chState(channelId).nextPageId = siblings[to].id;
    App.setStatus(`NEXT: P${siblings[to].pageNo}`);
    this.notifyChanged();
  },

  /** 表示中コーナーの先頭ページをNEXTに */
  goTop(channelId) {
    const corner = (typeof RundownUI !== 'undefined' && RundownUI.currentCorner()) || App.corners()[0];
    if (!corner) return;
    const siblings = this.channelPagesInCorner(corner, channelId);
    if (siblings.length === 0) return;
    App.chState(channelId).nextPageId = siblings[0].id;
    App.setStatus(`NEXT: P${siblings[0].pageNo} (先頭)`);
    this.notifyChanged();
  },

  // ===== UI通知 =====

  notifyChanged() {
    if (typeof RundownUI !== 'undefined') RundownUI.renderBroadcastState();
    this.updateGlobalOnAir();
  },

  /** ステータスバーの送出状態表示 (全タブから見える) */
  updateGlobalOnAir() {
    const el = document.getElementById('status-onair');
    if (!el) return;
    const parts = [];
    App.channels.forEach((ch) => {
      const st = App.broadcast[ch.id];
      if (st && st.onAirPageId) {
        const found = App.findPage(st.onAirPageId);
        parts.push(found ? `${ch.label} P${found.page.pageNo}` : ch.label);
      }
    });
    el.textContent = parts.length ? `ON AIR: ${parts.join(' + ')}` : 'ON AIR: なし';
    el.style.color = parts.length ? 'var(--red)' : '';
    el.style.fontWeight = parts.length ? '700' : '';
  },
};
