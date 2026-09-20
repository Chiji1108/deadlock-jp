import type { ColumnDef } from '@tanstack/react-table'
import type { Session } from 'db/types'
import { DataTable } from './data-table'
import type { DataTableFeatures } from './data-table'
import { dateTime, number } from './dashboard-ui'

export function SessionTable({
  sessions,
  isLive,
}: {
  sessions: Session[]
  isLive: boolean
}) {
  const columns: ColumnDef<DataTableFeatures, Session>[] = [
    {
      id: 'time',
      header: '配信時刻',
      cell: ({ row: { original: s } }) => (
        <div className="flex flex-col gap-1 text-xs tabular-nums">
          <span>{dateTime(s.startedAt)}</span>
          <span className="text-muted-foreground">
            {s.endedAt
              ? `〜 ${dateTime(s.endedAt)}`
              : isLive
                ? '配信中'
                : '最終観測時点'}
          </span>
        </div>
      ),
    },
    {
      id: 'title',
      header: 'タイトル',
      cell: ({ row }) => (
        <p className="min-w-48 max-w-sm whitespace-normal break-words">
          {row.original.title}
        </p>
      ),
    },
    ...(
      [
        { id: 'hoursStreamed', label: '配信時間', digits: 1 },
        { id: 'averageViewers', label: '平均視聴者', digits: 1 },
        { id: 'peakViewers', label: 'ピーク視聴者', digits: 0 },
        { id: 'hoursWatched', label: '総視聴時間', digits: 1 },
      ] as const
    ).map((c) => ({
      id: c.id,
      header: c.label,
      cell: ({ row }: { row: { original: Session } }) =>
        number(row.original[c.id], c.digits),
    })),
  ]
  return (
    <DataTable
      columns={columns}
      data={sessions}
      getRowId={(s) => s.id}
      caption="最近の配信"
      right={['hoursStreamed', 'averageViewers', 'peakViewers', 'hoursWatched']}
    />
  )
}
