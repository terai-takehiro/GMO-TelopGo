# GMO TelopGo

放送・配信向けの **HTML5 テロップ送出システム** (Electron製デスクトップアプリ)。

透過 1920×1080 の出力ページをローカルHTTPサーバで配信し、**vMix 等のブラウザ入力で取り込んで**テロップをリアルタイムに送出します。テンプレートの作画から本番の送出オペレーションまで、このアプリ1本で完結します。

- 対応OS: Windows 10/11 / macOS (Apple Silicon・Intel)
- 技術: Electron 28 / ローカルHTTP+WebSocketサーバ / HTML5レンダリング
- 最新の変更点は [CHANGELOG.md](CHANGELOG.md) を参照

---

## 主な機能

### 3つの送出モード (ホーム画面で選択)
| モード | 用途 |
|---|---|
| 📺 **リアルタイムCG送出** | Excelで文字リストを用意し、テンプレートに**変数として代入**して送出。名前スーパー・サイドテロップ等、同じ体裁で内容だけ差し替える運用に |
| 🖼 **電テロ送出** | アプリ内で作画した1枚絵や、別ソフトで作った**静止画ファイルを並べて静的に送出**。画像はドラッグ&ドロップで流し込み (PNG/JPG/WebP/GIF/SVG) |
| 🏆 **スポーツ送出** | スポーツコーダー。スコア・ピリオド・試合時計・野球カウントを操作盤でライブ操作し、ON AIR中のスコアバグへ**再テイクなしで即時反映** |

モードごとに 番組 → 放送(日付) のランダウンが**完全に独立**しています。モード選択後は番組→放送を選ぶウィザードが開き、決定すると各画面に入ります。

### TL系統ごとのコンソール (送出画面)
テロップライン (TL1 / TL2 / …) の**列がそのまま1系統のコンソール**になっています。

- 列上部に **OA | NEXT のミニモニター** (OA=その系統の実出力プレビュー / NEXT=次に出るページの描画)
- 列下部に**その系統専用の送出ボタン一式** — TOP / BACK / SKIP / STOP / UPDATE / CLEAR / CLEAR&BACK — と**大型TAKE** (系統色の枠)
- TL1 のボタンは TL1 だけに作用。複数系統の同時運用でも状況と操作対象がひと目でわかります
- 右ペインは選択ページの**編集専用**エディタ

### 運用支援
- **ダイレクト送出**: ページ番号 + Enter で NEXT、もう一度 Enter で TAKE
- **CLEAR&BACK**: オンエアを消して1つ前のページを即表示 (誤送出のリカバリー)
- **オートフォロー**: 尺の経過で自動的に次へ TAKE / CLEAR
- **送出ロック** (ページ/コーナー単位)・**リハーサルモード** (出力へ送らずUIのみ)・**素材集** (予備ページの待機トレイ)・**ページ検索**・送出ログ
- **残尺カウントダウン** と ON AIR 状態のステータス表示

### デザインエディタ (Photoshop風)
- レイヤー方式: テキスト / 図形 (矩形・円・多角形・星) / 画像
- テキスト: フォント (持ち込み/Google Fonts)・多重縁取り・グラデーション・座布団・縦書き・縦中横・ルビ・斜体/歪み・変体率 (横幅率/縦幅率)・均等割付
- **自動字詰め**: 枠に対して字数が少ないときは**字間を広げ** (上限つき — 均等割付のように端まで強制しない)、多いときは**字間を詰めてから長体** (横幅圧縮) で収める。名前スーパー等の既定テンプレートはこの方式 (上限/下限はインスペクタの「最大/最小字間(em)」で調整、既定 0.35 / -0.08)。ほかに「長体」「縮小」モードも選択可
- IN/OUT アニメーション: プリセット (フェード/スライド/ワイプ/ズーム/フリップ/文字送り 等) + パラメータ調整、試写再生
- デザインセットを複数保持 (番組ごとの体裁切替)、テンプレートの書き出し/取り込み、PNG書き出し

### スポーツコーダー (スポーツ送出)
- チームごとの **+1/+2/+3/−1** キー、ピリオド/セット進行、**試合時計** (アップ/ダウン・開始/停止/±補正)、**野球盤** (BALL/STRIKE/OUT自動巡回・イニング表裏・塁トグル)
- TAKE後の操作は**インプレース更新** (値の変わったレイヤーだけ描き直す専用経路) でON AIRへ即時反映 — 毎秒動く時計でもちらつきません
- 既定スコアバグ (`sports-score` / `sports-baseball`) 付き。デザインタブで自作したテロップも **binding規約** (homeName/homeScore/awayScore/period/clock/inning/bso/bases 等) を満たせばそのまま操作盤から使えます
- 試合状態は放送(試合)単位で保存され、2台運用の状態同期にも乗ります (操作は出力担当PC上で)

