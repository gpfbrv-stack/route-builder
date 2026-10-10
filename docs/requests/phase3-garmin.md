推奨モデル: gpt-6-astra / reasoning: medium(T1のFIT生成はミスが実機で発覚しにくいので high)

# 第3段階: ガーミン向けFITコース出力と送信導線、山サイの経路失敗対策(ブランチ feature/phase3-garmin)

## 目的
自転車用ルートビルダー(C:\Users\yuhei\route-builder、Vite + TypeScript + Leaflet 1.9、静的サイト)で作ったルートを、
ガーミン(Edge等)で使いやすい **FITコースファイル** として出力し、スマホ・PCからGarmin Connectへ渡す導線を作る。
峠・山と補給・休憩は FIT の course_point(コースポイント)として入れ、デバイス上で「次の峠まで◯km」「次のコンビニまで◯km」が出るようにする。
あわせて、BRouterの山サイ(mtb)で一部区間の経路が見つからない問題をアプリ側で緩和する。

## 前提(確認済みの事実)
- Garmin Connect の公式コースAPIは2026年春から新規受付停止のため使わない。ユーザーが自分で Garmin Connect に取り込む前提。
- FIT生成には公式SDK `@garmin/fitsdk` 21.218.0 を使う(**導入済み**。package.json の dependencies にある。追加のnpm操作は不要)。
  `Encoder`(src/encoder.js)と `Decoder` がある。course_point の type 値は SDK の profile.js の `coursePoint` 列挙を参照
  (例: summit=1, water=3, food=4, restArea=29, toilet=39, store=48, generic=0)。
- BRouter公開サーバーで、鞍馬駅付近(35.1180,135.7706)を始点にすると mtb だけ「no track found at pass=0」になる
  (始点をずらしても同様。gravel / trekking-steep / hiking-beta / fastbike は成功)。始点が mtb では孤立した道に吸着されると推定。

## 対象ファイル(変更してよいもの)
- 新規 `src/fit.ts` と `src/fit.test.ts`
- `src/routing.ts`, `src/routing.test.ts`, `src/config.ts`(追加のみ。既存の値は変えない), `src/types.ts`
- `src/main.ts`, `src/style.css`, `src/ui/` 配下, `index.html`, `H_README.md`
- 上記以外は変更しない(`src/gpx.ts` 等は読むだけ)。`package.json` / `package-lock.json` は変更しない。

## 変更内容(タスクごとに1コミット。各コミット前に npm test と npm run build が緑)

### T1. FITコース生成(純関数、`src/fit.ts`)
- `generateFitCourse(input): Uint8Array`。入力: ルート名、走り方(profile)、解決済みトラック(既存 resolvedTrack: lat/lng/ele)、
  峠・山(既存 Place[])、表示中の補給・休憩(T2で使う既存のPOI一覧。自販機はまとめる前の1台ずつではなく、**まとめた代表点**を使う)。
- メッセージ構成(SDKの Encoder で書く):
  1. file_id: type=course、manufacturer=development、product=0、timeCreated=生成時刻、serialNumber=乱数。
  2. course: name=ルート名(UTF-8で15バイト以内に文字境界で切る)、sport=cycling、subSport= mtb→mountain / gravel→gravelCycling / road→road。
  3. lap: startTime、timestamp、startPosition/endPosition、totalDistance、totalElapsedTime=totalTimerTime(仮想速度から算出)、totalAscent/totalDescent(既存の elevationStats と同じ計算)。
  4. event: timer start(先頭)/ stopDisableAll(末尾)。
  5. record: 全トラック点(10,000点を超える場合は既存の geo の関数を使って間引く)。timestamp は仮想速度
     (config: mtb 12km/h、gravel 18km/h、road 25km/h)で累積距離から算出。positionLat/Long は度→semicircle 変換、altitude、distance(累積m)。
  6. course_point: 距離順。timestamp・位置・distance は最寄りのrecordに合わせる。name は UTF-8 15バイト以内。
     type 対応: 峠・山→summit、道の駅→restArea、コンビニ・商店→store、水場→water、自販機→water(名称「自販機」)、トイレ→toilet。
     上限 100 点。超える場合の優先順位: 峠・山 > 道の駅 > コンビニ・商店 > 水場 > 自販機 > トイレ(同順位は距離順に間引かず、等間隔に残す)。
