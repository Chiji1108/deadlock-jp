import { DAY } from "../convex/time";
import type { Period } from "../convex/model";

// Site-wide measurement start, independent of each streamer's first appearance.
export const MEASUREMENT_STARTED_AT = Date.parse("2026-09-19T00:00:00+09:00");
export const MEASUREMENT_START_LABEL = "2026/9/19 計測開始";
export function heatmapDays(observedAt: number | null | undefined): number {
  // Count JST calendar days inclusively, with September 19 as day one.
  return Math.min(
    90,
    Math.max(
      1,
      Math.floor(
        ((observedAt ?? MEASUREMENT_STARTED_AT) - MEASUREMENT_STARTED_AT) / DAY,
      ) + 1,
    ),
  );
}
export function availablePeriods(
  observedAt: number | null | undefined,
): Period[] {
  const elapsed = Math.max(
    0,
    (observedAt ?? MEASUREMENT_STARTED_AT) - MEASUREMENT_STARTED_AT,
  );
  return [
    ...(elapsed >= 7 * DAY ? ["week" as const] : []),
    ...(elapsed >= 30 * DAY ? ["month" as const] : []),
    ...(elapsed >= 90 * DAY ? ["quarter" as const] : []),
    "all",
  ];
}
export function resolvePeriod(
  raw: string | null,
  observedAt: number | null | undefined,
): Period {
  const available = availablePeriods(observedAt);
  const requested =
    raw === "week" || raw === "month" || raw === "quarter" || raw === "all"
      ? raw
      : "week";
  return available.includes(requested) ? requested : "all";
}
