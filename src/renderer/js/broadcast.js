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
    const nameFirst = this.summarizeNames(page);
    if (nameFirst) return nameFirst;
    const texts = Object.entries(values)
      .filter(([k, v]) => v && /Jp$/i.test(k))
      .map(([, v]) => v);
    const joined = (texts.length ? texts : Object.values(values).filter(Boolean)).join(' / ');
    return joined.replace(/\n/g, ' ').slice(0, 60);
  },

  /**
   * 氏名テロップ (name-* テンプレート) の要約。人物ごとに「名前（肩書）」の順で並べる
   * (例: 見本 太郎（代表取締役） / 見本 花子（取締役）)。名前が1つも無ければ null
   */
  summarizeNames(page) {
    if (!String(page.templateKey || '').startsWith('name-')) return null;
    const values = page.values || {};
    const fields = App.nameFields || {};
    const bind = (prefix, kind) => {
      const slot = prefix ? `${prefix}${kind}Jp` : `${kind.toLowerCase()}Jp`;
      return fields[slot] || slot;
    };
    const clean = (v) => String(v || '').replace(/\n/g, ' ').trim();
    const prefixes = ['', '2nd', '3rd', '4th'];
    // 名前が1つも無い (肩書のみ等) ときは従来の要約
    if (!prefixes.some((p) => clean(values[bind(p, 'Name')]))) return null;
    const persons = prefixes.map((prefix) => {
      const name = clean(values[bind(prefix, 'Name')]);
      const title = clean(values[bind(prefix, 'Title')]);
      if (!name) return title;
      return title ? `${name}（${title}）` : name;
    }).filter(Boolean);
    return persons.join(' / ').slice(0, 60);
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

  /**
   * siblings の idx から dir 方向 (1=後ろ / -1=前) に、送出ロックされていない最初のページを探す
   * (idx 自身は含まない)。無ければ null
   */
  findUnlocked(siblings, idx, dir = 1) {
    for (let i = idx + dir; i >= 0 && i < siblings.length; i += dir) {
      if (!siblings[i].locked) return siblings[i];
    }
    return null;
  },

  /** TAKE/UPDATE後のNEXT: 同コーナー・同系統で、送出ロック中のページを飛ばした次のページ */
  nextAfter(corner, channelId, pageId) {
    if (corner.locked) return null;
    const siblings = this.channelPagesInCorner(corner, channelId);
    const idx = siblings.findIndex((pg) => pg.id === pageId);
    if (idx < 0) return null;
    const pg = this.findUnlocked(siblings, idx, 1);
    return pg ? pg.id : null;
  },

  /** TAKE/UPDATE後のNEXT。かるた取りの系統は次に出す札をその都度選ぶので空にする */
  nextAfterTake(corner, channelId, pageId) {
    if (App.sendMode(channelId) === 'karuta') return null;
    return this.nextAfter(corner, channelId, pageId);
  },

  /** オンエアを差し替える前に、直前のオンエアを覚えておく (かるた取りの CLEAR&BACK で戻る先) */
  rememberPrevOnAir(st, newPageId) {
    if (st.onAirPageId && st.onAirPageId !== newPageId) st.prevOnAirPageId = st.onAirPageId;
  },

  /**
   * ページの送出ロックを切り替えた後に呼ぶ。NEXTに入っているページをロックしたら、
   * ロック中のページを飛ばした次のページへNEXTを送る (GPIO/キーでのTAKEが止まって混乱しないように)
   */
  onPageLockChanged(page) {
    if (!page || !page.locked) return;
    const found = App.findPage(page.id);
    if (!found || found.list !== 'pages') return;
    const channelId = App.channelOfPage(page);
    if (!channelId) return;
    const st = App.chState(channelId);
    if (st.nextPageId !== page.id) return;
    st.nextPageId = this.nextAfter(found.corner, channelId, page.id);
    const next = st.nextPageId ? App.findPage(st.nextPageId) : null;
    App.setStatus(next ? `P${page.pageNo} をロックしたため、NEXTを P${next.page.pageNo} に送りました` : `P${page.pageNo} をロックしました (次のページがないためNEXTは空です)`);
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
    this.rememberPrevOnAir(st, page.id);
    st.onAirPageId = page.id;
    st.onAirSummary = detail;
    st.onAirAt = performance.now();

    // NEXTを同コーナー内・同チャンネルの次ページへ (送出ロック中のページは飛ばす)。かるた取りは進めない
    st.nextPageId = this.nextAfterTake(corner, channelId, page.id);

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
    this.rememberPrevOnAir(st, page.id);
    st.onAirPageId = page.id;
    st.onAirSummary = detail;
    st.onAirAt = performance.now();
    st.nextPageId = this.nextAfterTake(corner, channelId, page.id);

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

    // オンエア中ページの1つ前 (同コーナー・同系統) を探す。
    // かるた取りは並び順に意味がないので、直前にオンエアしていた札へ戻す
    let prev = null;
    const found = curId ? App.findPage(curId) : null;
    if (found && found.list === 'pages') {
      if (App.sendMode(channelId) === 'karuta') {
        const before = st.prevOnAirPageId ? App.findPage(st.prevOnAirPageId) : null;
        if (before && before.list === 'pages' && before.page.id !== curId
          && App.channelOfPage(before.page) === channelId) prev = before.page;
      } else {
        const siblings = this.channelPagesInCorner(found.corner, channelId);
        const idx = siblings.findIndex((pg) => pg.id === curId);
        if (idx > 0) prev = siblings[idx - 1];
      }
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
      this.rememberPrevOnAir(st, prev.id);
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
    // 送出ロック中のページは飛ばす (端まで無ければ動かさない)
    const dir = delta > 0 ? 1 : -1;
    const start = idx < 0 ? (dir > 0 ? -1 : siblings.length) : idx;
    let to = null;
    let pos = start;
    for (let n = 0; n < Math.abs(delta); n += 1) {
      const pg = this.findUnlocked(siblings, pos, dir);
      if (!pg) break;
      to = pg;
      pos = siblings.indexOf(pg);
    }
    if (!to) {
      App.setStatus(dir > 0 ? 'これより後に送出できるページはありません (ロック中は飛ばします)' : 'これより前に送出できるページはありません (ロック中は飛ばします)');
      return;
    }
    App.chState(channelId).nextPageId = to.id;
    App.setStatus(`NEXT: P${to.pageNo}`);
    this.notifyChanged();
  },

  /** 表示中コーナーの先頭ページをNEXTに */
  goTop(channelId) {
    const corner = (typeof RundownUI !== 'undefined' && RundownUI.currentCorner()) || App.corners()[0];
    if (!corner) return;
    const siblings = this.channelPagesInCorner(corner, channelId);
    const first = this.findUnlocked(siblings, -1, 1); // 送出ロック中のページは飛ばす
    if (!first) return;
    App.chState(channelId).nextPageId = first.id;
    App.setStatus(`NEXT: P${first.pageNo} (先頭)`);
    this.notifyChanged();
  },

  /** 表示中コーナーの最後のページをNEXTに (End キー) */
  goEnd(channelId) {
    const corner = (typeof RundownUI !== 'undefined' && RundownUI.currentCorner()) || App.corners()[0];
    if (!corner) return;
    const siblings = this.channelPagesInCorner(corner, channelId);
    const last = this.findUnlocked(siblings, siblings.length, -1); // 送出ロック中のページは飛ばす
    if (!last) return;
    App.chState(channelId).nextPageId = last.id;
    App.setStatus(`NEXT: P${last.pageNo} (末尾)`);
    this.notifyChanged();
  },

  // ===== NEXT出力 (?next=1) =====

  _nextSyncTimer: null,
  _lastNextJson: '',

  /** ページの送出内容 (出力ページが描画できる形) */
  pageContent(page) {
    if (page.kind === 'still') return { static: { kind: 'still', still: page.still } };
    if (page.kind === 'design') return { static: { kind: 'design', variant: (page.design && page.design.variant) || null } };
    return { templateKey: page.templateKey, values: page.values || {} };
  },

  /**
   * 各系統のNEXTのページ内容を出力サーバへ送る (NEXT出力URL用)。
   * NEXTの移動・ページの編集・2台運用の同期のたびに呼ばれるので、まとめて・変化したときだけ送る
   */
  syncNextOutput() {
    if (!window.api || !window.api.graphicsSetNext || this._nextSyncTimer) return;
    this._nextSyncTimer = setTimeout(() => {
      this._nextSyncTimer = null;
      const map = {};
      App.channels.forEach((ch) => {
        const found = this.nextPage(ch.id);
        map[ch.region] = found ? this.pageContent(found.page) : null;
      });
      const json = JSON.stringify(map);
      if (json === this._lastNextJson) return;
      this._lastNextJson = json;
      window.api.graphicsSetNext(map);
    }, 50);
  },

  // ===== UI通知 =====

  notifyChanged() {
    if (typeof RundownUI !== 'undefined') RundownUI.renderBroadcastState();
    this.updateGlobalOnAir();
    this.syncNextOutput();
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