- SDKが単位(altitude の scale/offset 等)をどう扱うかは、推測せず SDK のソースと Decoder による往復で確かめること。
- テスト(`src/fit.test.ts`): SDKの Decoder で `isFIT` / `checkIntegrity` が真、エラーなし。file_id.type=course、record数、
  先頭・末尾の位置(誤差1e-5度以内)、distance が単調増加、altitude が入力と1m以内、course_point の type・name・distance、
  15バイト切り詰め(日本語の文字境界)、100点上限と優先順位、空トラック・標高欠測(altitudeを省略)で落ちないこと。

### T2. 「ガーミンへ送る」導線(UI)
- PCサイドバーのフッター: 主ボタンを「ガーミンへ送る」(FIT)にし、隣に「GPX」(既存のGPX保存)と「共有」(既存)。
  スマホのシートpeek行の主ボタンも「ガーミン」に変更し、GPX保存は「…」メニューに移す。既存のdisabled条件(計算完了まで無効)は両方に適用。
- 「ガーミンへ送る」の動作:
  1. FITを生成し、ファイル名は既存のGPXと同じ規則で拡張子 `.fit`。
  2. `navigator.canShare?.({ files: [file] })` が真なら `navigator.share({ files: [file], title })` を呼ぶ(スマホの共有シートで Garmin Connect を選ぶ想定)。
     ユーザーが共有を取り消した場合(AbortError)は何もしない。
  3. 共有できない環境ではダウンロードし、取り込み手順のダイアログ(`<dialog>`、閉じるボタン、Escで閉じる)を出す:
     - PC: Garmin Connect(connect.garmin.com)→ トレーニングとプランニング → コース → コースをインポート → このFITを選択 → 保存 → デバイスに送信。
     - スマホ: ダウンロードしたFITをファイルアプリで開き「共有」→ Connect → 保存 → デバイスに送信。うまくいかない場合はPCのGarmin Connectから。
     手順は「Garminの画面名は変わることがあります」と注記。ダイアログには「次回から表示しない」チェック(localStorage)。
- コースポイントに含める内容は、GPXと同じ「表示中の補給・休憩を含める」チェックに従う(OFFなら峠・山のみ)。
- 既存のGPX保存・共有URLの挙動は変えない。

### T3. 山サイの経路失敗時の代替プロファイル
- `config.profiles.mtb` に `fallback: ['trekking']` を追加(他の走り方は代替なし)。
- 区間ごとのルーティングで、BRouterが「no track found」等で失敗した場合、代替プロファイルで同じ区間を1回だけ再計算する。
  それも失敗したら既存どおり直線にする。代替で成功した区間は Segment に `profileUsed` を持たせ、
  ステータスに「一部区間を代替経路(trekking)で計算しました」と warn で出す。キャッシュは要求プロファイル+区間で保持(代替結果も)。
- テスト: mtb が失敗し trekking で成功、両方失敗で直線、gravel は代替しない、キャッシュの再利用。

## 受け入れ条件
- `npm test` 全緑(既存99件+新規)、`npm run build` 成功。
- 生成したFITが公式SDKの Decoder で整合性チェックに通り、course / record / course_point が期待どおり(テストで確認)。
- PCでは「ガーミンへ送る」で `.fit` がダウンロードされ、手順ダイアログが出る。共有可能な環境では共有シートが呼ばれる(テストではnavigatorを差し替えて確認)。
- 山サイで鞍馬駅付近(35.1180,135.7706)→花脊峠(35.158743,135.786125)を引くと、直線ではなく代替経路になり、warnが出る(レビュー側で実データ確認)。
- 375px幅で横スクロールなし。キーボードでボタン・ダイアログを操作できる。

## 制約
- 「対象ファイル」以外は変更しない。npm操作をしない(依存は導入済み)。APIキー・秘密情報に触れない。
- 外部通信先は従来どおり。Garmin のサーバーへは通信しない(ユーザーが手動で取り込む)。
- 1タスク=1コミット(T1〜T3)。sandboxでコミットできない場合は変更ファイル一覧を報告して終了してよい。
- テストが赤のまま次のタスクへ進まない。BRouterへの手動試験リクエストはしない(レビュー側で行う)。

## 報告形式
- タスクごとの変更ファイル一覧とコミットハッシュ(またはコミットできなかった理由)
- 実行したテストとビルドのコマンド・結果(件数)
- SDKの単位・型の扱いで確認した事実(どのソース・テストで確かめたか)
- 仕様から意図的に変えた点とその理由、未解決事項
