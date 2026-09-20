export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const JST = 9 * HOUR;
export const MAX_GAP = 180_000;
// Existing production data predates the reset feature.
export const ORIGINAL_MEASUREMENT_START = Date.parse(
  "2026-09-20T20:44:00+09:00",
);
export function measurementStartLabel(at: number) {
  const date = new Date(at + JST);
  const time = `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()} ${time}`;
}
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
