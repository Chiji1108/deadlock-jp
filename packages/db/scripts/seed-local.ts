// UI verification only. getPlatformProxy uses the local emulator; no remote D1 access.
import { getPlatformProxy } from "wrangler";
import {
  createDb,
  collector,
  streamers,
  sessions,
  daily,
  hourly,
  eq,
  inArray,
} from "../src/index";
import { dayStart, HOUR } from "../src/time";
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "../../apps/collector/wrangler.jsonc",
  persist: { path: "../../.wrangler/state/v3" },
});
const db = createDb(proxy.env.DB),
  now = Date.now();
const ids = Array.from({ length: 35 }, (_, i) => String(900001 + i));
try {
  await db.delete(hourly).where(inArray(hourly.twitchId, ids));
  await db.delete(daily).where(inArray(daily.twitchId, ids));
  await db.delete(sessions).where(inArray(sessions.twitchId, ids));
  await db.delete(streamers).where(inArray(streamers.twitchId, ids));
  if (process.argv.includes("--clean")) {
    await db.delete(collector).where(eq(collector.id, 1));
  } else {
    await db
      .insert(collector)
      .values({
        id: 1,
        lastCollectedAt: now,
        firstCollectedAt: now - 2 * HOUR,
        state: "ready",
      })
      .onConflictDoUpdate({
        target: collector.id,
        set: {
          lastCollectedAt: now,
          firstCollectedAt: now - 2 * HOUR,
          state: "ready",
        },
      });
    for (const [i, id] of ids.entries())
      await db.insert(streamers).values({
        twitchId: id,
        login: `preview_${i + 1}`,
        displayName:
          i === 0
            ? "配信プレビューテスト"
            : `テスト配信者 ${String(i + 1).padStart(2, "0")}`,
        firstSeenAt: now - 2 * HOUR,
        lastObservedAt: now,
        lastSeenAt: now,
        isLive: i < 7,
        liveViewerCount: i < 7 ? 128 + i : null,
        liveStartedAt: i < 7 ? now - 2 * HOUR : null,
        title: "Deadlock 日本語配信・テストデータ",
        durationSeconds: 7200 + i * 60,
        viewerSeconds: 7200 * (150 - i),
        peakViewers: 250 - i,
        ...(i === 0
          ? {
              steamAccountId: 123,
              rankTier: 7,
              rankSubrank: 3,
              rankUpdatedAt: now,
              matchTimeSeconds: 123456,
              matchTimeUpdatedAt: now,
              historyUpdatedAt: now,
              recentMatches: [
                {
                  matchId: 1,
                  heroId: 1,
                  heroName: "インフェルナス",
                  heroImage: null,
                  startedAt: now - HOUR,
                  outcome: "win" as const,
                },
              ],
            }
          : {}),
      });
    await db
      .insert(sessions)
      .values({
        id: "preview-session",
        twitchId: ids[0],
        twitchStreamId: "preview",
        title: "Deadlock 日本語配信・テストデータ",
        startedAt: now - 2 * HOUR,
        durationSeconds: 7200,
        viewerSeconds: 1080000,
        peakViewers: 250,
      });
    await db
      .insert(daily)
      .values({
        twitchId: ids[0],
        day: dayStart(now),
        durationSeconds: 7200,
        viewerSeconds: 1080000,
        peakViewers: 250,
      });
    await db
      .insert(hourly)
      .values({
        twitchId: ids[0],
        hour: Math.floor((now - HOUR) / HOUR) * HOUR,
        durationSeconds: 3600,
      });
  }
} finally {
  await proxy.dispose();
}
