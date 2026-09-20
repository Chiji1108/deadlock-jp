import { v } from "convex/values";
import { playerActivity } from "./playerActivityModel";

export const periodValidator = v.union(
  v.literal("week"),
  v.literal("month"),
  v.literal("quarter"),
  v.literal("all"),
);
export type Period = "week" | "month" | "quarter" | "all";
export const periods: Period[] = ["week", "month", "quarter", "all"];
export const metricFields = {
  durationSeconds: v.number(),
  viewerSeconds: v.number(),
  peakViewers: v.number(),
};
export const displayMetricFields = {
  ...metricFields,
  averageViewers: v.number(),
  hoursStreamed: v.number(),
  hoursWatched: v.number(),
};
export function metrics<
  T extends {
    durationSeconds: number;
    viewerSeconds: number;
    peakViewers: number;
  },
>(value: T) {
  return {
    ...value,
    averageViewers: value.durationSeconds
      ? value.viewerSeconds / value.durationSeconds
      : 0,
    hoursStreamed: value.durationSeconds / 3600,
    hoursWatched: value.viewerSeconds / 3600,
  };
}
export const deadlockRank = v.union(
  v.null(),
  v.object({
    accountId: v.number(),
    tier: v.union(v.number(), v.null()),
    subrank: v.union(v.number(), v.null()),
    updatedAt: v.union(v.number(), v.null()),
    unavailable: v.boolean(),
  }),
);
export const rankingFields = {
  deadlockRank,
  deadlockActivity: playerActivity,
  twitchId: v.string(),
  login: v.string(),
  displayName: v.string(),
  profileImageUrl: v.union(v.string(), v.null()),
  isLive: v.boolean(),
  liveViewerCount: v.union(v.number(), v.null()),
  liveStartedAt: v.union(v.number(), v.null()),
  title: v.union(v.string(), v.null()),
  ...displayMetricFields,
};
export const rankingItem = v.object(rankingFields);
export const liveObservation = v.object({
  twitchStreamId: v.string(),
  login: v.string(),
  displayName: v.string(),
  title: v.string(),
  viewerCount: v.number(),
  twitchStartedAt: v.number(),
  thumbnailUrl: v.optional(v.string()),
  profileImageUrl: v.optional(v.string()),
});
export const collectorStatus = v.union(
  v.literal("unconfigured"),
  v.literal("collecting"),
  v.literal("healthy"),
  v.literal("error"),
);
