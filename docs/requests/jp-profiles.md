推奨モデル: gpt-6-astra / reasoning: medium

# 日本向けBRouterプロファイルへの切り替え(ブランチ feature/jp-profiles)

## 目的
ロード等で国道を避けて脇道・林道へ迂回する問題を直す。原因と対策はレビュー側で実データ確認済み。
リポジトリ: C:\Users\yuhei\route-builder(Vite + TypeScript + Leaflet、静的サイト)。

## 確認済みの事実
- OSMの日本では一般の国道が `highway=trunk`。BRouter標準プロファイルは欧州向けで trunk を強く避ける
  (fastbike 10倍、gravel 20〜80倍、mtb 8.2倍、trekking 10倍)。例: 大津市伊香立下在地町→途中町で fastbike 6.8km(国道1.4km)。
- 日本向けに trunk を primary 並みにした4ファイルを `src/brouter-profiles/` に用意済み(**内容は変更しない**):
  `road-jp.brf`(fastbike基)、`gravel-jp.brf`、`mtb-jp.brf`、`trekking-jp.brf`。高速道路・motorroad=yes は元のまま通行不可。
  同区間で road-jp 4.2km(国道3.6km)、gravel-jp 4.9km、mtb-jp 4.7km。
- BRouter公開サーバーのカスタムプロファイル:
  - 登録: `POST https://brouter.de/brouter/profile`、本文=プロファイル全文(text/plain)。応答 `{"profileid":"custom_1791628399763"}`。
  - 利用: ルーティングURLの `profile=<profileid>`。
  - 存在しないID(サーバー側で消えた等)を指定すると **HTTP 500・本文空**。
- mtb-jp でも鞍馬駅付近(35.1180,135.7706)始点は「no track found」。既存の代替(fallback)は引き続き必要で、代替先は trekking-jp にする。

## 対象ファイル(変更してよいもの)
- `src/routing.ts`, `src/routing.test.ts`, `src/config.ts`(profiles の api/fallback 変更と custom 指定の追加のみ), `src/types.ts`
- 新規 `src/brouter-profiles.ts` と `src/brouter-profiles.test.ts`
- `src/main.ts`(ステータス表示の配線が必要な場合のみ), `H_README.md`
- `src/brouter-profiles/*.brf` は読むだけ。それ以外は変更しない。npm操作なし。

## 変更内容(1コミット相当)
1. `config.profiles` を次の形にする: 各走り方に `custom`(.brfのキー)と、取得できない時の標準プロファイル `api` を持たせる。
   - mtb: custom `mtb-jp`、api `mtb`、fallback `['trekking-jp']`(代替も custom。代替の標準は `trekking`)
   - gravel: custom `gravel-jp`、api `gravel` / road: custom `road-jp`、api `fastbike`
2. `src/brouter-profiles.ts`: .brf を Vite の `?raw` import で取り込み、`ProfileRegistry.id(key)` で profileid を返す。
   - 初回は POST で登録し、id をメモリと sessionStorage(try/catch)に保存。同時要求は1つの登録Promiseを共有。
   - `invalidate(key)` で破棄できる。登録失敗(通信・不正応答)は例外。
3. `Router`: 区間の計算でカスタムIDを使う。応答が **HTTP 500 かつカスタムID使用時** は `invalidate` → 再登録 → 1回だけ再試行。
   - 再登録も失敗した場合は、その走り方の標準 `api` で計算し、ステータスに warn「日本向け設定を使えず標準設定で計算しました」。
   - 既存の fallback(mtb→trekking-jp)・直線フォールバック・区間キャッシュ・同時実行数・タイムアウトの挙動は維持。
   - キャッシュキーは走り方キー+区間のまま(プロファイルIDは含めない)。
4. 既存テストを緑のまま、追加テスト: 初回登録と再利用、同時要求で登録1回、500→再登録→成功、再登録失敗→標準プロファイル+warn、
   mtb失敗→trekking-jp、`profileUsed` の値。
5. `H_README.md` の「設定と制限」に、日本向けプロファイルの理由・変更点・登録の仕組みを追記。

## 受け入れ条件
- `npm test` 全緑(既存141件+新規)、`npm run build` 成功。
- ルーティング要求の `profile=` に custom_ID が使われ、登録は走り方ごとに1回(セッション内)。
- BRouterへの手動試験リクエストはしない(レビュー側で実データ確認)。

## 制約
- 対象ファイル以外は変更しない。`.brf` の内容は変えない。外部通信先は brouter.de のまま。
- コミットは不要(レビュー側で行う)。

## 報告形式
- 変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
