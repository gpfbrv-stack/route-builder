# ルートビルダー

自転車の個人用ルート作成ツール。Vite + TypeScript + Leaflet 1.9、静的配信のみ。

## 起動

Node.js 22.12以上（開発時24）で `npm install` → `npm run dev`。
ブラウザで http://localhost:5173 を開きます。`npm test` で検証、`npm run build` で `dist/` に出力。

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
