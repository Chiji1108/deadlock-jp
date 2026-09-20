import { syncRankOrder, syncMatchTimeOrder } from "./rankOrdering";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  internalAction,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { steamAccountId, parseRank } from "./deadlock";
import schema from "./schema";
import { activityForLink } from "./playerActivity";
const HOUR = 3600000;

// Dashboard-only: internal functions cannot be invoked by an unauthenticated client.
export const link = internalMutation({
  args: { twitchId: v.string(), steamAccount: v.string() },
  returns: v.null(),
  handler: async (ctx, { twitchId, steamAccount }) => {
    const accountId = steamAccountId(steamAccount);
    const streamer = await ctx.db
      .query("streamers")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (!streamer)
      throw new ConvexError(
        "配信者が見つかりません。詳細ページのTwitch IDを指定してください",
      );
    const duplicate = await ctx.db
      .query("steamLinks")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .unique();
    if (duplicate && duplicate.twitchId !== twitchId)
      throw new ConvexError("このSteamアカウントは別の配信者に登録済みです");
    const old = await ctx.db
      .query("steamLinks")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (old) await ctx.db.delete("steamLinks", old._id);
    // A new document ID invalidates in-flight requests for an earlier association.
    const id = await ctx.db.insert("steamLinks", {
      twitchId,
      accountId,
      tier: null,
      subrank: null,
      updatedAt: null,
      unavailable: false,
      nextRefreshAt: Date.now() + HOUR,
      nextActivityRefreshAt: Date.now() + HOUR,
    });
    await syncRankOrder(ctx, twitchId, null);
    await syncMatchTimeOrder(ctx, twitchId, null);
    await ctx.scheduler.runAfter(0, internal.steamLinks.refresh, { id });
    await ctx.scheduler.runAfter(0, internal.playerActivity.refresh, { id });
    return null;
  },
});
export const unlink = internalMutation({
  args: { twitchId: v.string() },
  returns: v.null(),
  handler: async (ctx, { twitchId }) => {
    const row = await ctx.db
      .query("steamLinks")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (row) await ctx.db.delete("steamLinks", row._id);
    await syncRankOrder(ctx, twitchId, null);
    await syncMatchTimeOrder(ctx, twitchId, null);
    return null;
  },
});
export const refreshDue = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("steamLinks")
      .withIndex("by_nextRefreshAt", (q) => q.lte("nextRefreshAt", now))
      .take(10);
    for (const row of rows) {
      await ctx.db.patch("steamLinks", row._id, { nextRefreshAt: now + HOUR });
      await ctx.scheduler.runAfter(0, internal.steamLinks.refresh, {
        id: row._id,
      });
    }
    return null;
  },
});
export const get = internalQuery({
  args: { id: v.id("steamLinks") },
  returns: v.union(v.null(), schema.doc("steamLinks")),
  handler: (ctx, { id }) => ctx.db.get("steamLinks", id),
});
export const save = internalMutation({
  args: {
    id: v.id("steamLinks"),
    attemptedAt: v.number(),
    error: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
    result: v.union(
      v.null(),
      v.object({ tier: v.number(), subrank: v.number() }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { id, attemptedAt, result, error, retryAfterMs }) => {
    const row = await ctx.db.get("steamLinks", id);
    if (!row || (row.lastAttemptAt ?? row.updatedAt ?? -1) > attemptedAt)
      return null;
    if (error) {
      const failureCount = (row.failureCount ?? 0) + 1;
      const backoff = Math.min(
        HOUR,
        5 * 60_000 * 2 ** Math.min(failureCount - 1, 4),
      );
      await ctx.db.patch("steamLinks", id, {
        lastAttemptAt: attemptedAt,
        lastError: error,
        failureCount,
        unavailable: row.updatedAt === null ? true : row.unavailable,
        nextRefreshAt: attemptedAt + Math.max(backoff, retryAfterMs ?? 0),
      });
      return null;
    }
    // Clear old values on protected/unavailable results rather than exposing a stale badge.
    await ctx.db.patch("steamLinks", id, {
      tier: result?.tier ?? null,
      subrank: result?.subrank ?? null,
      updatedAt: attemptedAt,
      lastAttemptAt: attemptedAt,
      lastError: undefined,
      failureCount: 0,
      nextRefreshAt: attemptedAt + HOUR,
      unavailable: result === null,
    });
    await syncRankOrder(ctx, row.twitchId, result);
    return null;
  },
});
export const refresh = internalAction({
  args: { id: v.id("steamLinks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.runQuery(internal.steamLinks.get, { id });
    if (!row) return null;
    const attemptedAt = Date.now();
    let result = null;
    let error: string | undefined;
    let retryAfterMs: number | undefined;
    try {
      const response = await fetch(
        `https://api.deadlock-api.com/v1/players/${row.accountId}/rank`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (response.ok) {
        try {
          result = parseRank(await response.json());
        } catch {
          error = "invalid_response";
        }
      } else if (response.status !== 403 && response.status !== 404) {
        error = `http_${response.status}`;
        const header = response.headers.get("Retry-After");
        if (header) {
          const seconds = Number(header);
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(header) - attemptedAt;
          if (Number.isFinite(delay) && delay > 0) retryAfterMs = delay;
        }
      }
    } catch {
      error = "network_error";
    }
    await ctx.runMutation(internal.steamLinks.save, {
      id,
      attemptedAt,
      result,
      ...(error ? { error } : {}),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
    return null;
  },
});
export async function rankForStreamer(ctx: QueryCtx, twitchId: string) {
  return (await deadlockForStreamer(ctx, twitchId)).deadlockRank;
}
export async function deadlockForStreamer(ctx: QueryCtx, twitchId: string) {
  const row = await ctx.db
    .query("steamLinks")
    .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
    .unique();
  if (!row) return { deadlockRank: null, deadlockActivity: null };
  const { accountId, tier, subrank, updatedAt, unavailable } = row;
  return {
    deadlockRank: { accountId, tier, subrank, updatedAt, unavailable },
    deadlockActivity: activityForLink(row),
  };
}
