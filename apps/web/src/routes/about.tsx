import { createFileRoute, getRouteApi, Link } from '@tanstack/react-router'
import { measurementStartLabel } from 'db/time'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export const Route = createFileRoute('/about')({
  component: About,
  head: () => ({
    meta: [{ title: 'データについて | Deadlock 日本語Twitch配信者ボード' }],
  }),
})
function About() {
  const { measurementStartedAt } = getRouteApi('__root__').useLoaderData()
  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-6 text-sm leading-7 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_p]:text-muted-foreground">
      <Button
        nativeButton={false}
        render={
          <Link
            to="/"
            search={{ sort: 'live', live: false, page: 1, period: 'all' }}
          />
        }
        variant="ghost"
        size="sm"
        className="w-fit"
      >
        ← 配信者一覧
      </Button>

      <h1 className="text-xl font-semibold">データについて</h1>
      <p>
        <a
          href="https://www.twitch.tv/miri_ch_"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
        >
          ミリちゃんねる
        </a>
        がDeadlock日本配信をあまりにも好きすぎるため、2026/9/20から独自にデータを収集し、それとなーくまとめたものがこのサイトとなっております。
      </p>
      <section>
        <h2>データの収集開始日</h2>
        <p>
          {measurementStartLabel(measurementStartedAt)}（日本時間）
          からデータを収集しています。それ以前の配信履歴は含まれません。
        </p>
      </section>
      <section>
        <h2>何を計測している？</h2>
        <p>
          Twitchで配信言語を日本語に設定し、Deadlockカテゴリで配信しているチャンネルが対象です。国籍による判定ではありません。
        </p>
      </section>
      <section>
        <h2>配信時間と視聴者数</h2>
        <p>
          このサービスが配信を発見した時点から計測します。観測と観測の間は、前回の視聴者数が続いたものとして計算します。平均視聴者数は「総視聴時間
          ÷ 配信時間」。ピーク視聴者数は、観測できた中での最大値です。
        </p>
        <p>
          「総視聴時間」は、視聴者数と配信時間を掛け合わせた値です。例えば10人が1時間視聴すると10人時になります。ユニーク視聴者数ではありません。
        </p>
      </section>
      <section>
        <h2>期間とグラフ</h2>
        <p>
          サイト内の時刻と日付はすべて日本時間（JST）です。「累計」はこのサービスによる計測開始以降の記録です。
        </p>
        <p>
          時間帯の濃淡は、その曜日・時間帯の経過時間に対する観測配信時間の割合です。今後の配信予定を表すものではありません。
        </p>
      </section>
      <Separator />
      <p className="text-xs">
        本サービスはValve・Twitchとは関係のない非公式プロジェクトです。
      </p>
    </article>
  )
}
