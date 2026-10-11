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

1. 地図で2点以上をクリック／タップ。S（スタート）・番号・G（ゴール）のマーカーをドラッグして移動します。削除はマーカーのポップアップ、または経由点一覧の「…」内の×から操作します。
2. 山サイ／グラベル／ロードは、これから末尾に追加する区間の走り方です。切り替えても既存区間は再計算しません。各経由点の「次の経由点まで」に走り方を表示します。変更する場合はポップアップ／一覧の「…」から「この区間を現在の設定で引き直す」を選択。全区間の引き直しはPC編集バー／スマホ上部の「…」から操作でき、それぞれ「元に戻す」1回で戻ります。「線の引き方」は「道に沿う／地理院の道／直線」の3択で、これから追加する区間にだけ適用します。
3. 標高グラフをなぞって地図上の位置を確認します。Tabでグラフに移動し、左右キーでも操作できます（Home／Endで端へ）。色は500m区間の平均勾配。欠測を含む区間は塗りません。
4. スマホのシート上端のつまみをタップすると最小（168px）→半分→全体（88%）の順に切り替わります。ドラッグして離すと最寄りの高さへ移動します。キーボードではEnter／上下キーで操作できます。上部の「…」から線の引き方・読込・共有・全消去を操作します。
5. ルート名を入力し、標高・峠検索まで完了したら「ガーミンへ送る」（スマホは「ガーミン」）でFITを出力します。GPXはPCの「GPX」、スマホの「…」→「GPXで保存」から保存できます。GPXを再読込すると形状・標高を保持します。経由点等を編集した時点で道路探索を再実行します。
6. 共有URL（v4）には経由点・現在の走り方と線の引き方・区間ごとの走り方と線の引き方・名称を含みます。旧v3の区間別ON/OFFは「道に沿う／直線」に移行します。旧v1 URLは全区間を保存時の走り方として読み込みます。旧v1/v2 URLの「道に沿う」は全区間に保存時の値を付けます。受信側で再計算するため、GPXの完全な形状保持にはGPXファイルを使います。URLには位置情報が含まれます。
7. 青いルート線をドラッグすると、その区間に経由点を挿入します。PCでは線の周囲24pxをつかめ、マウスを重ねると白い挿入ハンドルが現れます（経由点マーカー上では非表示）。スマホでは約400ms長押ししてからドラッグします。挿入・経由点移動のどちらも、ドラッグ中に前後の区間を400ms以上の間隔で再計算します。取得待ちは破線、取得後は道に沿った実線で表示し、離すと最終位置で確定。「元に戻す」1回で取り消せます。線への挿入はEscでキャンセルできます。GPXの形状保持中は線からの挿入を無効にしています。
8. 地図右上のレイヤーボタンから背景を選択します。選択は次回起動時に復元します。「現在地」は位置情報の許可後に青い点を表示して移動します（追従しません）。

共有URLは読込後にハッシュを取り除きます。その後の再読込は自動保存した編集内容を復元します。

区間ごとの走り方と線の引き方は自動保存・共有URL v4に含みます。線の引き方の3択はこれから末尾に追加する区間だけに効き、既存区間を再計算・再描画しません。線への挿入で分割する2区間は元の設定を引き継ぎ、経由点の移動でも変わりません。途中の経由点を削除すると、結合区間は前側の設定を引き継ぎます。「この区間を現在の設定で引き直す」「全区間を現在の設定で引き直す」は走り方と線の引き方の両方を現在値にし、元に戻す1回で取り消せます。区間表示は道に沿う区間なら走り方名、地理院の道なら「地理院」、直線区間なら「直線」です。GPX読込では全区間に現在の走り方・線の引き方を付け、元の形状・標高を保持します。走り方や線の引き方の選択だけではGPX形状を解除しません。経由点の編集・引き直し操作を行うと形状保持を解除します。

