import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { collectorStatus, metricFields, periodValidator } from "./model";
import { heroAsset, recentMatch } from "./playerActivityModel";

// All timestamps and day keys are Unix milliseconds. Durations use seconds.
export default defineSchema({
  deadlockAssets: defineTable({
    key: v.literal("heroes"),
    heroes: v.array(heroAsset),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  periodRefresh: defineTable({
    key: v.literal("rankings"),
    day: v.number(),
    cursor: v.union(v.string(), v.null()),
    processed: v.number(),
    complete: v.boolean(),
    updatedAt: v.number(),
    completedAt: v.union(v.number(), v.null()),
  }).index("by_key", ["key"]),
  migrations: defineTable({
    name: v.string(),
    phase: v.union(
      v.literal("backfill"),
      v.literal("verify"),
      v.literal("ready"),
    ),
    cursor: v.union(v.string(), v.null()),
    checked: v.number(),
    repaired: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
  steamLinks: defineTable({
    twitchId: v.string(),
    accountId: v.number(),
    tier: v.union(v.number(), v.null()),
    subrank: v.union(v.number(), v.null()),
    updatedAt: v.union(v.number(), v.null()),
    unavailable: v.boolean(),
    nextRefreshAt: v.number(),
    lastAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    failureCount: v.optional(v.number()),
    // Bounded snapshot: never store more than the latest 20 matches.
    recentMatches: v.optional(v.array(recentMatch)),
    historyUpdatedAt: v.optional(v.number()),
    matchTimeSeconds: v.optional(v.union(v.number(), v.null())),
    matchTimeUpdatedAt: v.optional(v.number()),
    nextActivityRefreshAt: v.optional(v.number()),
    activityAttemptAt: v.optional(v.number()),
    activityLastError: v.optional(v.string()),
    activityFailureCount: v.optional(v.number()),
  })
    .index("by_twitchId", ["twitchId"])
    .index("by_accountId", ["accountId"])
    .index("by_nextActivityRefreshAt", ["nextActivityRefreshAt"])
    .index("by_nextRefreshAt", ["nextRefreshAt"]),
  streamers: defineTable({
    twitchId: v.string(),
    login: v.string(),
    displayName: v.string(),
    profileImageUrl: v.union(v.string(), v.null()),
    profileUpdatedAt: v.union(v.number(), v.null()),
    firstSeenAt: v.number(),
  })
    .index("by_twitchId", ["twitchId"])
    .searchIndex("search_displayName", { searchField: "displayName" }),
  streamerState: defineTable({
    twitchId: v.string(),
    isLive: v.boolean(),
    hasOpenSession: v.boolean(),
    sessionId: v.union(v.id("sessions"), v.null()),
    lastObservedAt: v.number(),
    lastSeenAt: v.number(),
    liveViewerCount: v.union(v.number(), v.null()),
    liveStartedAt: v.union(v.number(), v.null()),
    thumbnailUrl: v.optional(v.union(v.string(), v.null())),
    title: v.union(v.string(), v.null()),
    ...metricFields,
  })
    .index("by_twitchId", ["twitchId"])
    .index("by_isLive_and_lastSeenAt", ["isLive", "lastSeenAt"])
    .index("by_hasOpenSession_and_twitchId", ["hasOpenSession", "twitchId"]),
  sessions: defineTable({
    twitchId: v.string(),
    twitchStreamId: v.string(),
    title: v.string(),
    twitchStartedAt: v.number(),
    startedAt: v.number(),
    lastSeenAt: v.number(),
    endedAt: v.union(v.number(), v.null()),
    lastViewerCount: v.number(),
    ...metricFields,
  }).index("by_twitchId_and_startedAt", ["twitchId", "startedAt"]),
  daily: defineTable({
    twitchId: v.string(),
    day: v.number(),
    ...metricFields,
    // Fixed 24-element arrays, one observed duration for each JST hour. No raw minute rows.
    hours: v.array(v.number()),
  }).index("by_twitchId_and_day", ["twitchId", "day"]),
  rankings: defineTable({
    twitchId: v.string(),
    period: periodValidator,
    asOfDay: v.number(),
    isLive: v.boolean(),
    ...metricFields,
    averageViewers: v.number(),
    streamingDays: v.optional(v.number()), // Legacy rows; no longer computed.
    rankScore: v.optional(v.number()),
    rankReverse: v.optional(v.number()),
    matchTimeScore: v.optional(v.number()),
  })
    .index("by_twitchId_and_period", ["twitchId", "period"])
    .index("by_period_and_matchTimeScore", ["period", "matchTimeScore"])
    .index("by_period_and_isLive_and_matchTimeScore", [
      "period",
      "isLive",
      "matchTimeScore",
    ])
    .index("by_period_and_rankScore", ["period", "rankScore"])
    .index("by_period_and_isLive_and_rankScore", [
      "period",
      "isLive",
      "rankScore",
    ])
    .index("by_period_and_rankReverse", ["period", "rankReverse"])
    .index("by_period_and_isLive_and_rankReverse", [
      "period",
      "isLive",
      "rankReverse",
    ])
    .index("by_period_and_durationSeconds", ["period", "durationSeconds"])
    .index("by_period_and_averageViewers", ["period", "averageViewers"])
    .index("by_period_and_viewerSeconds", ["period", "viewerSeconds"])
    .index("by_period_and_peakViewers", ["period", "peakViewers"])
    .index("by_period_and_isLive_and_peakViewers", [
      "period",
      "isLive",
      "peakViewers",
    ])
    .index("by_period_and_isLive_and_durationSeconds", [
      "period",
      "isLive",
      "durationSeconds",
    ])
    .index("by_period_and_isLive_and_averageViewers", [
      "period",
      "isLive",
      "averageViewers",
    ])
    .index("by_period_and_isLive_and_viewerSeconds", [
      "period",
      "isLive",
      "viewerSeconds",
    ]),
  collector: defineTable({
    key: v.literal("twitch"),
    configured: v.boolean(),
    state: collectorStatus,
    message: v.union(v.string(), v.null()),
    runId: v.union(v.string(), v.null()),
    leaseUntil: v.number(),
    lastAttemptAt: v.union(v.number(), v.null()),
    lastCollectedAt: v.union(v.number(), v.null()),
    liveCount: v.number(),
    streamerCount: v.number(),
    totalDurationSeconds: v.number(),
    totalViewerSeconds: v.number(),
  }).index("by_key", ["key"]),
});
