import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { StreamerData } from 'db/types'
import { measurementStartLabel } from 'db/time'
import { SteamLinkDialog } from './steam-link-dialog'
import { DeadlockRank } from './deadlock-rank'
import { DeadlockActivity } from './deadlock-activity'
import { StreamingHoursHeatmap } from './streaming-hours-heatmap'
import { LivePreview } from './live-preview'
import { Avatar, Metric, number } from './dashboard-ui'
import { SessionTable } from './session-table'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

export function StreamerDetailView({
  data,
  fresh,
  measurementStartedAt,
}: {
  data: StreamerData
  measurementStartedAt: number
  fresh: boolean
}) {
  const { streamer, summary } = data
  const { admin } = getRouteApi('__root__').useLoaderData()
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <Button
          nativeButton={false}
          render={
            <Link to="/" search={{ sort: 'live', live: false, page: 1 }} />
          }
          variant="ghost"
          size="sm"
        >
          <ArrowLeft data-icon="inline-start" />
          配信者一覧
        </Button>
      </div>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            large
            name={streamer.displayName}
            url={streamer.profileImageUrl}
          />
          <div className="flex min-w-0 flex-col">
            <h1 className="break-all text-xl leading-6 font-semibold">
              {streamer.displayName}
            </h1>
            <a
              className="inline-flex w-fit items-center gap-1 text-sm leading-4 text-muted-foreground hover:text-foreground hover:underline"
              href={`https://www.twitch.tv/${encodeURIComponent(streamer.login)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`@${streamer.login}のTwitchを開く（新しいタブ）`}
            >
              <span className="break-all">@{streamer.login}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>
          <DeadlockRank rank={data.deadlockRank} />
        </div>
        {admin && (
          <SteamLinkDialog
            key={streamer.twitchId}
            twitchId={streamer.twitchId}
            linked={data.deadlockRank !== null}
          />
        )}
      </header>
      {fresh && data.live && (
        <LivePreview
          live={data.live}
          login={streamer.login}
          name={streamer.displayName}
        />
      )}
      <DeadlockActivity activity={data.deadlockActivity} />
      <section className="flex flex-col gap-4" aria-labelledby="summary-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="summary-title" className="text-base font-semibold">
              累計
            </h2>
            <span className="text-xs text-muted-foreground">
              配信日数 {number(summary.streamingDays)}日
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {measurementStartLabel(measurementStartedAt)} 計測開始
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Metric
            label="合計配信時間"
            value={number(summary.hoursStreamed, 1)}
            unit="時間"
          />
          <Metric
            label="平均視聴者"
            value={number(summary.averageViewers, 1)}
            unit="人"
          />
          <Metric
            label="ピーク視聴者"
            value={number(summary.peakViewers)}
            unit="人"
          />
          <Metric
            label="総視聴時間"
            value={number(summary.hoursWatched, 1)}
            unit="人時"
          />
        </div>
      </section>
      <div className="w-full min-w-0">
        <StreamingHoursHeatmap cells={data.heatmap} days={data.heatmapDays} />
      </div>
      <section
        className="flex min-w-0 flex-col gap-3"
        aria-labelledby="sessions-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sessions-title" className="text-base font-semibold">
            最近の配信
          </h2>
          <span className="text-xs text-muted-foreground">最新20件</span>
        </div>
        {data.recentSessions.length ? (
          <div className="min-w-0 rounded-lg border">
            <SessionTable
              sessions={data.recentSessions}
              isLive={fresh && data.isLive}
            />
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>まだ配信記録がありません</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}
