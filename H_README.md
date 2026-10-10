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

フォントは `@fontsource/noto-sans-jp`(400/500/700)を同梱して自前配信し、日本語システムフォントへフォールバック。外部フォント配信への通信はしません。

## 操作

1. 地図で2点以上をクリック／タップ。S（スタート）・番号・G（ゴール）のマーカーをドラッグして移動します。マーカーを選びポップアップで削除、または経由点一覧の×を使います。
2. 山サイ／グラベル／ロード、道に沿うON/OFFを選択。全消去も「元に戻す」で復元できます。
3. 標高グラフをなぞって地図上の位置を確認します。Tabでグラフに移動し、左右キーでも操作できます（Home／Endで端へ）。色は500m区間の平均勾配。欠測を含む区間は塗りません。
4. スマホのシート上端のつまみをタップすると最小（168px）→半分→全体（88%）の順に切り替わります。ドラッグして離すと最寄りの高さへ移動します。キーボードではEnter／上下キーで操作できます。上部の「…」から直線設定・読込・共有・全消去を操作します。
5. ルート名を入力し、標高・峠検索まで完了したら「GPXで保存」（スマホは「GPX」）。GPXを再読込すると形状・標高を保持します。経由点等を編集した時点で道路探索を再実行します。
6. 共有URLには経由点・プロファイル・直線設定・名称のみ含みます。受信側で再計算するため、GPXの完全な形状保持にはGPXファイルを使います。URLには位置情報が含まれます。
7. 青いルート線をドラッグすると、その区間に経由点を挿入します。スマホでは約400ms長押ししてからドラッグします。破線で確認し、離すと確定。「元に戻す」1回で取り消せます。Escでキャンセルできます。GPXの形状保持中と道路探索中は線からの挿入を無効にしています。
8. 地図右上のレイヤーボタンから背景を選択します。選択は次回起動時に復元します。「現在地」は位置情報の許可後に青い点を表示して移動します（追従しません）。

共有URLは読込後にハッシュを取り除きます。その後の再読込は自動保存した編集内容を復元します。

## 設定と制限

`src/config.ts` にプロファイルと閾値を集約しています。山サイ=mtb、グラベル=gravel、ロード=fastbike。BRouterは500ms待機・同時2リクエスト、成功区間を512件メモリ保存。失敗区間は直線＋通知で代替し、失敗を永久キャッシュしません。

標高は20m間隔、z=14、DEM5A→DEM10B（正式ID `dem_png`）。タイル128枚までメモリ保存。欠測は補完せず登降計算の連続性を切ります。5m以上の反転を確定するヒステリシスで登降を集計し、最高点はサンプル最大値。GPX頂点の標高は周辺サンプルから補間し、既存GPXの標高は保持します。DEM完全欠測ではGPXのeleを省略して通知します。

峠・鞍部100m／ピーク150m以内を近接判定。実際の登頂・通過を保証しません。標高はOSM ele→DEM。ルート変更後1200ms待機、同時1リクエスト、bboxを0.01度単位で外向きに丸め32件までメモリ保存。公開サーバー保護のため緯度・経度幅が2度を超える検索は省略して通知します。

第2段階T1では、峠・山と補給・休憩候補を1回のOverpass POSTで取得します。POIはルート線をDouglas-Peuckerで30mから簡略化し、400点を超える場合は許容誤差を倍増。種類別半径のaround検索から、元のルート線との距離でさらに絞ります（コンビニ・商店300m、自販機100m、水場・トイレ200m、道の駅500m）。way/relationはcenterを使います。T2で地図・一覧表示と自販機の集約、T3で標高グラフへの表示とGPX出力を追加しました。

補給・休憩はコンビニ・商店・自販機・水場・トイレ・道の駅の6種類。トイレのみ既定OFFで、チップの表示切替はlocalStorageに保存します。名称はname:ja→name→brand→種類名、営業時間24/7は「24時間」と表示。自販機はルート上で隣り合う自販機の間隔が200m以内なら連続してまとめ、先頭の位置・距離・営業時間を代表として表示します。チップの件数はまとめる前の台数です。

一覧は距離順に30行ずつ追加表示し、行のボタンから地図のポップアップを開きます。地図の印はズーム13未満で12pxの点になり、ルート・経由点・峠ラベルの下に表示します。「Googleマップで確認」はクリック時に新しいタブを開くリンクです。スマホも同じセクションをシート内でスクロールできます。

補給なし最長区間はコンビニ・商店・道の駅だけを補給点として始点・終点を含めて計算し、20km以上で注意表示します。チップをOFFにしても計算は変わりません。OSM未登録の店や営業状況は反映されないため、実際の補給の可否を保証するものではありません。取得に失敗した場合は区間を表示しません。GPX読込時もPOIを検索し、検索失敗時も読み込んだ峠・山は保持します。

標高グラフは20km以上の補給なし最長区間を勾配の塗りの下に帯で表示し、表示ONの補給・休憩をx軸のすぐ上に種類色の点で表示します。自販機の点は一覧・地図と同じ集約単位です。峠・山の名前は全角11px相当で幅を見積もり、最大3段に配置します。収まらない場合は峠を優先し、名前を省略した地物も▼を残します。検索開始時は前のルートの注意・件数・一覧・地図の印・グラフの点と帯を消します。表示ONが0種類の場合だけ種類の選択を促し、ONの種類に該当0件の場合は地物が見つからなかった旨を表示します。

