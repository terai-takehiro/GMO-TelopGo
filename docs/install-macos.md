# macOS への導入手順

配布物は GitHub の Releases (またはActionsのArtifacts) からダウンロードできます。
**お使いのMacのチップに合わせて**ファイルを選んでください。

| 配布物 | ファイル | 対象 |
|---|---|---|
| ディスクイメージ (推奨) | `GMO-TelopGo-X.Y.Z-arm64.dmg` | Apple Silicon (M1/M2/M3/M4) |
| ディスクイメージ (推奨) | `GMO-TelopGo-X.Y.Z-x64.dmg` | Intel Mac |
| ZIP版 | `GMO-TelopGo-X.Y.Z-arm64-mac.zip` | Apple Silicon (展開してそのまま実行) |
| ZIP版 | `GMO-TelopGo-X.Y.Z-x64-mac.zip` | Intel Mac (同上) |

チップの確認: メニュー →「このMacについて」。「チップ Apple M…」なら arm64、「プロセッサ Intel…」なら x64。

## インストール

1. dmg を開き、`GMO TelopGo.app` を **アプリケーション** フォルダへドラッグ
2. 初回のみ、下記の Gatekeeper 解除を行ってから起動

## 初回起動時のブロック解除 (Gatekeeper)

本アプリは **Appleのコード署名 (公証) をしていない**ため、初回起動時に
「"GMO TelopGo"は、開発元を検証できないため開けません」等のダイアログが出ます。

### 方法1: 右クリックで開く (基本)

1. アプリケーションフォルダの `GMO TelopGo.app` を **右クリック (Ctrl+クリック) →「開く」**
2. 確認ダイアログで **「開く」** を選択 (2回目以降は普通に起動できます)

macOS Sonoma 以降で「開く」ボタンが出ない場合は、
**システム設定 → プライバシーとセキュリティ** 下部の「このまま開く」を押してください。

### 方法2: ターミナルで隔離属性を外す (方法1で開けない場合)

```bash
xattr -cr "/Applications/GMO TelopGo.app"
```

その後、通常どおりダブルクリックで起動できます。

## Windows版との機能差

| 機能 | macOS |
|---|---|
| 送出・デザイン・出力サーバ・2台運用・ライブデータ | ✅ 同等に利用可 |
| GPIO 物理ボタン (CONTEC DIO) | ❌ 利用不可 (ドライバ cdio.dll がWindows専用。接続時にその旨のエラーを表示) |

物理ボタン運用が必要な場合は、Windows機をホスト (GPIO+出力担当)、Macをクライアントにした
[2台運用](remote-operation.md) が利用できます。

## ファイアウォールの確認

出力サーバ起動時に「着信ネットワーク接続を許可しますか?」と出た場合は **許可** してください
(vMix等の別PCから出力URLを取り込むのに必要です)。
