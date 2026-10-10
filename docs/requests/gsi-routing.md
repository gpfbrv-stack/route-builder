推奨モデル: gpt-6-astra / reasoning: high

# 地理院の道で線を引く(ブランチ feature/gsi-routing)

## 目的
自転車用ルートビルダー(C:\Users\yuhei\route-builder、Vite + TypeScript + Leaflet、静的サイト)は、経路計算に BRouter(OSMデータ)を使っている。
地理院地図に描かれている山道・徒歩道がOSMに無い・通れない扱いのため、線が引けない場所がある(ユーザー報告: 榛名山南西、松之沢峠〜黒岩〜風穴の谷沿いの道)。
**地理院の道路中心線データを使って、ブラウザ内で経路計算する** 区間モードを追加する。
ユーザーは「通行止め・廃道でも線が引けるなら好都合」と明言しているので、通行可否で除外しない(高速道路等の自動車専用だけ除外)。

## 確認済みの事実(レビュー側で実データ確認)
- 地理院 道路中心線 GeoJSON タイル: `https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/16/{x}/{y}.geojson`(z16 のみで使う)。
  Content-Type は application/octet-stream。`FeatureCollection`、geometry は `LineString`(MultiLineString が来ても処理できるようにする)。
- 文字列属性(type/rdCtg/rnkWidth 等)は **配信データ自体が文字化け(U+FFFD)** しているので使わない。使う属性は数値・コードのみ:
  - `ftCode`: '2701' 道路(通常部)、'2703' / '2704' / '2711' その他の道路区分、'2721' 徒歩道。全部使う。
  - `motorway`: 1 = 自動車専用(**除外**)、0 / 9 = 対象。
- 1タイルは z16 で一辺約450〜500m。地物数は数十〜百程度。
- 既存構造: 区間ごとの走り方 `legProfiles` と道に沿う `legFollow`(src/types.ts、src/state.ts、共有URL v3、直前のコミット 0bf73d3)。
  区間の描画 `src/ui/route-line.ts`、ライブ経路 `src/ui/route-preview.ts`、BRouter呼出し `src/routing.ts`。DEM標高・POI・峠・GPX/FITは区間の形状から計算されるので、形状さえ返せば流用できる。

## 対象ファイル(変更してよいもの)
- 新規 `src/gsi-router.ts` と `src/gsi-router.test.ts`
- `src/types.ts`, `src/state.ts`, `src/main.ts`, `src/routing.ts`, `src/routing.test.ts`, `src/persistence.ts`, `src/persistence.test.ts`,
  `src/gpx.ts`, `src/gpx.test.ts`(読込時の付与のみ), `src/config.ts`(gsi 設定の追加のみ), `src/ui/` 配下, `src/style.css`, `H_README.md`
- それ以外は変更しない。npm操作なし。

## 変更内容(タスクごとに1コミット相当。各タスク後に npm test / npm run build 緑)

### T1. 地理院の道での経路計算(純ロジック、`src/gsi-router.ts`)
- `GsiRouter.route(a, b, isCurrent): Promise<Segment>`。
  1. 区間の範囲(a,b の bbox に、max(400m, 直線距離の30%) の余白)を覆う z16 タイルを列挙。**上限 120 タイル**。超えたら
     `Error('区間が長すぎます。途中に経由点を追加してください')`。
  2. タイル取得(同時6、タイムアウト15秒、メモリLRU 400枚、失敗はキャッシュしない。404 は「道なし」の空タイルとして扱う)。
  3. グラフ構築: 頂点座標を 1e-6 度で丸めて節点化(タイル境界で切れた線をつなぐため、さらに端点同士が **2m 以内** なら同一節点に統合)。
     辺の重み = 距離(m)。`motorway === 1` の地物は除外。
  4. 始点・終点を最寄りの辺へ射影して仮節点を作る(**300m 以内**。無ければ `Error('近くに地理院の道がありません')`)。
  5. A*(ヒューリスティック=直線距離)で最短経路。つながっていなければ `Error('地理院の道がつながっていません')`。
  6. 返す形状 = [a, 射影点, …経路…, 射影点, b](a/b から射影点までは短い直線)。
- テスト(合成GeoJSON): タイル境界をまたぐ線の連結、2m以内の端点統合、motorway 除外、徒歩道(2721)を使う、射影点での辺分割、
  300m 超で例外、非連結で例外、120タイル超で例外、404 を空として扱う、LRU と同時実行上限。

### T2. 区間モード「地理院の道」とUI
- 区間の線の引き方を3種類にする: `'road'`(道に沿う=BRouter)/ `'gsi'`(地理院の道)/ `'straight'`(直線)。
  既存の `legFollow: boolean[]` を `legMode: LegMode[]` に置き換える(true→'road'、false→'straight' で移行)。
  全体の既定値(これから引く区間に使う)も3種類にする。継承規則・「この区間を現在の設定で引き直す」「全区間を引き直す」・Undo の挙動は既存と同じ。
- UI: PCサイドバーの「道に沿う」スイッチを、3択のセグメント「線の引き方: 道に沿う | 地理院の道 | 直線」に置き換える
  (既存の `.seg` の小型版。aria-pressed)。スマホは「…」メニュー内の同じ3択(ラジオ相当)。
  切替時のステータス(info): 「これから引く区間を◯◯で引きます」。切替で既存区間は再計算しない。
- 経由点リストの区間表示: 'gsi' は「地理院」、'straight' は「直線」、'road' は走り方名。
- 'gsi' 区間の描画は他と同じ線。計算中は既存の破線仮線。ライブドラッグ(400ms間引き)も 'gsi' で動くようにする(タイルはキャッシュされる)。
- 'gsi' 区間を含むとき、ステータス(info)に「地理院の道で引いた区間は通行可否を確認していません(廃道・通行止めを含む場合があります)」を1回出す。
- **'road' 区間の自動救済**: BRouter で失敗した区間(mtb の代替 trekking-jp も失敗した後)は、直線にする前に地理院の道で計算を試み、
  成功したら warn「OSMで経路が見つからないため地理院の道で計算しました」。その区間の legMode は 'road' のまま(結果だけ地理院の形状)。
- 'gsi' 区間の走り方 legProfiles は保持するが計算には使わない(FIT subSport の集計は 'road' 区間のみで行い、無ければ現在の走り方)。
- 保存・共有: localStorage と共有URLに `legMode`。共有URL v4(v3 の legFollow、v2/v1 の followRoad から移行)。GPX読込は全区間を現在の既定値。
- 出典表示: 地図の帰属表示に「道路中心線: 地理院タイル」を、'gsi' 区間があるときだけ追加。
- テスト: 3択の切替で既存区間に影響しない、継承規則、v1〜v4 の共有URL往復、'gsi' 区間でBRouterを呼ばない、自動救済(BRouter失敗→gsi成功/gsiも失敗→直線)、帰属表示の追加・削除。

## 受け入れ条件
- `npm test` 全緑(既存215件+新規)、`npm run build` 成功。既存機能の回帰なし。375px幅で横スクロールなし。
- 地理院タイル・BRouter への手動試験リクエストはしない(レビュー側で実データ確認)。

## 制約
- 対象ファイル以外は変更しない。外部通信先は従来に加え `cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/` のみ。コミットは不要(レビュー側で行う)。

## 報告形式
- タスクごとの変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