### 系統 (TL枠) と出力
- 系統は既定 **TL1 / TL2**。ラベル・色を自由に変更でき、TL3/TL4… と任意に追加可能
- **系統プリセット**: 「名前」「サイド」等の枠 (表示名・色 + 使用デザイン) をストックし、任意の系統へ個別適用 (例: TL1←名前, TL2←サイド)
- **出力グループ**: 複数系統を1つのURLへレイヤー合成 (例: メイン=TL1+TL2+TL3)
- 日本語/英語の2言語URLを別々に出力

### 外部連携
- **GPIO 物理ボタン**: CONTEC DIO デバイスの接点入力を系統ごとの TAKE/CLEAR 等に割り当て (Windows専用)
- **2台運用**: LAN上の2台を WebSocket で同期 (ホスト/クライアント、コマンド委譲と状態同期) → [docs/remote-operation.md](docs/remote-operation.md)
- **ライブデータ連携**: CSV/Excel ファイルを監視し、セルの値をテロップのフィールドへ自動反映
- **Excel一括取込**: テンプレートの列順で1行=1ページを一括作成 (見本テンプレDLあり)

---

## 導入

GitHub の Releases (または Actions の Artifacts) からダウンロードします。コード署名をしていないため、初回実行時に OS のブロック (SmartScreen / Gatekeeper) 解除が必要です。

### Windows

| 配布物 | ファイル | 用途 |
|---|---|---|
| インストーラ版 | `GMO-TelopGo-Setup-X.Y.Z.exe` | 通常のインストール (スタートメニュー登録あり) |
| ポータブル版 | `GMO-TelopGo-X.Y.Z-portable-win.zip` | インストール不要。展開して `GMO TelopGo.exe` を実行 |

SmartScreen の解除手順・トラブルシュートは **[docs/install-windows.md](docs/install-windows.md)** を参照。

### macOS

| 配布物 | ファイル | 対象 |
|---|---|---|
| dmg (推奨) | `GMO-TelopGo-X.Y.Z-arm64.dmg` / `-x64.dmg` | Apple Silicon / Intel |
| ZIP版 | `GMO-TelopGo-X.Y.Z-arm64-mac.zip` / `-x64-mac.zip` | 展開してそのまま実行 |

Gatekeeper の解除手順 (右クリック→開く / `xattr -cr`) は **[docs/install-macos.md](docs/install-macos.md)** を参照。
※ GPIO物理ボタン (CONTEC DIO) はWindows専用です。Macでは2台運用のクライアントとして併用できます。

## クイックスタート (運用の流れ)

1. **設定タブ**で出力サーバを起動 (既定ポート 8790。自動起動もON可)
2. vMix のブラウザ入力に出力URL (下表) を登録
3. **ホーム**で送出モードを選ぶ → **番組 → 放送(日付)** を選んで送出画面へ
4. 各TL列の「＋」でページ追加 (CGモードは Excel取込も可 / 電テロは画像D&D)
5. ページをクリックで **NEXT** にセット → 列の **TAKE** で ON AIR

## 出力URLとvMix取込

サーバ起動後、以下のURLが使えます (すべて透過 1920×1080)。ホストPCのIP+ポートで別PCのvMixからも取り込めます (同一LAN)。

| URL | 内容 |
|---|---|
| `/output/jp` | 日本語・全系統を重畳 |
| `/output/en` | 英語・全系統を重畳 |
| `/output/jp/<系統>` | 単一系統のみ (例: `/output/jp/tl1`) |
| `/output/jp/g/<グループ>` | 出力グループ (複数系統をレイヤー合成) |

`?preview=1` を付けるとプレビュー用 (アプリ内のOAモニターが使用)。設定タブの「URL一覧」からコピーできます。

## 送出操作とショートカット

| 操作 | 意味 |
|---|---|
| TAKE | NEXTをINアニメ付きで送出し、NEXTを次ページへ進める |
| UPDATE | アニメなしで即時差し替え (オンエア中の訂正) |
| CLEAR | OUTアニメで消去 |
| CLEAR&BACK | オンエアを消して1つ前のページを即表示 |
| STOP | 再生中アニメの一時停止/再開 |
| SKIP / BACK / TOP | NEXTポインタの移動 |

ボタンは**各TL列の下部**にあり、押した列の系統だけに作用します。

