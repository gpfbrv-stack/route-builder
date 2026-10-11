推奨モデル: gpt-6-astra / reasoning: medium

# 表示改善・山サイ既定・峠名の安定化・路面表示(ブランチ feature/display-surface)

## 目的
リポジトリ C:\Users\yuhei\route-builder(Vite + TypeScript + Leaflet、GitHub Pages で公開中)。ユーザー要望5点に対応する。
1. ルートの線を半透明にする。
2. 山サイを選んだら「線の引き方」の既定を「地理院の道」にする(ユーザーは山サイを、林道が切れた短い区間を結ぶためだけに使う)。
3. 経由点マーカーが大きいので小さくする。
4. 峠名が表示されない(Overpass が応答しない時に峠・山が全く出ない)。
5. 標高グラフで、勾配の代わりに「舗装路/グラベル(未舗装)」を表示したい。

## 確認済みの事実(レビュー側で実データ確認)
- Overpass: 2026-10-11 時点で `overpass-api.de` が接続失敗、`overpass.private.coffee` と `overpass.kumi.systems` は HTTP 500、
  `maps.mail.ru/osm/tools/overpass/api/interpreter` は 17秒で正常応答。現状は overpass-api.de のみ使用。
- 地理院 注記 GeoJSON タイル: `https://cyberjapandata.gsi.go.jp/xyz/experimental_anno/15/{x}/{y}.geojson`(**z15 のみ**。z14/z16 は404)。
  文字列は正しい UTF-8(例: knj「和田峠」、kana「わだとうげ」)。※以前「地理院タイルの文字列属性は文字化け」と記録したのは、
  レビュー側のコンソール表示の誤認だった。H_README.md 等にその記述があれば訂正する。
  - properties: `ftCode`, `annoCtg`, `knj`, `kana`, `arrng`, `arrngAgl`, `gaiji` など。geometry は Point(注記の配置点。実際の地点から100m程度ずれることがある)。
  - ftCode '0332' = 陸域自然地名(岩、温泉等)。**峠はここに含まれる**(例: 和田峠、花背峠、松之沢峠)。knj が「峠」「乗越」「越」で終わるものを峠とする。
  - ftCode '0312' = 山地(山、岳、峰等)(例: 鉢伏山、高ボッチ山)。'0311' は山の総称(榛名山)で対象外。
- BRouter の GeoJSON 応答 `features[0].properties.messages` は、ヘッダ行 + 区間ごとの行で、各行に `Longitude`,`Latitude`(1e6倍の整数)、`Distance`、
  `WayTags`(例: `highway=trunk surface=paved maxspeed=50`、`highway=track tracktype=grade2`)を持つ。各行の座標はその道区間の終点。

## 対象ファイル(変更してよいもの)
- `src/style.css`, `src/main.ts`, `src/state.ts`, `src/types.ts`, `src/config.ts`(追加のみ), `src/routing.ts`, `src/routing.test.ts`,
  `src/places.ts`, `src/places.test.ts`, `src/osm.ts`, `src/osm.test.ts`, `src/chart.ts`, `src/ui/` 配下, `H_README.md`
- 新規: `src/gsi-places.ts` と `src/gsi-places.test.ts`、`src/surface.ts` と `src/surface.test.ts`
- それ以外は変更しない。npm操作なし。

## 変更内容(タスクごとに1コミット相当。各タスク後に npm test / npm run build 緑)

### T1. 線・マーカー・山サイ既定
- ルート本線を半透明に: 本線 opacity 0.7、白い縁取り opacity 0.5(計算中の破線仮線は現状のまま)。
- 経由点マーカーを小さく: 直径 28px → 20px、白枠 3px → 2px、文字 12px → 11px(S/G/番号とも)。当たり判定(ドラッグしやすさ)は 28px 相当を保つ
  (見た目だけ小さくし、divIcon の iconSize は 28 のまま中央に 20px の円を置く等)。
- 走り方ごとに「線の引き方」の既定を持つ: 山サイ→'gsi'、グラベル/ロード→'road'(`config` に置く)。走り方を切り替えると線の引き方の既定も切り替わる。
  ユーザーがその後に線の引き方を手で変えたら、その走り方の既定として localStorage に記憶する(try/catch)。既存区間は変えない(現行どおり)。
- 'gsi' 区間が地理院で引けない場合(区間が長すぎる・近くに道がない・道がつながらない)は、走り方の BRouter(山サイなら mtb-jp → trekking-jp)で計算し、
  それも失敗したら直線。ステータス warn「地理院の道で引けないため ◯◯ で計算しました」。
