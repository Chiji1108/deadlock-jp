# Deadlock 日本語Twitch配信者ボード

TanStack Start + Cloudflare Workers + D1 / Drizzle ORM。UIは `references/` の公開画面を移植し、shadcn/ui Base UIとTanStack Tableを使っています。管理画面・認証・Steam登録操作・期間切り替え・ブラウザの定期再取得は含みません。

## 構成

- `packages/db`: Drizzleスキーマ、D1接続、公開クエリ、原子的な集計処理、マイグレーション。
- `apps/web`: Workers上のSSR。初期HTMLに一覧・詳細を含みます。ソート・LIVE絞り込み・ページングはURLを使ってサーバー側で実行します。
- `apps/collector`: 毎分Cronで日本語Deadlock配信を収集。HTTP経由の収集・DB更新エンドポイントは公開しません。
- `references`: 変更しない移植元。

## ローカル開発

```sh
bun install
bun run db:migrate:local
# 別ターミナルでそれぞれ起動
bun run dev
bun run --filter collector dev
```

webとcollectorは同じルートの `.wrangler/state/v3` を使います。WranglerのD1名・IDは既存リソースのままです。`remote: true` は開発時も本番D1へ接続する指定のため外してあります。本番デプロイ時は従来どおり既存D1に接続します。

`apps/collector/.dev.vars.example` を `.dev.vars` にコピーしてTwitchのClient ID / Client Secretを設定します。Deadlock APIキーは任意です。ローカルCronはcollector起動後、表示されたポートの `/__scheduled?cron=*+*+*+*+*` で実行できます。このパスはWranglerのローカル機能です。

計測開始日の表示は `packages/db/src/time.ts` の2つの定数で管理しています。現在は **2026/9/20**。詳細な時刻は運用開始後に追記できます。表示日付からの遡及加算は行わず、各配信の初回観測から計測します。

## スキーマ変更・本番反映

```sh
# packages/db/src/schema.ts を編集して差分を生成
bun run db:generate
bun run db:migrate:local
bun test tests
bun run test:d1
bun run typecheck
bun run build

# 本番へ反映する際に実行
bun run db:migrate:remote
bun run --filter web deploy
bun run --filter collector deploy
```

Drizzle Kitが生成する `packages/db/migrations/*/migration.sql` をWranglerが適用します。スキーマの正本は `schema.ts` です。起動時の自動マイグレーションや別系統の `drizzle-kit push` は使いません。

本番のTwitch認証情報はcollectorのWorkers Secrets `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` に設定します。必要なら `DEADLOCK_API_KEY` も設定します。webには外部APIの秘密情報は不要です。

## 集計と運用

- 初期順序は配信中 → 総視聴時間 → Twitch ID。各列のソートはD1の索引付き累計列を使用します。ランクは高い順／低い順とも、認定中・未取得を末尾にします。
- 総視聴時間は前回視聴者数 × 観測間隔、平均視聴者は総視聴時間 ÷ 配信時間。単純なサンプル平均ではありません。
- 3分を超える観測欠落は加算せず、配信区間を分けます。LIVE判定は最後の収集成功から3分以内。画面はSSR時のスナップショットで、最新状態は再読み込みで確認します。
- Cronの重複を期限付きロックで排除し、観測バージョンと実行IDで古い書き込みを防ぎます。配信区間・時間別・日別・累計をDrizzleのD1 batchで同時確定します。
- Twitch一覧の全ページと、一覧から消えた配信者の再確認が成功してから集計します。API失敗を配信終了として扱いません。プロフィール画像は約24時間キャッシュします。
- 毎分の生サンプルは保存しません。累計・日別・時間別・配信区間を残し、将来の期間集計に対応します。詳細のヒートマップは直近最大90日、最近の配信は20件です。
- Steam未紐付けはランク・試合時間を「—」で表示します。後日のimport先は `streamers.twitch_id` と `steam_account_id`（32bit account ID）。未観測のTwitch IDも先に格納でき、初回観測まで公開一覧に出ません。ローカルへの紐付けimportは下記スクリプトで実行できます。
- 紐付け済みならランク・通常モードの累計試合時間・直近20試合を約1時間ごとに更新（毎分最大5人）。一時失敗は前回値を保持しバックオフ、403/404は対象値を消去します。紐付け変更時は旧アカウントのキャッシュを消し `enrichment_due_at` を0にする必要があります。
- `collector_state` と `streamers.enrichment_error` で取得状況を確認できます。Twitch成功時刻とDeadlock補完失敗は分けて扱います。

## 検証

`bun run test:d1` は一時的なローカルD1でマイグレーション・集計・SSR用クエリを検証します。

`bun test tests` は実際のDrizzle生成SQLをSQLiteで実行し、JST日跨ぎ、重複実行、ロック失効、原子的ロールバック、中断、全ソート・ページング、外部API失敗を検証します。

`packages/db/scripts/seed-local.ts` はブラウザ検証用のローカル専用フィクスチャです。通常の開発・デプロイでは実行しません。

## 外部APIの型更新

collectorのDeadlock API・Twitch Helix API取得は `openapi-fetch` を使用します。生成型は `apps/collector/src/generated/` に保存してバージョン管理し、通常のビルドではスキーマを取得しません。

- Deadlock: 公式OpenAPIから `deadlock-api.d.ts` を生成。
- Twitch: 非公式の [twitch-api-swagger](https://github.com/DmitryScaletta/twitch-api-swagger) から `twitch-api.d.ts` を生成。公式仕様との差分に注意して更新します。OAuthトークン取得はスキーマ対象外のため、既存のfetchと検証処理を使用します。

```sh
bun run --filter collector api:generate
bun run typecheck
bun test tests
```

API仕様を更新する際はこの手順で両方を再生成し、生成差分を確認します。個別更新は `api:generate:deadlock` / `api:generate:twitch` です。パス・パラメータ・レスポンスは生成型を使い、受信JSONの異常値チェックとタイムアウト・HTTPエラー処理は `deadlock-client.ts` / `deadlock-model.ts` / `twitch.ts` に残しています。

## ローカルへの紐付けimport

`archive/twitch-steam-links.json` の `{ twitchId, accountId, steamId64 }` 配列を取り込みます。ID整合性・重複・既存紐付けとの競合を事前検証し、既存の配信計測値は維持します。同じデータの再実行は変更なしになります。

```sh
cd packages/db
bun scripts/import-links-local.ts          # 事前確認のみ
bun scripts/import-links-local.ts --apply  # ローカルD1へ適用
```

未観測の配信者は初回のTwitch観測まで一覧に出ません。ランク・試合情報はcollectorの次回以降の実行で順次補完します。本番用のimportではありません。