編集時は計算済みの変更されていない区間をそのまま表示し、再計算が必要な区間だけを破線の直線で表示します。結果が届いた区間から実線に置き換わります。直線区間は実線のままで、BRouterへ要求しません。ドラッグ中の古い結果は表示せず、通信中の移動は最新位置にまとめます。通常計算とライブ計算は同じ区間キャッシュと同時2リクエストの上限を共有します。

FITの種別（subSport）は、「道に沿う」区間の計算済み距離を走り方別に合計して最長のものを採用します。同距離ならルート上で先に現れる走り方、対象区間が無い場合や距離がすべて0なら現在の走り方を使います。仮想速度の既存設定は変更しません。

## ガーミンへ送る

「ガーミンへ送る」はFITファイルを作成します。ファイル共有に対応した環境では共有シートが開くので、Connectを選んで保存し、デバイスに送信してください。共有を取り消すと何もせず終了します。

ファイル共有に対応しない環境ではFITをダウンロードし、取り込み手順を表示します。

- PC: Garmin Connect（connect.garmin.com）→「トレーニングとプランニング」→「コース」→「コースをインポート」→ FITを選択 → 保存 →「デバイスに送信」。
- スマホ: ファイルアプリでダウンロードしたFITを開く →「共有」→「Connect」→ 保存 →「デバイスに送信」。うまくいかない場合はPCから取り込んでください。

Garminの画面名は変わることがあります。手順は「閉じる」またはEscで閉じられ、「次回から表示しない」の選択をブラウザに保存します。このアプリからGarminサーバーへの通信は行いません。共有URLの「共有」は従来どおり別の操作です。

FITには峠・山をコースポイントとして含めます。「表示中の補給・休憩を含める（FIT・GPX）」がONなら、表示ONの補給・休憩も含めます。FITの自販機は一覧と同じ集約代表点を使い、GPXは従来どおり1台ずつ出力します。FITのポイントは最大100件、名称はUTF-8で15バイトまでです。実際のConnectへの取り込みとデバイス表示は実機で確認してください。

## 設定と制限

`src/config.ts` にプロファイルと閾値を集約しています。山サイ=mtb-jp、グラベル=gravel-jp、ロード=road-jp。山サイで経路が見つからない場合はtrekking-jpを試します。BRouterは500ms待機・同時2リクエスト、成功区間を512件メモリ保存。失敗区間は地理院の道で自動救済を試し、それも失敗したら直線＋通知で代替します。失敗を永久キャッシュしません。

日本のOSMでは一般の国道が `highway=trunk` に分類されるため、欧州向けの標準設定では脇道・林道への大きな迂回が生じることがあります。同梱の日本向け `.brf` はtrunkの扱いをprimary並みに調整しています。高速道路・`motorroad=yes` の通行不可は維持しています。

日本向け設定は初回利用時に全文をBRouter（`https://brouter.de/brouter/profile`）へPOSTし、返されたカスタムIDで経路を計算します。IDはメモリとsessionStorageで再利用し、同時要求の登録をまとめます。保存できない環境ではメモリのみを使います。カスタムIDでHTTP 500が返った場合はIDを破棄・再登録して1回だけ再試行します。初回登録または再登録に失敗した場合は標準設定（mtb／gravel／fastbike、代替はtrekking）を使い、標準設定で経路を取得できた場合に「日本向け設定を使えず標準設定で計算しました」と警告します。

標高は20m間隔、z=14、DEM5A→DEM10B（正式ID `dem_png`）。タイル128枚までメモリ保存。欠測は補完せず登降計算の連続性を切ります。5m以上の反転を確定するヒステリシスで登降を集計し、最高点はサンプル最大値。GPX頂点の標高は周辺サンプルから補間し、既存GPXの標高は保持します。DEM完全欠測ではGPXのeleを省略して通知します。

