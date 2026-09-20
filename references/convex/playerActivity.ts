import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";
import {
  heroAsset,
  recentMatch,
  parseHeroes,
  parseHistory,
  parseMatchTime,
  type HeroAsset,
} from "./playerActivityModel";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { syncMatchTimeOrder } from "./rankOrdering";

const HOUR = 3_600_000;
const failure = v.object({
  kind: v.literal("error"),
  error: v.string(),
  retryAfterMs: v.number(),
});
const unavailable = v.object({ kind: v.literal("unavailable") });

export const assets = internalQuery({
  args: {},
  returns: v.union(v.null(), schema.doc("deadlockAssets")),
  handler: (ctx) =>
    ctx.db
      .query("deadlockAssets")
      .withIndex("by_key", (q) => q.eq("key", "heroes"))
      .unique(),
});
export const saveAssets = internalMutation({
  args: { heroes: v.array(heroAsset), updatedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.heroes.length || args.heroes.length > 256)
      throw new Error("Invalid hero catalog");
    const old = await ctx.db
      .query("deadlockAssets")
      .withIndex("by_key", (q) => q.eq("key", "heroes"))
      .unique();
    if (old && old.updatedAt > args.updatedAt) return null;
    if (old) await ctx.db.patch("deadlockAssets", old._id, args);
    else await ctx.db.insert("deadlockAssets", { key: "heroes", ...args });
    return null;
  },
});

export const refreshDue = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    // Missing optional fields sort before numbers, so existing links initialize here too.
    const rows = await ctx.db
      .query("steamLinks")
      .withIndex("by_nextActivityRefreshAt", (q) =>
        q.lte("nextActivityRefreshAt", now),
      )
      .take(5);
    for (const row of rows) {
      await ctx.db.patch("steamLinks", row._id, {
        nextActivityRefreshAt: now + HOUR,
      });
      await ctx.scheduler.runAfter(0, internal.playerActivity.refresh, {
        id: row._id,
      });
    }
    return null;
  },
});

export const save = internalMutation({
  args: {
    id: v.id("steamLinks"),
    attemptedAt: v.number(),
    history: v.union(
      failure,
      unavailable,
      v.object({ kind: v.literal("ok"), matches: v.array(recentMatch) }),
    ),
    time: v.union(
      failure,
      unavailable,
      v.object({
        kind: v.literal("ok"),
        seconds: v.union(v.number(), v.null()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { id, attemptedAt, history, time }) => {
    const row = await ctx.db.get("steamLinks", id);
    if (!row || (row.activityAttemptAt ?? -1) > attemptedAt) return null;
    if (history.kind === "ok" && history.matches.length > 20)
      throw new Error("Too many recent matches");
    if (
      time.kind === "ok" &&
      time.seconds !== null &&
      (!Number.isSafeInteger(time.seconds) || time.seconds < 0)
    )
      throw new Error("Invalid match duration");
    const errors = [history, time].filter((result) => result.kind === "error");
    const failureCount = errors.length
      ? (row.activityFailureCount ?? 0) + 1
      : 0;
    const delay = errors.length
      ? Math.max(
          Math.min(HOUR, 300_000 * 2 ** Math.min(failureCount - 1, 4)),
          ...errors.map((error) => error.retryAfterMs),
        )
      : HOUR;
    await ctx.db.patch("steamLinks", id, {
      activityAttemptAt: attemptedAt,
      activityLastError: errors.length
        ? errors.map((error) => error.error).join(",")
        : undefined,
      activityFailureCount: failureCount,
      nextActivityRefreshAt: attemptedAt + delay,
      ...(history.kind === "error"
        ? {}
        : {
            recentMatches: history.kind === "ok" ? history.matches : [],
            historyUpdatedAt: attemptedAt,
          }),
      ...(time.kind === "error"
        ? {}
        : {
            matchTimeSeconds: time.kind === "ok" ? time.seconds : null,
            matchTimeUpdatedAt: attemptedAt,
          }),
    });
    if (time.kind !== "error")
      await syncMatchTimeOrder(
        ctx,
        row.twitchId,
        time.kind === "ok" ? time.seconds : null,
      );
    return null;
  },
});

async function fetchValue<T>(
  path: string,
  parse: (value: unknown) => T,
): Promise<
  | { kind: "ok"; value: T }
  | { kind: "unavailable" }
  | { kind: "error"; error: string; retryAfterMs: number }
> {
  try {
    const response = await fetch(`https://api.deadlock-api.com/v1/${path}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 403 || response.status === 404)
      return { kind: "unavailable" };
    if (!response.ok) {
      const header = response.headers.get("Retry-After");
      const delay = header
        ? /^\d+(\.\d+)?$/.test(header)
          ? Number(header) * 1000
          : Date.parse(header) - Date.now()
        : 0;
      return {
        kind: "error",
        error: `http_${response.status}`,
        retryAfterMs: Number.isFinite(delay) ? Math.max(0, delay) : 0,
      };
    }
    try {
      return { kind: "ok", value: parse(await response.json()) };
    } catch {
      return { kind: "error", error: "invalid_response", retryAfterMs: 0 };
    }
  } catch {
    return { kind: "error", error: "network_error", retryAfterMs: 0 };
  }
}

export const refresh = internalAction({
  args: { id: v.id("steamLinks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row: Doc<"steamLinks"> | null = await ctx.runQuery(
      internal.steamLinks.get,
      { id },
    );
    if (!row) return null;
    const attemptedAt = Date.now();
    const cached: Doc<"deadlockAssets"> | null = await ctx.runQuery(
      internal.playerActivity.assets,
      {},
    );
    let heroes: HeroAsset[] = cached?.heroes ?? [];
    if (!cached || attemptedAt - cached.updatedAt > 24 * HOUR) {
      const catalog = await fetchValue("assets/heroes", parseHeroes);
      if (catalog.kind === "ok") {
        heroes = catalog.value;
        await ctx.runMutation(internal.playerActivity.saveAssets, {
          heroes,
          updatedAt: attemptedAt,
        });
      }
    }
    // Independent results: an unavailable stats endpoint must not erase valid history.
    const [history, time] = await Promise.all([
      fetchValue(`players/${row.accountId}/match-history`, (value) =>
        parseHistory(value, row.accountId, heroes),
      ),
      fetchValue(
        `players/hero-stats?account_ids=${row.accountId}&game_mode=normal&match_mode=ranked,unranked`,
        (value) => parseMatchTime(value, row.accountId),
      ),
    ]);
    await ctx.runMutation(internal.playerActivity.save, {
      id,
      attemptedAt,
      history:
        history.kind === "ok"
          ? { kind: "ok", matches: history.value }
          : history,
      time: time.kind === "ok" ? { kind: "ok", seconds: time.value } : time,
    });
    return null;
  },
});

export function activityForLink(row: Doc<"steamLinks">) {
  return {
    recentMatches: row.recentMatches ?? [],
    historyUpdatedAt: row.historyUpdatedAt ?? null,
    matchTimeSeconds: row.matchTimeSeconds ?? null,
    matchTimeUpdatedAt: row.matchTimeUpdatedAt ?? null,
    status: row.recentMatches?.length
      ? ("ready" as const)
      : row.activityAttemptAt !== undefined
        ? ("unavailable" as const)
        : ("pending" as const),
  };
}
