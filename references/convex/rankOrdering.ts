import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { periods } from "./model";
import { internal } from "./_generated/api";

export function rankOrder(
  rank: {
    tier: number | null;
    subrank: number | null;
    unavailable?: boolean;
  } | null,
) {
  const tier = rank?.tier,
    subrank = rank?.subrank;
  const valid =
    !rank?.unavailable &&
    typeof tier === "number" &&
    Number.isInteger(tier) &&
    tier >= 1 &&
    tier <= 11 &&
    typeof subrank === "number" &&
    Number.isInteger(subrank) &&
    subrank >= 1 &&
    subrank <= 6;
  // Obscurus has a known account/rank response, unlike an unlinked or unavailable rank.
  // Keep it below rated players but above missing ranks in both directions.
  if (!rank?.unavailable && tier === 0 && subrank === 0)
    return { rankScore: 1, rankReverse: 1 };
  const score = valid ? tier * 10 + subrank : 0;
  // Both indexes are read descending, so unknown/missing ranks stay last in either direction.
  return { rankScore: score, rankReverse: score ? 200 - score : 0 };
}
export async function syncRankOrder(
  ctx: MutationCtx,
  twitchId: string,
  rank: Parameters<typeof rankOrder>[0],
) {
  const rows = await ctx.db
    .query("rankings")
    .withIndex("by_twitchId_and_period", (q) => q.eq("twitchId", twitchId))
    .take(periods.length);
  for (const row of rows)
    await ctx.db.patch("rankings", row._id, rankOrder(rank));
}
export function matchTimeOrder(seconds: number | null | undefined) {
  // Zero is a known duration; missing data must sort below it.
  return {
    matchTimeScore:
      typeof seconds === "number" &&
      Number.isSafeInteger(seconds) &&
      seconds >= 0
        ? seconds
        : -1,
  };
}
export async function syncMatchTimeOrder(
  ctx: MutationCtx,
  twitchId: string,
  seconds: number | null | undefined,
) {
  const rows = await ctx.db
    .query("rankings")
    .withIndex("by_twitchId_and_period", (q) => q.eq("twitchId", twitchId))
    .take(periods.length);
  const value = matchTimeOrder(seconds);
  for (const row of rows)
    if (row.matchTimeScore !== value.matchTimeScore)
      await ctx.db.patch("rankings", row._id, value);
}
// A persisted checkpoint makes each batch retryable by the cron after a failure.
// Bump this name when changing the meaning of the materialized ordering keys.
const MIGRATION = "rank-and-match-time-order-v3";
export async function migrationState(ctx: QueryCtx) {
  return ctx.db
    .query("migrations")
    .withIndex("by_name", (q) => q.eq("name", MIGRATION))
    .unique();
}
export const status = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ phase: v.string(), checked: v.number(), repaired: v.number() }),
  ),
  handler: async (ctx) => {
    const state = await migrationState(ctx);
    return state
      ? { phase: state.phase, checked: state.checked, repaired: state.repaired }
      : null;
  },
});
export const backfill = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const old = await migrationState(ctx);
    if (old?.phase === "ready") return null;
    const phase = old?.phase ?? "backfill";
    const page = await ctx.db
      .query("rankings")
      .withIndex("by_creation_time")
      .paginate({ cursor: old?.cursor ?? null, numItems: 50 });
    let repaired = old?.repaired ?? 0;
    let mismatch = false;
    for (const row of page.page) {
      const rank = await ctx.db
        .query("steamLinks")
        .withIndex("by_twitchId", (q) => q.eq("twitchId", row.twitchId))
        .unique();
      const expected = {
        ...rankOrder(rank),
        ...matchTimeOrder(rank?.matchTimeSeconds),
      };
      if (
        row.rankScore !== expected.rankScore ||
        row.rankReverse !== expected.rankReverse ||
        row.matchTimeScore !== expected.matchTimeScore
      ) {
        mismatch = true;
        if (phase === "backfill") {
          await ctx.db.patch("rankings", row._id, expected);
          repaired++;
        }
      }
    }
    // Verification failure restarts repair; never publish partially repaired data.
    const restart = phase === "verify" && mismatch;
    const nextPhase: "backfill" | "verify" | "ready" = restart
      ? "backfill"
      : page.isDone
        ? phase === "backfill"
          ? "verify"
          : "ready"
        : phase;
    const value = {
      name: MIGRATION,
      phase: nextPhase,
      cursor: restart || page.isDone ? null : page.continueCursor,
      checked:
        restart || (page.isDone && phase === "backfill")
          ? 0
          : (old?.checked ?? 0) + page.page.length,
      repaired,
      updatedAt: Date.now(),
    };
    if (old) await ctx.db.replace("migrations", old._id, value);
    else await ctx.db.insert("migrations", value);
    if (nextPhase !== "ready")
      await ctx.scheduler.runAfter(0, internal.rankOrdering.backfill, {});
    return null;
  },
});
