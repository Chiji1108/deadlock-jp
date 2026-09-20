# Deadlock 日本語Twitch配信者ボード

TanStack Start + Cloudflare Workers + D1 / Drizzle ORM。UIはshadcn/ui Base UIとTanStack Tableを使っています。管理者ログインはBetter Auth + Better Auth UIを使用します。管理者は配信者詳細からSteamを紐付けできます。管理ダッシュボード・期間切り替えは含みません。

## 構成

- `packages/db`: Drizzleスキーマ、D1接続、公開クエリ、原子的な集計処理、マイグレーション。
- `apps/web`: Workers上のSSR。初期HTMLに一覧・詳細を含みます。ソート・LIVE絞り込み・ページングはURLを使ってサーバー側で実行します。
- `apps/collector`: 毎分Cronで日本語Deadlock配信を収集。HTTP経由の収集・DB更新エンドポイントは公開しません。

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

計測開始日時はD1の `collector_state.measurement_started_at` で管理し、管理者によるリセット時に更新します。未リセットの既存データは **2026/9/20 20:44（日本時間）** を表示します。表示日時からの遡及加算は行わず、各配信の初回観測から計測します。

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

Drizzle Kitが生成する `packages/db/migrations/*/migration.sql` をWranglerが適用します。スキーマの正本は `schema.ts` と `auth-schema.ts` です。起動時の自動マイグレーションや別系統の `drizzle-kit push` は使いません。

本番のTwitch認証情報はcollectorのWorkers Secrets `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` に設定します。必要なら `DEADLOCK_API_KEY` も設定します。webには外部APIの秘密情報は不要です。

## 集計と運用

- 初期順序は配信中 → 総視聴時間 → Twitch ID。各列のソートはD1の索引付き累計列を使用します。ランクは高い順／低い順とも、認定中・未取得を末尾にします。
- 総視聴時間は前回視聴者数 × 観測間隔、平均視聴者は総視聴時間 ÷ 配信時間。単純なサンプル平均ではありません。
- 3分を超える観測欠落は加算せず、配信区間を分けます。LIVE判定は最後の収集成功から3分以内。初回はSSRで表示し、一覧・詳細は約1分ごとにloaderを再取得します。非表示タブ・オフライン時は取得を停止し、復帰時に更新します。取得中は重複実行しません。
- Cronの重複を期限付きロックで排除し、観測バージョンと実行IDで古い書き込みを防ぎます。配信区間・時間別・日別・累計をDrizzleのD1 batchで同時確定します。
- Twitch一覧の全ページと、一覧から消えた配信者の再確認が成功してから集計します。API失敗を配信終了として扱いません。プロフィール画像は約24時間キャッシュします。
- 毎分の生サンプルは保存しません。累計・日別・時間別・配信区間を残し、将来の期間集計に対応します。詳細のヒートマップは直近最大90日、最近の配信は20件です。
- Steam未紐付けはランク・試合時間を「—」で表示します。管理者は配信者詳細画面からSteamを紐付けできます。
- Steam紐付け済みで、日本語Deadlock配信中と確認できた人だけ、ランク・通常モードの累計試合時間・直近20試合を約1時間ごとに更新（更新予定時刻が古い順に毎分最大5人）。オフライン・別カテゴリ配信中・未観測の人は取得せず、最後の取得値を保持します。配信再開時に更新予定時刻を過ぎていれば再び対象になり、1時間の更新間隔や失敗時の待機時間は維持します。一時失敗は前回値を保持しバックオフ、403/404は対象値を消去します。紐付け変更時は旧アカウントのキャッシュを消し `enrichment_due_at` を0にする必要があります。
- `collector_state` と `streamers.enrichment_error` で取得状況を確認できます。Twitch成功時刻とDeadlock補完失敗は分けて扱います。

## 検証

`bun run test:d1` は一時的なローカルD1でマイグレーション・集計・SSR用クエリを検証します。

`bun test tests` は実際のDrizzle生成SQLをSQLiteで実行し、JST日跨ぎ、重複実行、ロック失効、原子的ロールバック、中断、全ソート・ページング、外部API失敗を検証します。

`packages/db/scripts/seed-local.ts` はブラウザ検証用のローカル専用フィクスチャです。通常の開発・デプロイでは実行しません。

## 外部APIの型更新

Deadlock API・Twitch Helix API取得は `openapi-fetch` を使用します。Deadlockの共有クライアント・検証・生成型は `packages/deadlock/src/`、Twitchの生成型は `apps/collector/src/generated/` に保存します。通常のビルドではスキーマを取得しません。