- テスト: 走り方切替で既定の線の引き方が変わる・手動変更の記憶、gsi 失敗時のフォールバック順。

### T2. 峠・山名の安定化(地理院注記を主、OSMを補助)
- `src/gsi-places.ts`: ルートの bbox(+余白0.003度)を覆う z15 注記タイルを取得(同時4、LRU 200枚、404は空、タイムアウト15秒、上限80タイル。超える場合はルート沿いのタイルだけに絞る)。
  - 峠: ftCode '0332' かつ knj が /(峠|乗越|越)$/。ルートからの距離 ≤ 250m。表示位置はルート上の最近点。標高はその最近点のDEM標高。
  - 山: ftCode '0312'。ルートからの距離 ≤ 200m。標高は注記点の周囲150m(9点)のDEM最大値。
  - 既存 Place 型に合わせる(name=knj、kind、routeDistance、offset、elevationSource='DEM')。
- 既存のOSM峠・山(Overpass)と統合: 同名(読みを除く完全一致)で 500m 以内なら1つにまとめる(位置と標高はOSMの ele があればOSM、無ければ地理院+DEM)。
  地理院だけで先に表示し、OSMが届いたら統合して更新する(Overpass待ちで峠名が出ない状態をなくす)。
- Overpass の冗長化: エンドポイントを順に試す `['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter']`(config)。
  接続失敗・タイムアウト・429・5xx・本文の rate_limited/timeout で次へ。全滅したら既存の「30秒後に1回だけ再試行」。最後に成功したエンドポイントをセッション中は先頭にする。
  タイムアウトは1エンドポイント30秒。
- 峠セクションの出典表示を「地理院(注記)/ OSM」に。帰属表示に「地名: 地理院タイル」を追加。
- テスト: 0332+峠/乗越/越の抽出、0312抽出・0311除外、距離判定、同名統合、地理院先行表示→OSM統合、エンドポイント切替と記憶。

### T3. 路面(舗装/未舗装)表示
- `src/surface.ts`: WayTags 文字列から路面を分類する純関数 `classifySurface(tags): 'paved' | 'unpaved' | 'unknown'`。
  - unpaved: surface が unpaved/gravel/fine_gravel/compacted/dirt/earth/ground/grass/sand/mud/pebblestone/rock/woodchips のいずれか、
    または tracktype が grade2〜grade5、または highway が track/path/bridleway で surface も tracktype も無い。
  - paved: surface が asphalt/paved/concrete(concrete:* 含む)/paving_stones/sett/chipseal/metal、または tracktype=grade1、
    または surface が無く highway が motorway〜tertiary(_link含む)/unclassified/residential/living_street/service/cycleway。
  - それ以外(footway/steps 等で surface 無し)は unknown。
- `routing.ts`: BRouter 応答の messages から、区間形状の各点に路面分類を付ける(各行の座標までの点にその行の WayTags を適用)。
  'gsi' と 'straight' の区間は unknown。路面情報はキャッシュにも保持。
- 集計: 距離カードの下に1行「舗装 ◯km · 未舗装 ◯km · 不明 ◯km」(0kmの項目は省略)。
- 標高グラフ: 塗り分けを切り替えるセグメント「路面 | 勾配」を見出し横に置き、既定は「路面」(選択は localStorage に記憶)。
  路面の色: 舗装 `#8a94a6`、未舗装 `#b0763a`、不明 `#d9d9d9`(CSSトークン `--surf-paved` `--surf-unpaved` `--surf-unknown` に定義)。
  路面モードの凡例「舗装 / 未舗装 / 不明」。勾配モードは現行どおり。補給なし区間の帯・POI点・峠ラベル・ホバー吹き出しは両モード共通
  (吹き出しに路面も表示: 「◯km · ◯m · +◯% · 舗装」)。
- テスト: classifySurface の各規則、messages から点への付与(境界)、gsi/straight は unknown、集計の合計=総距離、グラフのモード切替と記憶。

## 受け入れ条件
- `npm test` 全緑(既存322件+新規)、`npm run build` 成功。既存機能の回帰なし。375px幅で横スクロールなし。
- 外部サービスへの手動試験リクエストはしない(レビュー側で実データ確認)。

## 制約
- 対象ファイル以外は変更しない。外部通信先の追加は `maps.mail.ru` と `overpass.private.coffee` の Overpass、および地理院 `experimental_anno` のみ。
- コミットは不要(レビュー側で行う)。

## 報告形式
- タスクごとの変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
