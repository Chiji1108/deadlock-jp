export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const JST = 9 * HOUR;
export const MAX_GAP = 180_000;
// Display only. The operator will append the exact time after launch.
// Actual counters begin at each stream's first successful observation.
export const MEASUREMENT_START_LABEL = "2026/9/20 計測開始";
export const MEASUREMENT_START_DESCRIPTION = "2026年9月20日（日本時間）";
export function dayStart(time: number) {
  return Math.floor((time + JST) / DAY) * DAY - JST;
}
export function heatIndex(time: number) {
  const d = new Date(time + JST);
  return ((d.getUTCDay() + 6) % 7) * 24 + d.getUTCHours();
}
export function splitHours(start: number, end: number) {
  const parts: { day: number; hour: number; seconds: number }[] = [];
  for (let at = start; at < end;) {
    const next = Math.min(end, (Math.floor(at / HOUR) + 1) * HOUR);
    parts.push({
      day: dayStart(at),
      hour: Math.floor(at / HOUR) * HOUR,
      seconds: (next - at) / 1000,
    });
    at = next;
  }
  return parts;
}
