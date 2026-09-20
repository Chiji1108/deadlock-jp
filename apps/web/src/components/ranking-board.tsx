import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import type { Filters, RankingRow, Sort } from 'db/types'
import { measurementStartLabel } from 'db/time'
import type { getRanking } from 'db/queries'
import { DataTable } from './data-table'
import type { DataTableFeatures } from './data-table'
import { Avatar, CollectionNotice, LiveBadge, number } from './dashboard-ui'
import { DeadlockRank } from './deadlock-rank'
import { DeadlockMatchTime } from './deadlock-activity'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'

const metricColumns = [
  { id: 'duration', label: '合計配信時間', key: 'hoursStreamed', digits: 1 },
  { id: 'viewers', label: '平均視聴者', key: 'averageViewers', digits: 1 },
  { id: 'peak', label: 'ピーク視聴者', key: 'peakViewers', digits: 0 },
  { id: 'watched', label: '総視聴時間', key: 'hoursWatched', digits: 1 },
] as const
export function RankingBoard({
  data,
  onChange,
}: {
  data: Awaited<ReturnType<typeof getRanking>>
  onChange: (filters: Filters) => void
}) {
  const navigate = useNavigate()
  const { filters, rows, status } = data
  const sort = filters.sort
  function sortHeader(id: Sort, label: string) {
    const selected = sort === id || (id === 'rank' && sort === 'rankAsc')
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onChange({
            ...filters,
            sort: id === 'rank' && sort === 'rank' ? 'rankAsc' : id,
            page: 1,
          })
        }
        aria-label={`${label}の${id === 'rank' ? (sort === 'rank' ? '低い' : '高い') : '多い'}順に並べ替え`}
      >
        {label}
        {selected ? (
          sort === 'rankAsc' ? (
            <ArrowUp data-icon="inline-end" />
          ) : (
            <ArrowDown data-icon="inline-end" />
          )
        ) : (
          <ArrowUpDown data-icon="inline-end" />
        )}
      </Button>
    )
  }
  const columns: ColumnDef<DataTableFeatures, RankingRow>[] = [
    {
      id: 'streamer',
      header: '配信者',
      cell: ({ row }) => (
        <div className="flex min-w-40 items-center gap-3 py-1">
          <Avatar
            name={row.original.displayName}
            url={row.original.profileImageUrl}
          />
          <div className="flex min-w-0 max-w-60 flex-col gap-1 sm:max-w-96">
            <Link
              className="max-w-52 truncate font-medium hover:underline"
              to="/streamers/$id"
              params={{ id: row.original.twitchId }}
            >
              {row.original.displayName}
            </Link>
            {row.original.isLive && (
              <LiveBadge
                viewers={row.original.liveViewerCount}
                startedAt={row.original.liveStartedAt}
                observedAt={status.lastCollectedAt}
              />
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'rank',
      header: () => sortHeader('rank', 'ランク'),
      cell: ({ row }) =>
        row.original.deadlockRank ? (
          <DeadlockRank rank={row.original.deadlockRank} plain />
        ) : (
          <span className="text-muted-foreground" aria-label="ランク未登録">
            —
          </span>
        ),
    },
    {
      id: 'matchTime',
      header: () => sortHeader('matchTime', '累計試合時間'),
      cell: ({ row }) => (
        <DeadlockMatchTime activity={row.original.deadlockActivity} plain />
      ),
    },
    ...metricColumns.map((c) => ({
      id: c.id,
      header: () => sortHeader(c.id, c.label),
      cell: ({ row }: { row: { original: RankingRow } }) =>
        number(row.original[c.key], c.digits),
    })),
  ]
  return (
    <>
      <h1 className="sr-only">Deadlock 日本語Twitch配信者ボード</h1>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="text-xs text-muted-foreground">
          {measurementStartLabel(status.measurementStartedAt)} 計測開始
        </span>
        <FieldGroup className="ml-auto w-32 shrink-0">
          <Field orientation="horizontal">
            <Switch
              id="live-only"
              aria-label="配信中のみ"
              checked={filters.live}
              onCheckedChange={(live) =>
                onChange({ ...filters, live, page: 1 })
              }
            />
            <FieldLabel htmlFor="live-only">配信中のみ</FieldLabel>
          </Field>
        </FieldGroup>
      </div>
      <CollectionNotice status={status} />
      {rows.length ? (
        <div className="min-w-0 rounded-lg border">
          <DataTable
            columns={columns}
            data={rows}
            caption="日本語Deadlock配信者一覧"
            getRowId={(r) => r.twitchId}
            sorting={
              sort === 'live'
                ? []
                : [
                    {
                      id: sort === 'rankAsc' ? 'rank' : sort,
                      desc: sort !== 'rankAsc',
                    },
                  ]
            }
            right={['matchTime', 'duration', 'viewers', 'peak', 'watched']}
            onRowClick={(row, event) => {
              if (
                (event.target as HTMLElement).closest('a, button') ||
                window.getSelection()?.toString()
              )
                return
              if (event.metaKey || event.ctrlKey)
                window.open(
                  `/streamers/${row.twitchId}`,
                  '_blank',
                  'noopener,noreferrer',
                )
              else
                void navigate({
                  to: '/streamers/$id',
                  params: { id: row.twitchId },
                })
            }}
          />
        </div>
      ) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyTitle>
              {filters.live
                ? status.fresh
                  ? '現在、配信中の人はいません'
                  : '配信状況を確認しています'
                : '配信データはまだありません'}
            </EmptyTitle>
            <EmptyDescription>
              {filters.live
                ? '最新の配信状況はページを再読み込みして確認できます。'
                : '日本語のDeadlock配信を観測すると、ここに表示されます。'}
            </EmptyDescription>
          </EmptyHeader>
          {filters.live && (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => onChange({ ...filters, live: false, page: 1 })}
              >
                すべての配信者を見る
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
      {data.pageCount > 1 && (
        <nav
          aria-label="配信者一覧のページ"
          className="flex items-center justify-center gap-3"
        >
          <Button
            variant="outline"
            disabled={data.page <= 1}
            onClick={() => onChange({ ...filters, page: data.page - 1 })}
          >
            前へ
          </Button>
          <span className="text-sm tabular-nums">
            {data.page} / {data.pageCount}
          </span>
          <Button
            variant="outline"
            disabled={data.page >= data.pageCount}
            onClick={() => onChange({ ...filters, page: data.page + 1 })}
          >
            次へ
          </Button>
        </nav>
      )}
      {sort !== 'live' && (
        <Button
          variant="ghost"
          className="mx-auto"
          onClick={() => onChange({ ...filters, sort: 'live', page: 1 })}
        >
          配信中・総視聴時間順に戻す
        </Button>
      )}
    </>
  )
}
