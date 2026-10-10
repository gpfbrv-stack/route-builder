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
