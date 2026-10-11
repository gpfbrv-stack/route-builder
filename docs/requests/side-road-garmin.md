推奨モデル: gpt-6-astra / reasoning: medium

# ガーミン送信エラーの修正と、脇道に置いた経由点の前後を脇道優先にする(ブランチ feature/side-road)

## 目的
リポジトリ C:\Users\yuhei\route-builder(Vite + TypeScript + Leaflet、GitHub Pages で公開中)。ユーザー報告2件。

## T1. ガーミン送信の「FITを送信・保存できませんでした。Permission denied」
- 状況: PC(Windows の Chrome)で「ガーミンへ送る」を押すとトーストに上記エラー。PC版 Chrome にも `navigator.share` と `canShare({files})` があり、
  共有シート経由を試みて `NotAllowedError`(ユーザー操作の猶予切れ等)で失敗している。
- 変更(`src/ui/garmin.ts` と関連テスト):
  1. 共有シートを使うのはタッチ端末(`matchMedia('(pointer: coarse)').matches`)かつ `canShare({files})` が真の時だけ。PCは常にダウンロード+手順ダイアログ。
  2. 共有で `AbortError`(ユーザーが閉じた)以外の例外(`NotAllowedError` など)が出たら、ダウンロード+手順ダイアログに切り替える(エラーにしない)。
  3. 共有を試みる前に FIT 生成を完了させておく(既存の先読み preloadFit に加え、ボタン押下からshare呼出しまでに await を挟まない構成にできる部分はそうする)。
- テスト: PC(pointer: fine)で share を呼ばずにダウンロード、タッチ端末で share 成功、AbortError で何もしない、NotAllowedError でダウンロードにフォールバック。

## T2. 脇道に置いた経由点の前後の区間を「脇道優先」で計算する
### 背景(レビュー側で実データ確認済み)
- 経路は区間ごとに計算されるため、ユーザーが脇道上に経由点を置いても、次の区間は主要道優先(road-jp / gravel-jp)で計算され、すぐ国道に戻る。
- 脇道優先の設定 `src/brouter-profiles/road-jp-side.brf` と `gravel-jp-side.brf` を用意済み(**内容は変更しない**。trunk 1.6 / primary 1.5 / secondary 1.3 / tertiary 1.1 / unclassified 1.0 / residential 1.05 / service 1.2)。
- 実データ(長和町和田、経由点 36.225736,138.239186 → 次の経由点 36.151767,138.144500、グラベル): 経由点を出て最初の3km、主要道優先は trunk 2.5km(すぐ国道へ戻る)、
  脇道優先は tertiary 2.2km+unclassified 0.8km(そのまま脇道を進み、その先で国道に合流)。

### 変更
1. 区間ごとの優先 `legPrefer: ('main' | 'side')[]`(長さ=経由点数−1、既定 'main')を状態に追加。共有URLは v5(v4以前は全区間 'main')、localStorage も保存。
   継承規則は既存の legProfiles/legMode と同じ(挿入で分割=元の区間の値、削除で結合=前側の値)。
2. `config.profiles` に脇道版の custom キーを追加(road→'road-jp-side'、gravel→'gravel-jp-side'。mtb は対象外)。`ProfileRegistry` で同様に登録・再登録する。
   ルーティングのキャッシュキー・描画の区間キーに legPrefer を含める。
3. 自動判定(ユーザーの編集操作のみ: 地図クリックでの追加、ルート線ドラッグでの挿入、経由点のドラッグ移動。共有URL読込・GPX読込・Undo/Redo では判定しない):
   - 対象の経由点に接する 'road' 区間を、まず現在の legPrefer で計算した結果から、その経由点が乗った道の種類を取る
     (出ていく区間は BRouter messages の最初の行の WayTags、入ってくる区間は最後の行の WayTags の highway)。
   - 主要道 = trunk / primary / secondary(_link 含む)。それ以外の highway(tertiary, unclassified, residential, living_street, service, track 等)を脇道とする。
   - 脇道なら、その経由点に接する区間(前後最大2区間)を 'side' にして再計算。主要道なら 'main' にして(変化があれば)再計算。
   - この自動変更は、元の編集操作と同じ Undo 1回で戻るようにする(履歴を増やさない)。
   - ステータス(info)/トースト: 「経由点が脇道上にあるため、前後の区間を脇道優先で計算しました」。
4. UI: 経由点リストの区間表示に、'side' の時は「脇道優先」を併記(例「グラベル・脇道優先」)。区間メニューに「主要道優先にする/脇道優先にする」(Undo 1回)。
   「全区間を引き直す」は legPrefer を変えない。
5. テスト: legPrefer の継承と共有URL v1〜v5 往復、自動判定(脇道→side・主要道→main、読込/Undoでは判定しない)、Undo 1回で編集と自動変更がまとめて戻る、
   キャッシュキー分離、mtb/gsi/straight 区間は対象外、区間メニューの手動切替。

## 対象ファイル(変更してよいもの)
- `src/ui/` 配下, `src/main.ts`, `src/state.ts`, `src/types.ts`, `src/routing.ts`, `src/routing.test.ts`, `src/persistence.ts`, `src/persistence.test.ts`,
  `src/brouter-profiles.ts`, `src/brouter-profiles.test.ts`, `src/config.ts`(追加のみ), `src/style.css`, `H_README.md`
- `src/brouter-profiles/*.brf` は読むだけ。それ以外は変更しない。npm操作なし。

## 受け入れ条件
- `npm test` 全緑、`npm run build` 成功。既存機能の回帰なし。外部サービスへの手動試験リクエストなし(レビュー側で実データ確認)。
- タスクごとに完了させ、テストが赤のまま次へ進まない。コミットは不要(レビュー側で行う)。

## 報告形式
- タスクごとの変更ファイル一覧 / 実行したテストとビルドの結果(件数) / 仕様から意図的に変えた点 / 未解決事項
