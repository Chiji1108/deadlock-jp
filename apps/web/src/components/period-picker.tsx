import { availablePeriods, periodLabels } from 'db/periods'
import type { Period } from 'db/types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function PeriodPicker({
  period,
  startedAt,
  observedAt,
  onChange,
}: {
  period: Period
  startedAt: number
  observedAt: number | null
  onChange: (period: Period) => void
}) {
  const options = availablePeriods(startedAt, observedAt)
  if (options.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">配信集計期間</span>
      <ToggleGroup
        aria-label="配信集計期間"
        value={[period]}
        onValueChange={(values) => {
          if (values.length) onChange(values[0] as Period)
        }}
        size="sm"
        variant="outline"
        spacing={0}
      >
        {options.map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {periodLabels[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
