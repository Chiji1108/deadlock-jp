import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { siSteam, siTwitch } from 'simple-icons'
import type { SimpleIcon } from 'simple-icons'
import type { StreamerData, Period } from 'db/types'
import { periodLabels } from 'db/periods'
import { PeriodPicker } from './period-picker'
import { measurementStartLabel } from 'db/time'
import { SteamLinkDialog } from './steam-link-dialog'
import { DeadlockRank } from './deadlock-rank'
import { DeadlockActivity } from './deadlock-activity'
import { StreamingHoursHeatmap } from './streaming-hours-heatmap'
import { LivePreview } from './live-preview'
import { Avatar, Metric, number } from './dashboard-ui'
import { SessionTable } from './session-table'
import { Button, buttonVariants } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'

export function StreamerDetailView({
  data,
  fresh,
  measurementStartedAt,
  onPeriodChange,
}: {
  onPeriodChange: (period: Period) => void
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
            <Link
              to="/"
              search={{
                sort: 'live',
                live: false,
                page: 1,
                period: data.period,
              }}
            />
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
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="break-all text-xl leading-6 font-semibold">
                {streamer.displayName}
              </h1>
              <span className="break-all text-sm leading-4 text-muted-foreground">
                @{streamer.login}
              </span>
            </div>
            <DeadlockRank rank={data.deadlockRank} />
            <div className="flex shrink-0 items-center">
              <ProfileLink
                icon={siTwitch}
                href={`https://www.twitch.tv/${encodeURIComponent(streamer.login)}`}
                label="Twitchで開く"
              />
              {data.deadlockRank && (
                <ProfileLink
                  icon={siSteam}
                  href={`https://steamcommunity.com/profiles/${BigInt(data.deadlockRank.accountId) + BigInt('76561197960265728')}`}
                  label="Steamプロフィール"
                />
              )}
            </div>
          </div>
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
              {data.period === 'all'
                ? '累計'
                : `${periodLabels[data.period]}の集計`}
            </h2>
            <span className="text-xs text-muted-foreground">
              配信日数 {number(summary.streamingDays)}日
            </span>
          </div>
          <PeriodPicker
            period={data.period}
            startedAt={measurementStartedAt}
            observedAt={data.lastCollectedAt}
            onChange={onPeriodChange}
          />
          {data.period === 'all' && (
            <span className="text-xs text-muted-foreground">
              {measurementStartLabel(measurementStartedAt)} 計測開始
            </span>
          )}
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

function ProfileLink({
  icon,
  href,
  label,
}: {
  icon: SimpleIcon
  href: string
  label: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label}（新しいタブ）`}
      className={buttonVariants({ variant: 'ghost', size: 'icon' })}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={icon.path} />
      </svg>
    </a>
  )
}
