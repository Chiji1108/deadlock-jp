import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { dayStart } from "./time";
import { periods } from "./model";
import { refreshRankings } from "./ingestion";

// Advance dormant streamers' rolling windows even when they have not gone live.
// Bounded continuation mutations prevent an ever-growing all-streamer transaction.
export const refreshPeriods = internalMutation({
  // Accept legacy scheduled calls, but trust only the persisted checkpoint.
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const day = dayStart(now);
    const old = await ctx.db
      .query("periodRefresh")
      .withIndex("by_key", (q) => q.eq("key", "rankings"))
      .unique();
    if (old?.day === day && old.complete) return null;
    const continuing = old?.day === day;
    const page = await ctx.db
      .query("streamerState")
      .withIndex("by_creation_time")
      .paginate({ cursor: continuing ? old.cursor : null, numItems: 8 });
    for (const state of page.page)
      await refreshRankings(ctx, state, Math.max(now, state.lastObservedAt));
    const value = {
      key: "rankings" as const,
      day,
      cursor: page.isDone ? null : page.continueCursor,
      processed: (continuing ? old.processed : 0) + page.page.length,
      complete: page.isDone,
      updatedAt: now,
      completedAt: page.isDone ? now : null,
    };
    if (old) await ctx.db.replace("periodRefresh", old._id, value);
    else await ctx.db.insert("periodRefresh", value);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.maintenance.refreshPeriods, {});
    return null;
  },
});

// Expiry updates indexed LIVE filters even if Twitch fails or credentials disappear.
// Keep the open session pointer so the next successful collection still verifies it.
export const expireLive = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 180_000;
    const stale = await ctx.db
      .query("streamerState")
      .withIndex("by_isLive_and_lastSeenAt", (q) =>
        q.eq("isLive", true).lt("lastSeenAt", cutoff),
      )
      .take(50);
    for (const state of stale) {
      await ctx.db.patch("streamerState", state._id, { isLive: false });
      const rankings = await ctx.db
        .query("rankings")
        .withIndex("by_twitchId_and_period", (q) =>
          q.eq("twitchId", state.twitchId),
        )
        .take(periods.length);
      for (const row of rankings)
        await ctx.db.patch("rankings", row._id, { isLive: false });
    }
    if (stale.length) {
      const collector = await ctx.db
        .query("collector")
        .withIndex("by_key", (q) => q.eq("key", "twitch"))
        .unique();
      if (collector)
        await ctx.db.patch("collector", collector._id, {
          liveCount: Math.max(0, collector.liveCount - stale.length),
        });
    }
    if (stale.length === 50)
      await ctx.scheduler.runAfter(0, internal.maintenance.expireLive, {});
    return null;
  },
});
