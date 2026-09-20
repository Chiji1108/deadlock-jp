import { DAY, dayStart } from "./time";
import { parsePeriod } from "./types";
import type { Period } from "./types";
export const periodLabels: Record<Period, string> = {
  week: "7日",
  month: "30日",
  quarter: "90日",
  all: "累計",
};
const days = { week: 7, month: 30, quarter: 90 } as const;
export function availablePeriods(start: number, at: number | null): Period[] {
  const elapsed = Math.max(0, (at ?? start) - start);
  return [
    ...(["week", "month", "quarter"] as const).filter(
      (p) => elapsed >= days[p] * DAY,
    ),
    "all",
  ];
}
export function resolvePeriod(
  value: unknown,
  start: number,
  at: number | null,
): Period {
  const period = parsePeriod(value);
  return availablePeriods(start, at).includes(period) ? period : "all";
}
// Includes today, using Japanese calendar days, as in references.
export function periodStart(period: Exclude<Period, "all">, at: number) {
  return dayStart(at) - (days[period] - 1) * DAY;
}