峠・山は地理院の注記（experimental_anno、z15）を先に表示し、OSMの応答が届いたら統合します。注記のknjはUTF-8の地名です。0332のうち「峠・乗越・越」で終わる地名を峠、0312を山として扱い、0311（山の総称）は除外します。峠はルートから250m以内をルート上の最近点へ配置し、その点のDEM標高を使用。山は200m以内を対象に、注記点と周囲150mの8方向（合計9点）のDEM最大値を使います。注記点は実際の地点とずれることがあり、実際の登頂・通過を保証しません。

注記タイルはルートbboxに0.003度の余白を付け、同時4リクエスト・15秒タイムアウト・LRU 200枚で取得します。404は空として保存し、他の失敗は保存しません。1回80枚までで、bboxが超過する場合はルート沿い（区間途中と近傍タイルを含む）に限定。それでも80枚を超える場合は全体から分散選択するため、一部の地名は取得できません。

OSM候補は従来どおり峠・鞍部100m／ピーク150m以内。同名（括弧内の読みを除いた完全一致）かつ500m以内は1件とし、OSM eleがあればOSMの位置・標高、なければ地理院の位置・DEM標高を採用します。地理院にないOSM地名も表示します。OSM失敗時も地理院やGPX由来の地名は保持します。ルート変更後1200ms待機、OSMは同時1検索、bboxを0.01度単位で外向きに丸め32件までメモリ保存。緯度・経度幅が2度を超えるOSM検索は省略します。

第2段階T1では、峠・山と補給・休憩候補を1回のOverpass POSTで取得します。POIはルート線をDouglas-Peuckerで30mから簡略化し、400点を超える場合は許容誤差を倍増。種類別半径のaround検索から、元のルート線との距離でさらに絞ります（コンビニ・商店300m、自販機100m、水場・トイレ200m、道の駅500m）。way/relationはcenterを使います。T2で地図・一覧表示と自販機の集約、T3で標高グラフへの表示とGPX出力を追加しました。

補給・休憩はコンビニ・商店・自販機・水場・トイレ・道の駅の6種類。トイレのみ既定OFFで、チップの表示切替はlocalStorageに保存します。名称はname:ja→name→brand→種類名、営業時間24/7は「24時間」と表示。自販機はルート上で隣り合う自販機の間隔が200m以内なら連続してまとめ、先頭の位置・距離・営業時間を代表として表示します。チップの件数はまとめる前の台数です。

一覧は距離順に30行ずつ追加表示し、行のボタンから地図のポップアップを開きます。地図の印はズーム13未満で12pxの点になり、ルート・経由点・峠ラベルの下に表示します。「Googleマップで確認」はクリック時に新しいタブを開くリンクです。スマホも同じセクションをシート内でスクロールできます。

補給なし最長区間はコンビニ・商店・道の駅だけを補給点として始点・終点を含めて計算し、20km以上で注意表示します。チップをOFFにしても計算は変わりません。OSM未登録の店や営業状況は反映されないため、実際の補給の可否を保証するものではありません。取得に失敗した場合は区間を表示しません。GPX読込時もPOIを検索し、検索失敗時も読み込んだ峠・山は保持します。

標高グラフは20km以上の補給なし最長区間を勾配の塗りの下に帯で表示し、表示ONの補給・休憩をx軸のすぐ上に種類色の点で表示します。自販機の点は一覧・地図と同じ集約単位です。峠・山の名前は全角11px相当で幅を見積もり、最大3段に配置します。収まらない場合は峠を優先し、名前を省略した地物も▼を残します。検索開始時は前のルートの注意・件数・一覧・地図の印・グラフの点と帯を消します。表示ONが0種類の場合だけ種類の選択を促し、ONの種類に該当0件の場合は地物が見つからなかった旨を表示します。

