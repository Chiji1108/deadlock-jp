import type { Period } from "./model";
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const JST = 9 * HOUR;
export const MAX_GAP = 180_000;
export function dayStart(time: number) {
  return Math.floor((time + JST) / DAY) * DAY - JST;
}
export function dateLabel(time: number) {
  return new Date(time + JST).toISOString().slice(0, 10);
}
export function periodStart(period: Period, time: number) {
  return period === "all"
    ? 0
    : dayStart(time) - ({ week: 7, month: 30, quarter: 90 }[period] - 1) * DAY;
}
export function heatIndex(time: number) {
  const date = new Date(time + JST);
  return ((date.getUTCDay() + 6) % 7) * 24 + date.getUTCHours();
}
export function splitHours(start: number, end: number) {
  const result: { day: number; hour: number; seconds: number }[] = [];
  for (let at = start; at < end;) {
    const next = Math.min(end, (Math.floor(at / HOUR) + 1) * HOUR);
    result.push({
      day: dayStart(at),
      hour: new Date(at + JST).getUTCHours(),
      seconds: (next - at) / 1000,
    });
    at = next;
  }
  return result;
}
