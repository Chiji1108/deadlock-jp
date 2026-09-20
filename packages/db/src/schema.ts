import { sql, desc } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";

export const collector = sqliteTable(
  "collector_state",
  {
    id: integer().primaryKey(),
    runId: text("run_id"),
    leaseUntil: integer("lease_until").notNull().default(0),
    lastScheduledAt: integer("last_scheduled_at").notNull().default(0),
    measurementStartedAt: integer("measurement_started_at"),
    firstCollectedAt: integer("first_collected_at"),
    lastCollectedAt: integer("last_collected_at"),
    lastAttemptAt: integer("last_attempt_at"),
    state: text({ enum: ["unconfigured", "collecting", "ready", "error"] })
      .notNull()
      .default("unconfigured"),
    error: text(),
  },
  (t) => [check("collector_singleton", sql`${t.id} = 1`)],
);
const counters = () => ({
  durationSeconds: real("duration_seconds").notNull().default(0),
  viewerSeconds: real("viewer_seconds").notNull().default(0),
  peakViewers: integer("peak_viewers").notNull().default(0),
});
// Lifetime counters and sort keys live beside the public profile: one indexed
// read per page, no per-row joins or history scans. Import-only identities stay
// hidden until their first Twitch observation.
export const streamers = sqliteTable(
  "streamers",
  {
    twitchId: text("twitch_id").primaryKey(),
    login: text().notNull().default(""),
    displayName: text("display_name").notNull().default(""),
    profileImageUrl: text("profile_image_url"),
    profileUpdatedAt: integer("profile_updated_at"),
    firstSeenAt: integer("first_seen_at"),
    lastObservedAt: integer("last_observed_at").notNull().default(0),
    isLive: integer("is_live", { mode: "boolean" }).notNull().default(false),
    sessionId: text("session_id"),
    twitchStreamId: text("twitch_stream_id"),
    lastSeenAt: integer("last_seen_at"),
    liveStartedAt: integer("live_started_at"),
    liveViewerCount: integer("live_viewer_count"),
    title: text(),
    thumbnailUrl: text("thumbnail_url"),
    ...counters(),
    averageViewers: real("average_viewers").generatedAlwaysAs(
      sql`CASE WHEN duration_seconds > 0 THEN viewer_seconds / duration_seconds ELSE 0 END`,
    ),
    steamAccountId: integer("steam_account_id").unique(),
    steamLinkVersion: integer("steam_link_version").notNull().default(0),
    rankTier: integer("rank_tier"),
    rankSubrank: integer("rank_subrank"),
    rankUpdatedAt: integer("rank_updated_at"),
    rankUnavailable: integer("rank_unavailable", { mode: "boolean" })
      .notNull()
      .default(false),
    rankScore: integer("rank_score").generatedAlwaysAs(
      sql`CASE WHEN rank_tier > 0 THEN rank_tier * 10 + rank_subrank WHEN rank_tier = 0 THEN 0 ELSE -1 END`,
    ),
    rankAscScore: integer("rank_asc_score").generatedAlwaysAs(
      sql`CASE WHEN rank_tier > 0 THEN 200 - rank_tier * 10 - rank_subrank WHEN rank_tier = 0 THEN 0 ELSE -1 END`,
    ),
    matchTimeSeconds: integer("match_time_seconds"),
    matchTimeUpdatedAt: integer("match_time_updated_at"),
    recentMatches: text("recent_matches", { mode: "json" })
      .$type<import("./types").RecentMatch[]>()
      .notNull()
      .default([]),
    historyUpdatedAt: integer("history_updated_at"),
    enrichmentDueAt: integer("enrichment_due_at").notNull().default(0),
    enrichmentFailures: integer("enrichment_failures").notNull().default(0),
    enrichmentError: text("enrichment_error"),
  },
  (t) => [
    index("streamers_live")
      .on(desc(t.isLive), desc(t.viewerSeconds), t.twitchId)
      .where(sql`${t.firstSeenAt} IS NOT NULL`),
    ...[
      t.durationSeconds,
      t.viewerSeconds,
      t.averageViewers,
      t.peakViewers,
      t.rankScore,
      t.rankAscScore,
      t.matchTimeSeconds,
    ].map((c) =>
      index(`streamers_${c.name}`)
        .on(desc(c), t.twitchId)
        .where(sql`${t.firstSeenAt} IS NOT NULL`),
    ),
    index("streamers_enrichment")
      .on(t.enrichmentDueAt)
      .where(sql`${t.steamAccountId} IS NOT NULL`),
    check(
      "positive_metrics",
      sql`${t.durationSeconds} >= 0 AND ${t.viewerSeconds} >= 0 AND ${t.peakViewers} >= 0`,
    ),
    check(
      "steam_account_range",
      sql`${t.steamAccountId} > 0 AND ${t.steamAccountId} <= 4294967295`,
    ),
    check(
      "rank_range",
      sql`(${t.rankTier} IS NULL AND ${t.rankSubrank} IS NULL) OR (${t.rankTier} = 0 AND ${t.rankSubrank} = 0) OR (${t.rankTier} BETWEEN 1 AND 11 AND ${t.rankSubrank} BETWEEN 1 AND 6)`,
    ),
  ],
);
export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    twitchId: text("twitch_id")
      .notNull()
      .references(() => streamers.twitchId),
    twitchStreamId: text("twitch_stream_id").notNull(),
    title: text().notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    ...counters(),
  },
  (t) => [index("sessions_recent").on(t.twitchId, desc(t.startedAt), t.id)],
);
export const daily = sqliteTable(
  "daily_stats",
  {
    twitchId: text("twitch_id")
      .notNull()
      .references(() => streamers.twitchId),
    day: integer().notNull(),
    ...counters(),
  },
  (t) => [primaryKey({ columns: [t.twitchId, t.day] })],
);
export const hourly = sqliteTable(
  "hourly_stats",
  {
    twitchId: text("twitch_id")
      .notNull()
      .references(() => streamers.twitchId),
    hour: integer().notNull(),
    durationSeconds: real("duration_seconds").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.twitchId, t.hour] })],
);
export const cache = sqliteTable("api_cache", {
  key: text().primaryKey(),
  value: text().notNull(),
  expiresAt: integer("expires_at").notNull(),
});
export type StreamerRecord = typeof streamers.$inferSelect;
