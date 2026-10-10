# ルートビルダー

自転車の個人用ルート作成ツール。Vite + TypeScript + Leaflet 1.9、静的配信のみ。

## 起動

Node.js 22.12以上（開発時24）で `npm install` → `npm run dev`。
ブラウザで http://127.0.0.1:5188 を開きます。`npm test` で検証、`npm run build` で `dist/` に出力。
スマホは同じLAN内で `npm run dev` のNetwork欄のURLへ接続します。Windowsファイアウォールの許可が必要な場合があります。

## 実装・検証計画

- T1: 地図・ベースレイヤー、雛形、Vitest
- T2: 経由点編集と区間単位ルーティング
- T3: DEM標高、統計、グラフ
- T4: 峠・山の取得と表示
- T5: GPX・自動保存・共有
- T6: PC/スマホUI、実ブラウザ検証
- T7: Google Map Tiles API（キー設定時のみ）

各段階でテストとビルドを通してから、1タスク1コミット。

## 出典

- 地図・標高：[地理院タイル一覧](https://maps.gsi.go.jp/development/ichiran.html)、[PNG標高仕様](https://maps.gsi.go.jp/development/demtile.html)
- 地図・地物：© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)
- 道路探索：[BRouter](https://brouter.de/)、[Overpass API](https://overpass-api.de/)
- デザイン規則：[ha-dads tokens](https://github.com/ogatomo21/ha-dads/blob/main/docs/tokens.md) / [theme](https://github.com/ogatomo21/ha-dads/blob/main/themes/dads.yaml) を参照。独自UIにライト色、8px単位、黄＋黒フォーカスを適用。

フォントはローカルのNoto Sans JPを優先し、日本語システムフォントへフォールバック。外部フォント配信への通信はしません。

## 操作

1. 地図で2点以上をクリック／タップ。番号マーカーのドラッグで経由点を移動します。番号を選びポップアップで削除、またはパネルの削除ボタンを使います。
2. 山サイ／グラベル／ロード、道に沿うON/OFFを選択。全消去も「元に戻す」で復元できます。
3. 標高グラフをなぞるか、下のスライダーを操作して地図上の位置を確認します。
4. スマホの「ルート情報」をタップまたはドラッグして開閉します。キーボードではEnter／上下キーで操作できます。
5. ルート名を入力し、計算完了後「GPX保存」。GPXを再読込すると形状・標高を保持します。経由点等を編集した時点で道路探索を再実行します。
6. 共有URLには経由点・プロファイル・直線設定・名称のみ含みます。受信側で再計算するため、GPXの完全な形状保持にはGPXファイルを使います。URLには位置情報が含まれます。

## 設定と制限

`src/config.ts` にプロファイルと閾値を集約しています。山サイ=mtb、グラベル=gravel、ロード=fastbike。BRouterは500ms待機・同時2リクエスト、成功区間を512件メモリ保存。失敗区間は直線＋通知で代替し、失敗を永久キャッシュしません。

標高は20m間隔、z=14、DEM5A→DEM10B（正式ID `dem_png`）。タイル128枚までメモリ保存。欠測は補完せず登降計算の連続性を切ります。5m以上の反転を確定するヒステリシスで登降を集計し、最高点はサンプル最大値。GPX頂点の標高は周辺サンプルから補間し、既存GPXの標高は保持します。DEM完全欠測ではGPXのeleを省略して通知します。

峠・鞍部100m／ピーク150m以内を近接判定。実際の登頂・通過を保証しません。標高はOSM ele→DEM。ルート変更後1200ms待機、同時1リクエスト、bboxを0.01度単位で外向きに丸め32件までメモリ保存。公開サーバー保護のため緯度・経度幅が2度を超える検索は省略して通知します。

GPXは20MB・100,000点以内・単一の連続トラック（またはrte）に対応。複数trksegを直線でつながずエラーにします。編集経由点は200点まで、外部GPXは約500m以上の間隔で間引きます。Undoは50操作。localStorage失敗時も操作・GPX保存は継続します。

## 構成

- `geo.ts`, `elevation.ts`, `gpx.ts`, `persistence.ts`: 純関数・入出力境界
- `routing.ts`, `dem.ts`, `places.ts`: 外部データ供給（依存を注入してテスト可能）
- `map.ts`, `chart.ts`, `panel.ts`: 表示
- `main.ts`, `state.ts`: 状態・画面連携

POI追加は地物プロバイダー、FIT追加はGPXと同じ出力境界へ拡張できます。バックエンド・分析送信・Service Workerはありません。

## Google背景地図の設定

キー未設定でもすべての基本機能が動作し、Google選択肢・Google通信は発生しません。

1. Google CloudでMap Tiles APIを有効化したブラウザ用APIキーを用意します。
2. `.env.example` を `.env.local` にコピーし、`VITE_GOOGLE_MAPS_API_KEY=` の右側にキーを入力します。
3. `npm run dev` を再起動します。本番は `npm run build` を再実行します。
4. レイヤー選択に「Google 道路／航空写真／地形」が現れます。

Viteの `VITE_` 変数はブラウザ配信コードに含まれます。サーバー秘密鍵として隠せる仕組みではありません。Google Cloud側でHTTPリファラーとMap Tiles APIにキーを制限し、利用枠・課金を管理してください。`.env.local` と `dist/` はGit対象外です。キーを含むネットワークログもコミットしないでください。

設定は `src/google.ts` の `GOOGLE` に集約。既定は `scaleFactor2x` / `highDpi:true`。1xにする場合は `scaleFactor1x` / `highDpi:false` に変更。APIが512px画像を返しても地理的範囲は同じなので、LeafletのCSSタイルサイズは256pxです。

セッションのみ、キーの識別値・地図種別・DPI設定別にlocalStorageへ保存。expiry（Unix秒）の1時間前に更新します。移動・ズーム後400ms待機してviewportを取得し、copyrightを反映します。失敗時は帰属が不明なGoogle背景を表示せず地理院淡色へ戻します。`maxZoomRects` が複数ある場合は最小上限を採用する保守的実装です。詳細度が混在する広域表示では拡大画像が粗くなる場合があります。

タイルのプリフェッチ・独自の永続キャッシュ・オフライン保存はありません。`keepBuffer:0`、`updateWhenIdle:true`、`updateWhenZooming:false`、`detectRetina:false`。画像キャッシュはブラウザのHTTPキャッシュに従います。

公式仕様との照合（2026-10-10）:

- [セッション](https://developers.google.com/maps/documentation/tile/session_tokens): `POST https://tile.googleapis.com/v1/createSession`。terrainはlayerRoadmapが必須。
- [2Dタイル](https://developers.google.com/maps/documentation/tile/roadmap): `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}`。依頼のURL形式と一致。
- [viewport](https://developers.google.com/maps/documentation/tile/2d-tiles-overview): `https://tile.googleapis.com/tile/v1/viewport`。上限はトップレベルのmaxZoomではなく `maxZoomRects[].maxZoom`。
- [帰属ポリシー](https://developers.google.com/maps/documentation/tile/policies): 新規実装にはGoogle Mapsロゴを使う指定。公式SVGを無改変で同梱、地図左下に高さ18px、周囲10px（下5px）の余白。スマホパネルに隠れない位置へ移動。第三者ルート情報の出典はパネル内に分離。

### 実キーでの手動確認（未実施）

1. キー設定後、開発者ツールNetworkのログを消去してGoogle道路を選択。createSession→viewport→2dtilesの順で200応答となることを確認。
2. 航空写真・地形へ切替。terrainのbodyにlayerRoadmapがあり、copyrightが更新され、Google Mapsロゴが見えることを確認。
3. パン・ズームでviewportを再取得し、上限以上ではタイルURLのzが増えず拡大表示されることを確認。375px画面でもロゴ・copyrightがパネルに隠れないことを確認。
4. 同じ地図種別へ戻った時に有効なセッションが再利用されることを確認。localStorageのexpiryを現在Unix秒+3599に変更して再読込すると再作成されます。
5. 地理院へ戻るとGoogleロゴ・copyrightが消え、地理院出典になることを確認。

## 実施済み検証

- Vitest: 距離、点と線の近接・ルート上距離、DEMデコード、ヒステリシス、サンプリング、区間キャッシュと同時数、地物距離フィルター、GPX、共有URL、保存失敗、Googleセッション・bounds。
- Chromium実ブラウザ: 地図のクリック追加、ドラッグ、実BRouter応答、実DEM、実Overpass、PC表示、375×812で横スクロールなし、パネルのタップ／ドラッグ。
- ネットワークログ: 4経由点の2番をドラッグしてBRouter追加リクエスト2件、変更のない区間は再取得なし。
- 花脊峠: OSM node 1368961752（35.158743, 135.786125、ele=760）。例示座標35.1615,135.7590とは約2.5km異なります。登録位置を通る山サイルートで地図・一覧・グラフに花脊峠760m、旧花背峠751mを表示。サンプル最高点759mとの差はDEM標高とOSM登録標高の違いです。
- GPX: ブラウザで出力→読込→再出力、SHA-256一致。読込後は再計算せず元の形状を表示。
- Google: キーなしで選択肢なし／通信なし。模擬応答では3種類の切替、ロゴ、copyright、ズーム12のタイルを13以上で拡大、403時の地理院復帰を確認。実キー・実Google画像での検証は未実施。
- 検証中の修正: ブラウザfetchのthis束縛不具合、テストデータの型エラー、ラジオボタンへの過大な入力欄CSS。Overpassは一度504応答、再編集時の再取得は200応答。

実通信先はBRouter、Overpass、地理院タイル、OSMタイル、キー設定時のみtile.googleapis.com。Googleロゴ・Leaflet画像は同梱、外部フォント通信なし。