「表示中の補給・休憩をGPXのウェイポイントに含める」は既定ONで、選択をlocalStorageに保存します。ONなら表示ONの種類の元地物を1件ずつwptに出力します（一覧でまとめた自販機も元の名称・座標を保持）。名称と種類名に加え、コンビニ・商店はConvenience Store、自販機・水場はDrinking Water、トイレはRestroom、道の駅はRestaurantのsymを付けます。OFFでも峠・山のwptは残ります。読込時はtypeがこの6種類の表示名であるwptを峠・山に取り込まず、POIはOSMから検索し直します。

峠候補のbboxキャッシュは維持し、POI候補は検索クエリ単位で別途32件まで保存します。同じbboxでも検索する線が変われば統合リクエストを送ります。同じ簡略線でも距離判定は元のルートで毎回行います。HTTP 429/504、本文のrate_limited/timeoutは「Overpassが混雑中」と通知し、30秒後に1回だけ再試行。待機中も取得キューを保持し、ルート変更で古くなった再試行は省略します。失敗応答はキャッシュしません。

GPXは20MB・100,000点以内・単一の連続トラック（またはrte）に対応。複数trksegを直線でつながずエラーにします。編集経由点は200点まで、外部GPXは約500m以上の間隔で間引きます。Undoは50操作。localStorage失敗時も操作・GPX保存は継続します。

## 構成

- `geo.ts`, `elevation.ts`, `gpx.ts`, `persistence.ts`: 純関数・入出力境界
- `routing.ts`, `dem.ts`, `osm.ts`: 外部データ供給（依存を注入してテスト可能）
- `places.ts`: 振り分け済みのOSM峠候補の距離判定・整形
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

セッションのみ、キーの識別値・地図種別・DPI設定別にlocalStorageへ保存。expiry（Unix秒）の1時間前に更新します。移動・ズーム後400ms待機してviewportを取得し、copyrightを反映します。失敗時は帰属が不明なGoogle背景を表示せず地理院淡色へ戻します。`maxZoomRects` が複数ある場合は、表示範囲の中心点を含む矩形の最大上限を採用します。中心点を含む矩形がなければ全矩形の最大上限を使います。

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
- 最終再読込テストで共有URLが自動保存より優先される不具合を再現し、共有データを一度だけ消費する修正と回帰テストを追加しました。

実通信先はBRouter、Overpass、地理院タイル、OSMタイル、キー設定時のみtile.googleapis.com。Googleロゴ・Leaflet画像は同梱、外部フォント通信なし。

## タスク別の変更ファイル

以下はリポジトリルートからの相対パス。各コミット直前に npm test と npm run build が成功。

### 40c1962 feat(T1): scaffold attributed Leaflet basemaps and Vitest

- `.gitignore`
- `H_README.md`
- `index.html`
- `package-lock.json`
- `package.json`
- `src/config.test.ts`
- `src/config.ts`
- `src/main.ts`
- `src/map.ts`
- `src/style.css`
- `tsconfig.json`

### 394db3f feat(T2): edit waypoints and cache rate-limited route segments

- `src/async.ts`
- `src/config.ts`
- `src/geo.test.ts`
- `src/geo.ts`
- `src/main.ts`
- `src/routing.test.ts`
- `src/routing.ts`
- `src/state.ts`
- `src/style.css`
- `src/types.ts`

### 6004d43 feat(T3): sample GSI DEM and chart hysteresis elevation stats

- `src/chart.ts`
- `src/config.ts`
- `src/dem.ts`
- `src/elevation.test.ts`
- `src/elevation.ts`
- `src/main.ts`
- `src/style.css`

### d1fc2fb feat(T4): discover and label nearby passes and peaks

- `src/config.ts`
- `src/geo.ts`
- `src/main.ts`
- `src/places.test.ts`
- `src/places.ts`
- `src/types.ts`

### 3cbe7cf feat(T5): preserve GPX round trips and add autosave and sharing

- `src/gpx.test.ts`
- `src/gpx.ts`
- `src/main.ts`
- `src/persistence.test.ts`
- `src/persistence.ts`
- `src/types.ts`

### 2ba0e98 feat(T6): responsive draggable route panel and browser-verified UI

- `H_README.md`
- `index.html`
- `package.json`
- `src/main.ts`
- `src/panel.ts`
- `src/places.ts`
- `src/routing.test.ts`
- `src/routing.ts`
- `src/style.css`

### 69d9529 feat(T7): add optional official Google Map Tiles basemaps

- `.env.example`
- `.gitignore`
- `H_README.md`
- `public/GOOGLE_ATTRIBUTION_NOTICE.txt`
- `public/google-maps.svg`
- `src/google-layer.ts`
- `src/google.test.ts`
- `src/google.ts`
- `src/main.ts`
- `src/map.ts`
- `src/style.css`

### 共有URL後の自動保存修正（本書を含む最終コミット）

- `src/persistence.ts`
- `src/persistence.test.ts`
- `src/main.ts`
- `H_README.md`

最終検証: npm test = 8ファイル・26テスト成功、npm run build = 型検査とViteビルド成功。git diff --check 成功。git grepでGoogleキー形式と秘密鍵ヘッダーの一致なし、.env.local はgit check-ignoreで対象外を確認。
