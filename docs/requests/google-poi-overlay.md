推奨モデル: gpt-6-astra / reasoning: medium

# Googleの施設・地名を地理院地図に重ねる(T5、ブランチ feature/display-surface の続き)

## 目的
リポジトリ C:\Users\yuhei\route-builder(Vite + TypeScript + Leaflet、GitHub Pages で公開中)。
ユーザーは「スーパー地形」アプリのように、地理院の地形図の上に Googleマップの施設アイコンと地名(山頂・名所・山小屋・駐車場など)を重ねて見たい。
Map Tiles API の「透過オーバーレイ+スタイル」で、アイコンと名前だけの透過PNGタイルが取れることをレビュー側で実データ確認済み。

## 確認済みの事実(2026-10-11、旭岳付近 z15)
- 次のセッションで、背景が透明(PNGパレット+tRNS)で、POIアイコンと名前(白文字・暗い縁取り)だけのタイルが返る:
  ```json
  { "mapType": "satellite", "language": "ja-JP", "region": "JP",
    "layerTypes": ["layerRoadmap"], "overlay": true, "imageFormat": "png",
    "styles": [
      { "stylers": [{ "visibility": "off" }] },
      { "featureType": "poi", "stylers": [{ "visibility": "on" }] },
      { "featureType": "poi", "elementType": "geometry", "stylers": [{ "visibility": "off" }] },
      { "featureType": "landscape.natural", "elementType": "labels", "stylers": [{ "visibility": "on" }] }
    ] }
  ```
  例: 旭岳(山頂アイコン)、金庫岩(名所アイコン)。z14 の同地点ではアイコンが出なかった(低ズームでは間引かれる)。
- Map Tiles API ポリシー: サードパーティのレンダラー利用可。Googleロゴを他のロゴと重ねない。Googleの帰属表示とサードパーティの帰属表示を明確に分ける。
  ハイブリッド表示では、どの部分がGoogle由来か利用者に分かるようにする。ユーザーは規約上の解釈リスクを理解した上で利用継続を選択済み。
- 既存実装: `src/google.ts`(セッション管理 GoogleSessions、viewport 帰属)、`src/google-layer.ts`(GoogleLayer: 帰属・ロゴ・セッション更新・maxNativeZoom・ちらつき対策)。

## 対象ファイル(変更してよいもの)
- `src/google.ts`, `src/google.test.ts`, `src/google-layer.ts`, `src/config.ts`(追加のみ), `src/main.ts`, `src/map.ts`, `src/style.css`, `src/ui/` 配下, `H_README.md`
- それ以外は変更しない。npm操作なし。

## 変更内容
1. `sessionBody` を拡張し、オーバーレイ用の種類 `'poiOverlay'` を追加(上のJSON。既存の scale/highDpi 設定も適用)。スタイル配列は `config.google.poiOverlayStyles` に置く。
   セッションキャッシュのキーに種類を含める(既存の roadmap/satellite/terrain と混ざらない)。
2. GoogleLayer をオーバーレイとしても使えるようにする(または薄いラッパー):
   - 専用ペイン `googlePoi`(zIndex 250: 背景タイルより上、ルート線・マーカーより下)。pointer-events なし。
   - `minZoom: 13`(それ未満はタイルを要求しない。クォータ節約)。maxNativeZoom は既存の viewport 判定を流用。
   - 帰属: Googleロゴと viewport の copyright を表示(背景がGoogleの時と同じ仕組み)。地理院・OSMの帰属とは区切って「Google: ◯◯」と明示。
   - 移動中に消さない(既存のちらつき対策を踏襲)。失敗(403等)時はオーバーレイだけ外して warn(背景は変えない)。
3. UI: 背景地図の切り替えポップアップに「重ねる」セクションを追加し、トグル「Googleの施設・地名」(Googleキー設定時のみ表示)。
   - 背景が Google(道路/航空/地形)の時は無効(グレーアウト、説明「Google背景では不要」)。
   - 既定ON、選択は localStorage に記憶。ズーム13未満の時はトグル横に「ズーム13以上で表示」。
4. テスト: poiOverlay のセッション本文(overlay/layerTypes/styles/png)、キャッシュキーの分離、ペインとzIndex、minZoom、Google背景時の無効化、
   失敗時にオーバーレイだけ外れる、帰属の追加・削除、設定の記憶。

## 受け入れ条件
- `npm test` 全緑、`npm run build` 成功。既存機能の回帰なし。375px幅で横スクロールなし。
- Google・地理院への手動試験リクエストはしない(レビュー側で実キー確認)。

## 制約
- 対象ファイル以外は変更しない。外部通信先の追加なし(tile.googleapis.com のみ)。コミットは不要(レビュー側で行う)。

## 報告形式
- 変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