| キー | 動作 |
|---|---|
| `Space` / `Enter` | TAKE (キー操作対象の系統) |
| `↑` / `↓` | NEXTを上下へ移動 |
| `←` / `→` | コーナーを移動 |
| `Ctrl+Backspace` | CLEAR |
| `Ctrl+Shift+Backspace` | CLEAR&BACK |
| `0`–`9` | ダイレクト送出の番号入力を開始 |

キー操作の対象系統は、列クリックで切り替わりツールバーの「⌨ キー操作: TL1」ピルに常時表示されます。

## 開発者向け

```bash
npm install         # 依存関係 (Node 20)
npm start           # 開発起動 (Electron)
npm run build       # Windows向けビルド (electron-builder)
npm run build:mac   # macOS向けビルド (dmg/zip, arm64+x64 — macOS上で実行)
```

### リポジトリ構成

```
main.js / preload.js        Electronエントリ / contextBridge
src/main/                   メインプロセス
  ipc-handlers.js             IPC集約
  graphics-server.js          出力HTTP+WSサーバ (テイク/クリア配信)
  graphics-store.js           デザインプロジェクト (テンプレJSON) の保存/既定生成
  rundown-store.js            ランダウン (モード→番組→放送→コーナー→ページ)
  settings-store.js           設定 (系統/プリセット/出力グループ/GPIO/連携)
  gpio-dio.js / remote-link.js  CONTEC DIO / 2台運用
src/renderer/               画面 (ホーム/送出/デザイン/マニュアル/設定)
src/output/                 出力ページ (output.js) と共通レンダラー (telop-renderer.js)
docs/                       詳細ドキュメント
```

描画は `src/output/telop-renderer.js` を出力ページ・デザインエディタ・NEXTモニターで共用し、「編集画面で見えるもの = 出力に出るもの」を保証しています (サムネイル/PNGはCanvas版の並行実装)。

### リリース (CI)

- `.github/workflows/build-windows.yml` — Windows インストーラ/ポータブル版
- `.github/workflows/build-macos.yml` — macOS dmg/zip (arm64 + x64)

共通の挙動:
- `v*` タグの push → ビルドして GitHub Release に添付
- 手動実行 (workflow_dispatch) → Artifacts に保存。**release=true** にすると package.json のバージョンで `vX.Y.Z` タグ/Release に添付 (既存Releaseには追記)
- `claude/**` ブランチへの push → Windows のみ動作確認用ビルド (macはコスト節約のため手動/タグ時のみ)

リリース手順: `CHANGELOG.md` 追記 → `package.json` / `package-lock.json` のバージョン更新 → push → **build-windows を release=true で実行** (タグ/Release作成) → **build-macos を release=true で実行** (同じReleaseにmac版を追記)。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| アプリ内「マニュアル」タブ | 画面の見方・操作ガイド・ショートカット (常に最新) |
| [docs/install-windows.md](docs/install-windows.md) | Windows 11 への導入と SmartScreen 解除 |
| [docs/install-macos.md](docs/install-macos.md) | macOS への導入と Gatekeeper 解除 |
| [docs/remote-operation.md](docs/remote-operation.md) | 2台運用 (リモート連携) の設計・運用 |
| [docs/local-graphics-design.md](docs/local-graphics-design.md) | ローカルグラフィックスエンジンの設計書 |
| [CHANGELOG.md](CHANGELOG.md) | 全バージョンの変更履歴 |

## 更新履歴 (直近ハイライト)

- **v2.8.0** スポーツコーダー (スコア/試合時計/野球カウントのライブ操作送出) を追加
- **v2.7.2** macOS版 (dmg/zip, Apple Silicon・Intel) の配布を開始
- **v2.7.0** 自動字詰め (短文=字間広げ/長文=詰め+長体) を追加、記号だけのボタンを日本語ラベル併記に統一
- **v2.6.x** TL系統ごとに OA/NEXT モニターと送出ボタン一式を配置 (列=コンソール化)
- **v2.5.x** プレビュー主役の再設計・CLEAR&BACK・ページ検索・ダイアログ/ボタンの刷新・起動時最大化
- **v2.4.x** 送出モードをホームで選ぶ方式に整理、系統を TL 汎用枠+プリセット化、入場ウィザード
- **v2.3.0** ホーム画面・アプリ内マニュアル・白基調UI / **v2.2.0** 電テロモード / **v2.1.0** 出力グループ

詳細は [CHANGELOG.md](CHANGELOG.md) へ。

---

© GMOインターネットグループ株式会社
