import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const begin = internalMutation({
  args: { runId: v.string(), configured: v.boolean() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { runId, configured }) => {
    const at = Date.now();
    const old = await ctx.db
      .query("collector")
      .withIndex("by_key", (q) => q.eq("key", "twitch"))
      .unique();
    if (old?.runId && old.leaseUntil > at) return null;
    const update = {
      configured,
      state: configured ? ("collecting" as const) : ("unconfigured" as const),
      message: configured ? null : "Twitch APIの接続設定が必要です。",
      runId: configured ? runId : null,
      leaseUntil: configured ? at + 9 * 60_000 : 0,
      lastAttemptAt: at,
    };
    if (old) await ctx.db.patch("collector", old._id, update);
    else
      await ctx.db.insert("collector", {
        key: "twitch",
        ...update,
        lastCollectedAt: null,
        liveCount: 0,
        streamerCount: 0,
        totalDurationSeconds: 0,
        totalViewerSeconds: 0,
      });
    return configured ? at : null;
  },
});
export const finish = internalMutation({
  args: { runId: v.string(), observedAt: v.number(), success: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("collector")
      .withIndex("by_key", (q) => q.eq("key", "twitch"))
      .unique();
    if (state?.runId !== args.runId) return null;
    await ctx.db.patch("collector", state._id, {
      runId: null,
      leaseUntil: 0,
      state: args.success ? "healthy" : "error",
      message: args.success
        ? null
        : "データ取得を完了できませんでした。次回の収集で再試行します。",
      ...(args.success ? { lastCollectedAt: args.observedAt } : {}),
    });
    return null;
  },
});
