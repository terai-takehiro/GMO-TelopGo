# GMO TelopGo — Claude 向けプロジェクト指示

## リリースポリシー
- GitHub Release は **Windows 版のみ** を作成・添付する。**macOS 版はビルドもリリース添付もしない。**
- リリース手順: `CHANGELOG.md` 追記 → `package.json` / `package-lock.json` のバージョン更新 → master へマージ →
  `build-windows.yml` を `master` で `release=true` 実行 (タグ `vX.Y.Z` と Release を作成し、インストーラ/ポータブル版を添付)。
- `build-macos.yml` は実行しない (手動・動作確認用の Artifacts のみに残してある)。ユーザーから明示的に頼まれた場合を除く。