「表示中の補給・休憩を含める（FIT・GPX）」は既定ONで、選択をlocalStorageに保存します。GPXではONなら表示ONの種類の元地物を1件ずつwptに出力します（一覧でまとめた自販機も元の名称・座標を保持）。名称と種類名に加え、コンビニ・商店はConvenience Store、自販機・水場はDrinking Water、トイレはRestroom、道の駅はRestaurantのsymを付けます。OFFでも峠・山のwptは残ります。読込時はtypeがこの6種類の表示名であるwptを峠・山に取り込まず、POIはOSMから検索し直します。

峠候補のbboxキャッシュは維持し、POI候補は検索クエリ単位で別途32件まで保存します。同じbboxでも検索する線が変われば統合リクエストを送ります。同じ簡略線でも距離判定は元のルートで毎回行います。接続失敗・タイムアウト・HTTP 429/5xx・本文のrate_limited/timeoutでは、overpass-api.de → maps.mail.ru/osm/tools/overpass → overpass.private.coffeeの順に切り替えます（各30秒）。最後に成功した接続先をセッション中は優先。全接続先が失敗した場合だけ「Overpassが混雑中」と通知し、30秒後に1回だけ全接続先を再試行。待機中も取得キューを保持し、ルート変更で古くなった再試行は省略します。失敗応答はキャッシュしません。

GPXは20MB・100,000点以内・単一の連続トラック（またはrte）に対応。複数trksegを直線でつながずエラーにします。編集経由点は200点まで、外部GPXは約500m以上の間隔で間引きます。Undoは50操作。localStorage失敗時も操作・GPX保存は継続します。

地理院の道は、地理院の道路中心線（experimental_rdcl、z16）を取得してブラウザ内で最短経路を計算します。徒歩道・通行止め・廃道も対象で、自動車専用道路のみ除外します。走り方の値は保持しますが、この計算では使いません。最寄りの道が300m以内に無い場合や道がつながらない場合は理由を通知して直線表示します。範囲が300タイルを超える場合は途中に経由点を追加してください。上限は src/config.ts の gsi.tileLimit で管理します。タイル取得は同時6、15秒タイムアウト、メモリLRU400枚です。

BRouterに成功した「道に沿う」区間でも、経路長が直線距離の2.5倍と「直線距離＋1km」の両方を超える場合は、バックグラウンドで地理院の道と比較します（同時1区間、比較失敗は通知しません）。地理院の経路長がOSMの60%未満ならステータス行と経由点一覧に提案を表示します。「切り替える」または「すべて切り替える」で対象区間だけを地理院の道に変更し、元に戻す1回で取り消せます。自動では切り替えません。短さは通行可能であることを保証しません。編集・切り替え・「閉じる」で提案を消し、同じ区間・同じ比較結果の提案は起動中に再表示しません。判定閾値は src/config.ts の gsi.detourRatio / gsi.detourExtraM にあります。

道に沿う区間はBRouterの代替経路も失敗した後、地理院の道で自動救済を試みます。成功しても区間の設定は「道に沿う」のままで、結果と警告を保持します。地理院の道を使うと通行可否を確認していない旨を起動中に1回通知し、使用中だけ地図に「道路中心線: 地理院タイル」を表示します。自動救済でも同じ出典を表示します。FITのsubSportは「道に沿う」区間だけの距離を集計し、該当区間が無ければ現在の走り方を使います。

## 構成

- `geo.ts`, `elevation.ts`, `gpx.ts`, `persistence.ts`: 純関数・入出力境界
- `routing.ts`, `dem.ts`, `osm.ts`: 外部データ供給（依存を注入してテスト可能）
- `places.ts`: OSM峠候補の距離判定・地理院との同名統合・段階表示
- `gsi-places.ts`: 地理院z15注記の取得・近接判定・DEM標高補完
- `map.ts`, `chart.ts`, `panel.ts`: 表示
- `main.ts`, `state.ts`: 状態・画面連携

FITの生成は `fit.ts`、共有・ダウンロードと取り込み手順は `ui/garmin.ts` に分離しています。バックエンド・分析送信・Service Workerはありません。

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
