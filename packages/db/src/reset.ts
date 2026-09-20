import { and, eq, exists, isNull, sql } from "drizzle-orm";
import type { Database } from "./index";
import { cache, collector, daily, hourly, sessions, streamers } from "./schema";
import { ORIGINAL_MEASUREMENT_START } from "./time";

// One transaction: preserve only Twitch/Steam associations and authentication.
// Every deletion is conditional on the generation the administrator confirmed.
export async function resetMeasurements(
  db: Database,
  expectedStart: number,
  now = Date.now(),
) {
  await db.insert(collector).values({ id: 1 }).onConflictDoNothing();
  const generation = and(
    eq(collector.id, 1),
    eq(
      sql<number>`COALESCE(${collector.measurementStartedAt}, ${ORIGINAL_MEASUREMENT_START})`,
      expectedStart,
    ),
  );
  const guard = exists(
    db.select({ id: collector.id }).from(collector).where(generation),
  );
  const startedAt = Math.max(now, expectedStart + 1);
  const result = await db.batch([
    db.delete(sessions).where(guard),
    db.delete(daily).where(guard),
    db.delete(hourly).where(guard),
    db.delete(cache).where(guard),
    db.delete(streamers).where(and(guard, isNull(streamers.steamAccountId))),
    db
      .update(streamers)
      .set({
        login: "",
        displayName: "",
        profileImageUrl: null,
        profileUpdatedAt: null,
        firstSeenAt: null,
        lastObservedAt: 0,
        isLive: false,
        sessionId: null,
        twitchStreamId: null,
        lastSeenAt: null,
        liveStartedAt: null,
        liveViewerCount: null,
        title: null,
        thumbnailUrl: null,
        durationSeconds: 0,
        viewerSeconds: 0,
        peakViewers: 0,
        rankTier: null,
        rankSubrank: null,
        rankUpdatedAt: null,
        rankUnavailable: false,
        matchTimeSeconds: null,
        matchTimeUpdatedAt: null,
        recentMatches: [],
        historyUpdatedAt: null,
        enrichmentDueAt: 0,
        enrichmentFailures: 0,
        enrichmentError: null,
      })
      .where(guard),
    db
      .update(collector)
      .set({
        runId: null,
        leaseUntil: 0,
        // Reject delayed scheduled events whose snapshot could predate the reset.
        lastScheduledAt: sql`MAX(${collector.lastScheduledAt}, ${startedAt})`,
        measurementStartedAt: startedAt,
        firstCollectedAt: null,
        lastCollectedAt: null,
        lastAttemptAt: null,
        state: "ready",
        error: null,
      })
      .where(generation)
      .returning({ measurementStartedAt: collector.measurementStartedAt }),
  ]);
  return result[6].at(0) ?? null;
}
