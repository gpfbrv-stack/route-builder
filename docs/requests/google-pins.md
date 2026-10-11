推奨モデル: gpt-6-astra / reasoning: medium

# Googleマップのピンを地図に表示(ブランチ feature/display-surface の続き、T4)

## 目的
リポジトリ C:\Users\yuhei\route-builder(Vite + TypeScript + Leaflet、GitHub Pages で公開中)。
ユーザーが Googleマップで保存している場所(ピン)を、地理院地図などの背景の上に表示したい。
Googleには保存済みの場所を取得するAPIが無く、Places API で取った内容をGoogle以外の地図に表示することは規約で禁止されているため、
**ユーザー自身が書き出したファイルを読み込む** 方式にする(外部通信なし)。

## 対応する形式
1. **KML / KMZ**(Googleマイマップの「KML/KMZにエクスポート」)。KMZ は ZIP 内の `doc.kml`(最初の .kml)を読む。
   - `Placemark` の `Point/coordinates`(lng,lat[,alt])、`name`、`description`(HTMLを含み得る → テキスト化)、所属 `Folder/name`(レイヤ名)。
   - LineString / Polygon は今回は読み飛ばし、件数を報告に出す。
2. **GeoJSON**(Googleデータエクスポートの「マップ(マイプレイス)」の `Saved Places.json` 等)。
   - `FeatureCollection` の Point 地物。名前は `properties.Title` → `properties.location.name` → `properties.name` → '名称なし'。
     住所 `properties.location.address`、Googleマップのリンク `properties.google_maps_url` があれば保持。
   - 座標が [0,0] や範囲外の地物は捨てて件数を報告。
- ZIP の展開は依存を増やさずに行う(ブラウザの `DecompressionStream('deflate-raw')` で、ZIPのローカルファイルヘッダを読んで最初の .kml を展開。
  未対応環境ではエラーメッセージ「この端末ではKMZを開けません。KMLで書き出してください」)。
- 1ファイル 20MB / 5,000 ピンまで。

## 対象ファイル(変更してよいもの)
- 新規 `src/pins.ts` と `src/pins.test.ts`(解析・保存の純関数)、`src/ui/` 配下(新規 `src/ui/pins.ts` など)、`src/main.ts`, `src/style.css`, `src/ui/layout.ts`, `H_README.md`
- それ以外は変更しない。npm操作なし。

## 変更内容
- 読み込み: PCのブランド行の「GPXを読み込む」の隣に…ではなく、既存のファイル読込を拡張して `.gpx` / `.kml` / `.kmz` / `.json` / `.geojson` を受け付け、
  拡張子・内容で判別する(GPXは従来どおりルートとして読む。KML/KMZ/GeoJSONはピンとして読む)。スマホの「…」メニューの文言は「GPX・ピンを読み込む」。
  読み込み後のステータス(info)「ピンを◯件読み込みました(◯件はスキップ)」。
- 保存: 読み込んだピンを localStorage に保存(キー `route-builder:pins:v1`、try/catch、容量超過時は warn して保存せず表示だけ)。
  複数ファイルを読み込める(ソースファイル名ごとに管理。同じファイル名の再読込は置き換え)。
- 表示: 背景地図の切り替えポップアップに「マイピン」セクションを追加し、ソースごとのON/OFFと件数、削除ボタン(確認ダイアログあり、Undo不要)。
  - マーカー: 直径14pxの円(--pin 色 `#d93025`、白枠2px)。ズーム12未満は直径8px。ピンが多い場合でも描画が重くならないよう `L.canvas` レンダラで描く。
    経由点・峠ラベル・POIより下に描く。地図クリックでの経由点追加を妨げない(マーカークリックはポップアップのみ)。
  - ポップアップ: 名前、住所(あれば)、説明(テキスト、最大300文字)、ソース名、「Googleマップで開く」リンク(google_maps_url があればそれ、無ければ `https://www.google.com/maps/search/?api=1&query=lat,lng`)、
    「ここを経由点に追加」ボタン(ルート末尾に追加。Undo 1回で戻る)。
- 出典表示は不要(ユーザー自身のデータ)。GPX/FIT には含めない。
- テスト: KML(フォルダ・説明HTML・3D座標)、KMZ展開(テスト用の小さなZIPを生成して検証)、Takeout GeoJSON(Title/location.name/[0,0]除外)、
  形式判別、localStorage の保存・置換・削除・容量超過、ポップアップの経由点追加とUndo。

## 受け入れ条件
- `npm test` 全緑、`npm run build` 成功。既存機能(GPX読込を含む)の回帰なし。375px幅で横スクロールなし。
- 外部通信の追加なし(ピンは端末内のみ)。

## 制約
- 対象ファイル以外は変更しない。コミットは不要(レビュー側で行う)。

## 報告形式
- 変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
