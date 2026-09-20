import type { Status } from 'db/types'
import {
  Avatar as UIAvatar,
  AvatarImage,
  AvatarFallback,
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '@/components/ui/card'

export const number = (value: number, digits = 0) =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(
    value,
  )
export const dateTime = (value: number) =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value)

export function Avatar({
  name,
  url,
  large = false,
}: {
  name: string
  url: string | null
  large?: boolean
}) {
  return (
    <UIAvatar size={large ? 'lg' : 'default'}>
      <AvatarImage src={url ?? undefined} alt="" referrerPolicy="no-referrer" />
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </UIAvatar>
  )
}
export function LoadingPanel() {
  return (
    <div role="status" className="flex flex-col gap-4 py-4">
      <span className="sr-only">配信データを読み込んでいます</span>
      <Skeleton className="h-8 w-40" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
export function LiveBadge({
  viewers,
  startedAt,
  observedAt,
}: {
  viewers?: number | null
  startedAt?: number | null
  observedAt: number | null
}) {
  const minutes =
    observedAt != null && startedAt != null
      ? Math.max(0, Math.floor((observedAt - startedAt) / 60000))
      : null
  return (
    <Badge variant="secondary">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-destructive"
      />
      LIVE{viewers != null && ` · ${number(viewers)}人`}
      {minutes != null && (
        <span
          className="tabular-nums"
          aria-label={`配信開始から${Math.floor(minutes / 60)}時間${minutes % 60}分`}
        >
          · {Math.floor(minutes / 60)}時間{minutes % 60}分
        </span>
      )}
    </Badge>
  )
}
export function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string
  value: string
  unit?: string
  note?: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {note && <CardDescription>{note}</CardDescription>}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  )
}

export function CollectionNotice({ status }: { status: Status }) {
  const text =
    status.state === 'unconfigured' || !status.lastCollectedAt
      ? '収集の準備中です。データが届いた後にページを再読み込みしてください。'
      : status.state === 'error' || !status.fresh
        ? '最新データの取得を待っています。記録済みの集計は閲覧できます。'
        : null
  return text ? (
    <Alert role="status">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  ) : null
}
