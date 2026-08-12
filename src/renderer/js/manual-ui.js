/**
 * アプリ内マニュアル (モダンUI)
 *
 * 左の節ナビ + 右の本文の2ペイン。節データ (SECTIONS) を描画する。
 * docs/ の内容 (インストール/リモート運用/デザイン) を取り込みつつ、
 * アプリの実操作 (リアルタイムCG / 電テロ / 送出操作 / ショートカット) を網羅する。
 */
const ManualUI = {
  _rendered: false,
  _active: null,

  SECTIONS: [
    {
      id: 'intro', title: 'はじめに', html: `
        <h2 class="manual-h2">GMO TelopGo とは</h2>
        <p class="manual-p">放送・配信向けのHTML5テロップ送出システムです。透過1920×1080の出力ページをvMix等のブラウザ入力で取り込み、テロップをリアルタイムに送出します。</p>
        <div class="manual-cards">
          <div class="manual-tile"><div class="manual-tile-h">📺 リアルタイムCGモード</div><p>Excelで文字リストを用意し、テンプレートに<b>変数として代入</b>して送出。名前スーパーやサイドテロップなど、同じ体裁で内容だけ差し替える運用に最適。</p></div>
          <div class="manual-tile"><div class="manual-tile-h">🖼 電テロモード</div><p>アプリ内で作画した1枚絵や、別ソフトで作った<b>静止画ファイルを並べて静的に送出</b>。ドラッグ&ドロップで画像を流し込めます。</p></div>
        </div>
        <div class="manual-tip">💡 モードは<b>ホーム画面で選びます</b>。起動後ホームで「リアルタイムCG送出」または「電テロ送出」を選ぶと、<b>番組 → 放送(日付) を選ぶ画面</b>が出て、決定すると送出画面に入ります。モードごとに番組・放送・コーナーは独立しています。</div>`,
    },
    {
      id: 'screen', title: '画面の見方', html: `
        <h2 class="manual-h2">タブ構成</h2>
        <ul class="manual-list">
          <li><b>ホーム</b> — 送出モードの選択 (リアルタイムCG / 電テロ) と各機能への入口・サーバ状況</li>
          <li><b>送出</b> — 本番のランダウン操作画面 (リアルタイムCG / 電テロ)。モード選択後に<b>番組→放送(日付)を選んで</b>入る</li>
          <li><b>スポーツ</b> — スポーツシーン・コンポーザー。野球コンソール + オンエアウィンドウを自分で配置してライブ操作</li>
          <li><b>デザイン</b> — テロップのテンプレート作画</li>
          <li><b>マニュアル</b> — このページ</li>
          <li><b>設定</b> — 出力チャンネル・出力グループ・サーバ・GPIO・連携</li>
        </ul>
        <h2 class="manual-h2">送出タブのレイアウト</h2>
        <ul class="manual-list">
          <li><b>左レール</b>: コーナー一覧 (並び順=送出順、送出進捗を表示)。右クリックで改名/色/ロック/オートフォロー</li>
          <li><b>中央</b>: TL1/TL2…の<b>系統ごとの列がそのままコンソール</b>。各列の上部に <b>OA|NEXT</b> のミニモニター、下部にその系統専用の送出ボタン一式 (TOP/BACK/SKIP/STOP/UPDATE/CLEAR/CLEAR&BACK) と大型<b>TAKE</b>。ツールバーの🔎でページ検索、「モニタ背景」で黒/市松/白/任意画像 (透過の確認用) に変更可</li>
          <li><b>右ペイン</b>: ページエディタ (選択ページの内容編集専用)</li>
        </ul>
        <div class="manual-tip">状態色: <span class="manual-swatch onair"></span>赤=ON AIR / <span class="manual-swatch next"></span>アンバー=NEXT / グレー=送出済み</div>`,
    },
    {
      id: 'cg', title: 'リアルタイムCGモード', html: `
        <h2 class="manual-h2">テンプレート + 値の考え方</h2>
        <p class="manual-p">ページ = テンプレート + 値。デザインタブで作ったテンプレートの文字フィールド (binding) に、放送で使う文字を入れて送出します。</p>
        <ol class="manual-steps">
          <li>コーナーの列ヘッダの「＋」でページを追加し、テンプレートを選ぶ</li>
          <li>右ペインのページエディタで文字フィールドを入力</li>
          <li>ページをクリックして<b>NEXT</b>にセット</li>
          <li><b>TAKE</b> でON AIRへ送出 (INアニメ付き)</li>
        </ol>
        <h2 class="manual-h2">Excelから一括取込</h2>
        <p class="manual-p">「Excel取込」からテンプレートを選ぶと、その列順 (フィールド順) で行を読み込み、1行=1ページとして一括作成します。「名前テンプレDL」等で列見本を出力できます。</p>`,
    },
    {
      id: 'telop', title: '電テロモード', html: `
        <h2 class="manual-h2">静的テロップの送出</h2>
        <p class="manual-p">自由に作画した1枚絵や、別ソフトの静止画を並べて静的に送出するモードです。</p>
        <ol class="manual-steps">
          <li>ホームで<b>「電テロ送出」</b>を選ぶ (ツールバーに「電テロ送出」バッジが表示)</li>
          <li>列の「＋」→ <b>デザインから</b> (アプリ内の作画を選択) または <b>静止画ファイル</b> を選ぶ</li>
          <li>あるいは列へ<b>画像ファイルをドラッグ&ドロップ</b>して直接取り込む</li>
          <li>ページをNEXTにして <b>TAKE</b> で送出</li>
        </ol>
        <div class="manual-tip">💡「デザインから」追加した作画は<b>固定コピー</b>されます。以後テンプレートを編集しても、送出リスト上の絵柄は変わりません。</div>
        <div class="manual-tip">🖼 静止画の<b>表示方法</b>は右ペインで選べます: 全体表示(contain) / 画面いっぱい(cover) / 引き伸ばし(fill)。対応形式: PNG / JPG / WebP / GIF / SVG。</div>`,
    },
    {
      id: 'sports', title: 'スポーツ送出', html: `
        <h2 class="manual-h2">スポーツシーン・コンポーザーとは</h2>
        <p class="manual-p">試合中のスコア・カウント・走者・選手紹介などを専用の操作盤でライブ操作し、ON AIR中の表示へ<b>再テイクなし・アニメなしで即時反映</b>し続ける機能です。値の更新は画面を作り直さず文字だけを差し替えるため、毎秒動く時計でもちらつきません。</p>
        <p class="manual-p">v2.9 からは、固定レイアウトを送るのではなく、<b>スコアボード / BSO / 走者 / 得点(大) / タイトル / 選手紹介</b> をそれぞれ<b>独立したオンエア・ウィンドウ</b>として扱います。各ウィンドウは個別に <b>ON AIR / OFF</b> でき、<b>プレビュー上でドラッグして位置・サイズを自由に組める</b>ため、番組ごとに自分の中継レイアウトを作れます。</p>
        <ol class="manual-steps">
          <li>ホームで<b>「🏆 スポーツ送出」</b>を選び、番組 → 試合(放送) を選択</li>
          <li>競技で<b>「野球 (コンソール)」</b>を選ぶ (汎用/セット制は下部の簡易バーで送出)</li>
          <li>大会名・試合名・チーム短縮名・打順表を入力</li>
          <li>右下<b>「オンエアウィンドウ」</b>で出したい要素の <b>ON AIR</b> を押す → その要素だけが出力に重畳表示</li>
          <li><b>「位置・サイズ」</b>を押し、プレビュー上で枠をドラッグ (角をドラッグで拡縮/数値入力も可) して配置</li>
          <li>以後、得点・BSO・走者・イニングの操作がそのままON AIRの各ウィンドウへ反映されます</li>
        </ol>
        <h2 class="manual-h2">野球コンソール</h2>
        <ul class="manual-list">
          <li><b>イニング別得点表</b>: 各回のマスを左クリックで+1 / 右クリックで−1。R (合計) は自動集計</li>
          <li><b>得点 (現イニング)</b>: <b>＋ / −</b> で、いま攻撃中の回・チームの升へ加点</li>
          <li><b>BSO</b>: BALL/STRIKE/OUT のクリックで自動巡回 (四球・三振でカウントリセット、スリーアウトで自動チェンジ)。「打者交代」でB/Sのみクリア</li>
          <li><b>走者ダイヤ</b>: 塁をクリックでトグル、「全走者クリア」で一括解除</li>
          <li><b>打順表</b>: 選手追加、名前/背番号は直接編集、守備位置はクリックで巡回。行の<b>「選手」</b>ボタンで選手紹介テロップを送出 (その打者を現打者に設定)</li>
          <li><b>チェンジ / イニング進める・戻す</b>: 表↔裏・回の手動操作</li>
        </ul>
        <h2 class="manual-h2">オンエアウィンドウと位置・サイズ</h2>
        <p class="manual-p">各ウィンドウは出力上で <b>1つの独立した重畳レイヤー (region)</b> です。合成URL <code>/output/jp</code> は ON AIR 中の全ウィンドウを重ねて表示します。</p>
        <ul class="manual-list">
          <li><b>ON AIR トグル</b>: 押すとそのウィンドウを送出 (もう一度で消去)。位置・サイズは記憶され、次回ON AIR時も復元</li>
          <li><b>位置・サイズ</b>: プレビューを重ねたステージで半透明の枠をドラッグ。角のハンドルで拡大縮小。X/Y/サイズ% の数値入力も併設 (10px スナップ)</li>
          <li>配置は試合(放送)ごとに保存され、2台運用でも同期されます</li>
        </ul>
        <h2 class="manual-h2">独自ウィンドウの作り方 (binding規約)</h2>
        <p class="manual-p">デザインタブでテキストレイヤーのbindingに以下の名前を付ければ、自作テンプレートを操作盤のウィンドウから流し込めます (使う項目だけでOK):</p>
        <table class="manual-kbd">
          <tr><th>ウィンドウ</th><th>binding</th></tr>
          <tr><td>スコアボード</td><td>homeShort/awayShort, home1..home9, away1..away9, homeR/awayR, status</td></tr>
          <tr><td>BSO</td><td>balls / strikes / outs (「●●○」等)</td></tr>
          <tr><td>走者</td><td>base1 / base2 / base3 (◆=走者あり / ◇=なし)</td></tr>
          <tr><td>得点(大)</td><td>homeShort/awayShort, homeScore/awayScore, status, title</td></tr>
          <tr><td>タイトル</td><td>title / sub</td></tr>
          <tr><td>選手紹介</td><td>pOrder / pPos / pNo / pName</td></tr>
          <tr><td>汎用バー</td><td>homeName/awayName, homeScore/awayScore, period, clock, homeSets/awaySets</td></tr>
        </table>
        <div class="manual-tip">💡 2台運用時: 試合状態・ウィンドウ配置は両PCに同期されますが、スポーツの操作は<b>出力担当PC上で</b>行ってください (コマンド委譲は今後対応)。</div>`,
    },
    {
      id: 'design', title: 'デザインエディタ', html: `
        <h2 class="manual-h2">テンプレートの作画</h2>
        <p class="manual-p">テロップの体裁 (座布団・文字・画像・アニメーション) を作ります。作ったテンプレートは送出タブのページや電テロの作画元になります。</p>
        <ul class="manual-list">
          <li><b>レイヤー</b>: 図形(rect/円/多角形/星)・テキスト・画像を配置</li>
          <li><b>テキスト</b>: フォント・縁取り・縦書き・縦中横・ルビ・自動調整 (字詰め/長体/縮小) など</li>
          <li><b>チャンネル</b>: テンプレート追加時に出力系統を指定</li>
          <li><b>アニメーション</b>: IN/OUTのプリセット (フェード/スライド/ズーム等)</li>
        </ul>
        <h2 class="manual-h2">自動字詰め (テキストの自動調整)</h2>
        <p class="manual-p">テキストの「自動調整」を<b>字詰め</b>にすると、枠に対して<b>字数が少ないときは字間を広げ</b> (上限あり — 均等割付のように端まで強制しません)、<b>字数が多いときは字間を詰めてから長体</b> (横幅圧縮) で収めます。名前スーパー等の既定テンプレートはこの方式です。広げ上限/詰め下限はインスペクタの「最大/最小字間(em)」で調整できます。</p>
        <div class="manual-tip">💡 デザインセットを複数持てます。番組ごとに体裁を切り替える運用に。</div>`,
    },
    {
      id: 'ops', title: '送出操作', html: `
        <h2 class="manual-h2">送出の動詞</h2>
        <table class="manual-kbd">
          <tr><th>操作</th><th>意味</th></tr>
          <tr><td>TAKE</td><td>NEXTをINアニメ付きで送出し、NEXTを次ページへ進める</td></tr>
          <tr><td>UPDATE</td><td>アニメなしで即時差し替え (オンエア中の訂正)</td></tr>
          <tr><td>CLEAR</td><td>OUTアニメで消去</td></tr>
          <tr><td>CLEAR&BACK</td><td>オンエアを消して1つ前のページを即表示 (誤送出のリカバリー)</td></tr>
          <tr><td>STOP</td><td>再生中アニメの一時停止/再開</td></tr>
          <tr><td>SKIP / BACK / TOP</td><td>NEXTポインタの移動</td></tr>
        </table>
        <div class="manual-tip">これらのボタンは<b>各TL列の下部</b>にあり、押した列の系統だけに作用します (TL1のTAKEはTL1のみ送出)。</div>
        <h2 class="manual-h2">便利機能</h2>
        <ul class="manual-list">
          <li><b>ダイレクト送出</b>: ページ番号を入力→Enterで NEXT、もう一度Enterで TAKE</li>
          <li><b>オートフォロー</b>: 尺経過で自動的に次へTAKE / CLEAR (コーナー右クリック)</li>
          <li><b>送出ロック</b>: 誤TAKE防止 (ページ/コーナー単位)</li>
          <li><b>リハーサル</b>: 出力へ送らずUI上だけで動作確認</li>
          <li><b>素材集</b>: 放送しない予備ページの待機トレイ (ドラッグで往復)</li>
        </ul>`,
    },
    {
      id: 'shortcuts', title: 'ショートカット', html: `
        <h2 class="manual-h2">送出タブのホットキー</h2>
        <table class="manual-kbd">
          <tr><th>キー</th><th>動作</th></tr>
          <tr><td><kbd>Space</kbd> / <kbd>Enter</kbd></td><td>TAKE (操作中の系統)</td></tr>
          <tr><td><kbd>↑</kbd> / <kbd>↓</kbd></td><td>NEXTを上/下へ移動</td></tr>
          <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>コーナーを移動</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Backspace</kbd></td><td>CLEAR</td></tr>
          <tr><td><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Backspace</kbd></td><td>CLEAR&BACK (消して前へ戻る)</td></tr>
          <tr><td><kbd>0</kbd>–<kbd>9</kbd></td><td>ダイレクト送出の番号入力を開始</td></tr>
        </table>
        <div class="manual-tip">💡 列 (またはページ) をクリックするとその系統がキー操作の対象になります (ツールバーの「⌨ キー操作: TL1」表示)。列内のボタンは常にその列の系統に作用します。</div>`,
    },
    {
      id: 'output', title: '出力URLとvMix取込', html: `
        <h2 class="manual-h2">出力ページのURL</h2>
        <p class="manual-p">設定タブで出力サーバを起動すると、以下のURLが使えます (透過1920×1080)。vMixのブラウザ入力に登録してください。</p>
        <table class="manual-kbd">
          <tr><th>URL</th><th>内容</th></tr>
          <tr><td><code>/output/jp</code></td><td>日本語・全系統を重畳</td></tr>
          <tr><td><code>/output/en</code></td><td>英語・全系統を重畳</td></tr>
          <tr><td><code>/output/jp/&lt;系統&gt;</code></td><td>単一系統のみ</td></tr>
          <tr><td><code>/output/jp/g/&lt;グループ&gt;</code></td><td>出力グループ (複数系統をレイヤー合成)</td></tr>
        </table>
        <div class="manual-tip">💡 ホスト表示のIPアドレス+ポートで、別PCのvMixからも取り込めます (同一LAN)。</div>`,
    },
    {
      id: 'channels', title: '系統と出力グループ', html: `
        <h2 class="manual-h2">系統 (TL枠)</h2>
        <p class="manual-p">系統=出力の枠です。既定は汎用的な <b>TL1 / TL2</b>。番組に合わせてラベル(表示名)や色を自由に変え、TL3/TL4… と任意に追加できます (設定タブ「系統 (TL枠)」)。系統ごとに送出URLが作られます。</p>
        <h2 class="manual-h2">系統プリセット (テロップ枠のストック)</h2>
        <p class="manual-p">「名前」「サイド」など、系統に割り当てる枠 (表示名・色 + 使用するデザイン) をストックしておけます。</p>
        <ul class="manual-list">
          <li>系統一覧の各行「<b>★ プリセット保存</b>」で、現在の枠をプリセットとして保存</li>
          <li>各行の「<b>プリセット適用…</b>」で、任意の系統へ個別に割り当て (例: TL1←名前, TL2←サイド / TL1←新規作成, TL2←名前)</li>
          <li>適用すると、その系統のラベル・色と、割り当てられたデザインが切り替わります</li>
        </ul>
        <h2 class="manual-h2">出力グループ (URLレイヤー合成)</h2>
        <p class="manual-p">複数の系統を1つのURLへレイヤー合成できます。例:「メイン=TL1+TL2+TL3」「サブ=TL4のみ」。重なり順は並び順で調整します。日本語/英語の出し分けとは独立です。</p>`,
    },
    {
      id: 'remote', title: 'GPIO・2台運用', html: `
        <h2 class="manual-h2">GPIOリモートボタン</h2>
        <p class="manual-p">CONTEC DIOデバイスの接点入力をTAKE/CLEAR等に割り当て、物理ボタンで送出できます (設定タブ「GPIO」)。</p>
        <h2 class="manual-h2">2台運用 (リモート連携)</h2>
        <p class="manual-p">出力担当PCと操作PCを分ける運用に対応。操作PCからのコマンドが出力担当PCへ委譲されます。詳細な接続手順は配布ドキュメント「リモート運用」を参照してください。</p>`,
    },
    {
      id: 'install', title: 'インストール', html: `
        <h2 class="manual-h2">Windowsへのインストール</h2>
        <ol class="manual-steps">
          <li>配布されたインストーラ (<code>GMO TelopGo Setup x.y.z.exe</code>) を実行</li>
          <li>SmartScreenが出た場合は「詳細情報」→「実行」</li>
          <li>初回起動後、設定タブで出力サーバを起動しポートを確認</li>
          <li>vMixのブラウザ入力に出力URLを登録</li>
        </ol>
        <div class="manual-tip">💡 詳細な手順・トラブルシューティングは配布ドキュメント「install-windows」を参照してください。</div>`,
    },
  ],

  onShow() {
    if (!this._rendered) this.render();
  },

  render() {
    const nav = document.getElementById('manual-nav');
    const body = document.getElementById('manual-body');
    if (!nav || !body) return;
    nav.innerHTML = '';
    this.SECTIONS.forEach((sec) => {
      const btn = document.createElement('button');
      btn.className = 'manual-nav-btn';
      btn.textContent = sec.title;
      btn.dataset.sec = sec.id;
      btn.addEventListener('click', () => this.select(sec.id));
      nav.appendChild(btn);
    });
    this._rendered = true;
    this.select(this.SECTIONS[0].id);
  },

  select(id) {
    const sec = this.SECTIONS.find((s) => s.id === id);
    if (!sec) return;
    this._active = id;
    const body = document.getElementById('manual-body');
    body.innerHTML = `<article class="manual-section">${sec.html}</article>`;
    body.scrollTop = 0;
    document.querySelectorAll('#manual-nav .manual-nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.sec === id);
    });
  },
};

document.addEventListener('DOMContentLoaded', () => {
  // マニュアルは初回表示時に描画するが、テスト等で直接renderしても良いよう公開
  if (typeof window !== 'undefined') window.ManualUI = ManualUI;
});
