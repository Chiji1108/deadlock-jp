import { and, eq, exists, gte, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Database } from "./index";
import { collector, daily, hourly, sessions, streamers } from "./schema";
import type { StreamerRecord } from "./schema";
export type { Observation } from "./observation";
import { planObservation } from "./observation";
import type { Observation } from "./observation";
export async function acquireRun(
  db: Database,
  runId: string,
  scheduledAt: number,
  now: number,
) {
  await db.insert(collector).values({ id: 1 }).onConflictDoNothing();
  return db
    .update(collector)
    .set({
      runId,
      leaseUntil: now + 120_000,
      lastScheduledAt: scheduledAt,
      lastAttemptAt: now,
      state: "collecting",
      error: null,
    })
    .where(
      and(
        eq(collector.id, 1),
        lt(collector.leaseUntil, now),
        lt(collector.lastScheduledAt, scheduledAt),
      ),
    )
    .returning({ id: collector.id })
    .get();
}
export async function renewRun(db: Database, runId: string, now = Date.now()) {
  const row = await db
    .update(collector)
    .set({ leaseUntil: now + 120_000 })
    .where(
      and(
        eq(collector.id, 1),
        eq(collector.runId, runId),
        gte(collector.leaseUntil, now),
      ),
    )
    .returning({ id: collector.id })
    .get();
  if (!row) throw new Error("Collection lease lost");
}
// An ownership fence AND an observation-version fence guard every write. The
// final streamer update advances the version. D1 batch commits all rollups or none.
export async function applyObservation(
  db: Database,
  runId: string,
  old: StreamerRecord | null,
  live: Observation | null,
  at: number,
  portrait?: string,
) {
  const plan = planObservation(old, live, at);
  if (!plan) return;
  const {
    id,
    hadSession,
    continued,
    end,
    seconds,
    viewerSeconds,
    buckets,
    hours,
    sessionId,
  } = plan;
  const owner = exists(
    db
      .select({ id: collector.id })
      .from(collector)
      .where(and(eq(collector.id, 1), eq(collector.runId, runId))),
  );
  // Reset invalidates run ownership, including identity creation.
  if (!old)
    await db
      .insert(streamers)
      .select(
        db
          .select({ twitchId: sql<string>`${id}`.as("twitchId") })
          .from(collector)
          .where(and(eq(collector.id, 1), owner)),
      )
      .onConflictDoNothing();
  const guard = and(
    owner,
    exists(
      db
        .select({ id: streamers.twitchId })
        .from(streamers)
        .where(
          and(
            eq(streamers.twitchId, id),
            eq(streamers.lastObservedAt, old?.lastObservedAt ?? 0),
          ),
        ),
    ),
  )!;
  const statements: BatchItem<"sqlite">[] = [];
  if (hadSession) {
    statements.push(
      db
        .update(sessions)
        .set({
          durationSeconds: sql`${sessions.durationSeconds} + ${seconds}`,
          viewerSeconds: sql`${sessions.viewerSeconds} + ${viewerSeconds}`,
          peakViewers: sql`MAX(${sessions.peakViewers}, ${continued ? live!.viewerCount : 0})`,
          endedAt: continued ? null : end,
          title: continued ? live!.title : (old!.title ?? ""),
        })
        .where(and(eq(sessions.id, old!.sessionId!), guard)),
    );
    for (const part of hours) {
      statements.push(
        db
          .insert(hourly)
          .select(
            db
              .select({
                twitchId: sql<string>`${id}`.as("twitchId"),
                hour: sql<number>`${part.hour}`.as("hour"),
                durationSeconds: sql<number>`${part.seconds}`.as(
                  "durationSeconds",
                ),
              })
              .from(collector)
              .where(and(eq(collector.id, 1), guard)),
          )
          .onConflictDoUpdate({
            target: [hourly.twitchId, hourly.hour],
            set: {
              durationSeconds: sql`${hourly.durationSeconds} + excluded.duration_seconds`,
            },
          }),
      );
    }
  }
  if (live) {
    if (!continued)
      statements.push(
        db.insert(sessions).select(
          db
            .select({
              id: sql<string>`${sessionId}`.as("id"),
              twitchId: sql<string>`${id}`.as("twitchId"),
              twitchStreamId: sql<string>`${live.twitchStreamId}`.as(
                "twitchStreamId",
              ),
              title: sql<string>`${live.title}`.as("title"),
              startedAt: sql<number>`${at}`.as("startedAt"),
              endedAt: sql<null>`NULL`.as("endedAt"),
              durationSeconds: sql<number>`0`.as("durationSeconds"),
              viewerSeconds: sql<number>`0`.as("viewerSeconds"),
              peakViewers: sql<number>`${live.viewerCount}`.as("peakViewers"),
            })
            .from(collector)
            .where(and(eq(collector.id, 1), guard)),
        ),
      );
  }
  for (const [day, delta] of buckets)
    statements.push(
      db
        .insert(daily)
        .select(
          db
            .select({
              twitchId: sql<string>`${id}`.as("twitchId"),
              day: sql<number>`${day}`.as("day"),
              durationSeconds: sql<number>`${delta.durationSeconds}`.as(
                "durationSeconds",
              ),
              viewerSeconds: sql<number>`${delta.viewerSeconds}`.as(
                "viewerSeconds",
              ),
              peakViewers: sql<number>`${delta.peakViewers}`.as("peakViewers"),
            })
            .from(collector)
            .where(and(eq(collector.id, 1), guard)),
        )
        .onConflictDoUpdate({
          target: [daily.twitchId, daily.day],
          set: {
            durationSeconds: sql`${daily.durationSeconds} + excluded.duration_seconds`,
            viewerSeconds: sql`${daily.viewerSeconds} + excluded.viewer_seconds`,
            peakViewers: sql`MAX(${daily.peakViewers}, excluded.peak_viewers)`,
          },
        }),
    );
  statements.push(
    db
      .update(streamers)
      .set({
        login: live?.login ?? old!.login,
        displayName: live?.displayName ?? old!.displayName,
        ...(portrait !== undefined
          ? { profileImageUrl: portrait, profileUpdatedAt: at }
          : {}),
        firstSeenAt: sql`COALESCE(${streamers.firstSeenAt}, ${at})`,
        lastObservedAt: at,
        isLive: !!live,
        sessionId,
        twitchStreamId: live?.twitchStreamId ?? null,
        lastSeenAt: live ? at : old!.lastSeenAt,
        liveStartedAt: live?.startedAt ?? null,
        liveViewerCount: live?.viewerCount ?? null,
        title: live?.title ?? null,
        thumbnailUrl: live?.thumbnailUrl ?? null,
        durationSeconds: sql`${streamers.durationSeconds} + ${seconds}`,
        viewerSeconds: sql`${streamers.viewerSeconds} + ${viewerSeconds}`,
        peakViewers: sql`MAX(${streamers.peakViewers}, ${live?.viewerCount ?? 0})`,
      })
      .where(and(eq(streamers.twitchId, id), guard))
      .returning({ id: streamers.twitchId }),
  );
  const result = await db.batch(
    statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
  );
  if (!(result.at(-1) as unknown[]).length)
    throw new Error("Observation superseded");
}