- Deadlock: 公式OpenAPIから `packages/deadlock/src/api.d.ts` を生成。
- Twitch: 非公式の [twitch-api-swagger](https://github.com/DmitryScaletta/twitch-api-swagger) から `twitch-api.d.ts` を生成。公式仕様との差分に注意して更新します。OAuthトークン取得はスキーマ対象外のため、既存のfetchと検証処理を使用します。

```sh
bun run --filter collector api:generate
bun run typecheck
bun test tests
```

API仕様を更新する際はこの手順で両方を再生成し、生成差分を確認します。個別更新は `bun run --filter deadlock api:generate` / `bun run --filter collector api:generate:twitch` です。collector の `api:generate:deadlock` は deadlock パッケージの生成コマンドを呼び出します。パス・パラメータ・レスポンスは生成型を使い、受信JSONの異常値チェックとタイムアウト・HTTPエラー処理は `packages/deadlock/src/client.ts` / `packages/deadlock/src/model.ts` / `apps/collector/src/twitch.ts` で行っています。

## 管理者ログイン

`/admin/login` からメール・パスワードでログインできます。ログイン中だけヘッダーに「管理者」を表示し、同じ画面からログアウトできます。一般登録・メール認証・パスワード再設定メールは無効です。Resendなどのメール配信サービスは不要です。Steam紐付け操作は管理者にだけ配信者詳細画面で表示します。

### ローカル

`apps/web/.dev.vars.example` を `.dev.vars` にコピーし、`BETTER_AUTH_SECRET` に `openssl rand -base64 48` などで生成した秘密値を設定します。`BETTER_AUTH_URL=http://localhost:3000` とし、開発サーバーを再起動してください。

```sh
bun run db:migrate:local
cd apps/web
bun run admin:create:local
cd ../..
bun run dev
```

作成スクリプトでメールアドレス・15〜128文字のパスワードを入力します。パスワードは非表示で入力し、Better Authのハッシュ形式でD1に保存します。既存アカウントの自動昇格は行いません。

### 本番反映

まず認証テーブルを追加します。既存の配信・集計データは維持します。

```sh
bun run db:migrate:remote
cd apps/web
bunx wrangler secret put BETTER_AUTH_SECRET
bunx wrangler secret put BETTER_AUTH_URL
bun run admin:create:remote
cd ../..
bun run --filter web deploy
```

`BETTER_AUTH_SECRET` はローカルと異なるランダムな秘密値（32文字以上）、`BETTER_AUTH_URL` は実際の公開オリジン（例：`https://deadlock.jp`、パスなし）を入力します。CloudflareのGitビルドを使う場合は、webのWorkers設定でもこれらを設定してください。collectorの変更・再デプロイは不要です。秘密値をGitへコミットしないでください。

管理者作成・再設定は対話入力を使うため、`--filter` を使わず `apps/web` ディレクトリで直接実行してください。

パスワードを忘れた場合は `apps/web` で `bun run admin:reset:remote`（ローカルは `admin:reset:local`）で変更できます。変更時にその管理者の既存セッションも失効します。

セッションはD1に保存し、有効期間は24時間、利用中は1時間ごとに更新します。管理者判定はサーバーで現在のDB値を確認します。ログイン試行はIPごとに1分5回までで、制限情報もD1で共有します。認証設定がない環境ではログインを利用不可にし、公開ページは引き続き閲覧できます。

### 計測データのリセット

管理者で `/admin/login` を開き、「計測データをリセット」を押します。確認ダイアログで「リセット」と入力して実行すると、全配信者の配信履歴・日別／時間別／累計集計・プロフィール・ランク・試合情報・APIキャッシュを削除します。Twitch IDとSteam account IDの紐付け、および管理者アカウント・認証セッションは維持します。取り消し操作はありません。

計測開始日時はリセット実行時刻に変わり、次のCronから新規計測します。一覧はいったん空になり、配信者は再観測後に再表示されます。ランク・試合情報も日本語Deadlock配信中の人から順次再取得します。Deadlock APIの累計試合時間はAPIが返す累計値のため、リセット後にプレイした時間だけにはなりません。

削除と開始日時の更新はD1 batchで一括確定します。実行中collectorの所有権を失効し、古い観測・補完結果の書き戻しと、同じリセット要求の再送による二重削除を防ぎます。

導入時は `bun run db:migrate:remote` を先に実行し、collectorとwebの両方をデプロイしてください。両方の反映が完了してからボタンを使います。マイグレーション自体ではデータはリセットされません。

### 配信者詳細からSteam紐付け

管理者ログイン中は詳細画面に「Steamを紐付ける」（登録済みなら「Steam紐付けを変更」）を表示します。名前検索・マッチIDの参加者選択・直接入力の3通りに対応します。直接入力はaccount ID、SteamID3 (`[U:1:…]`)、SteamID64、`steamcommunity.com/profiles/…` URLのみで、`/id/…` のカスタムURLは非対応です。Steam Web APIキーは不要です。

候補を選ぶとDeadlock APIでプレイヤーネームとランクを取得し、Twitch配信者名・Steam ID・プロフィールリンクとともに確認ダイアログへ表示します。名前が確認できない場合や通信エラーでは保存を止めます。ランクが取得不可の場合はその状態を明示して確認できます。マッチID経由では使用キャラも表示します。

確認は管理者本人に紐付いた5分間・一度限りの情報としてD1に保存します。保存時にも権限・Origin・重複・元の紐付け状態を検証し、他の管理者による変更やデータリセット後の古い確認では保存しません。Steam IDの一意制約で同時登録も拒否します。操作は管理者ごとに1分20回までです。

変更時は旧Steamの試合情報を消し、確認済みランクを保存します。Twitch配信集計は保持し、試合履歴・総試合時間は次回の配信中の収集で補完します。collectorは紐付けバージョンも確認し、変更前の取得結果を書き戻しません。

webの `DEADLOCK_API_KEY` は任意です。利用する場合はcollectorとは別にwebにも同じキーをWorkers Secretとして設定してください。今回の追加はマイグレーション後、collectorとwebの両方をデプロイします。
