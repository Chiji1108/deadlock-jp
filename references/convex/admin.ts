import { searchSteamProfiles, steamProfile, steamNames } from "./steamSearch";
import { ConvexError, v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import {
  env,
  query,
  mutation,
  action,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { lookupMatch, matchPlayer } from "./matchLookup";
import { deadlockRank } from "./model";
import { rankForStreamer } from "./steamLinks";

async function adminIdentity(ctx: Pick<QueryCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  const issuer = env.CLERK_JWT_ISSUER_DOMAIN;
  const admins = (env.CLERK_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    userId: identity?.subject ?? null,
    isAdmin:
      !!identity &&
      !!issuer &&
      identity.issuer === issuer &&
      admins.includes(identity.subject),
  };
}
async function requireAdmin(ctx: Pick<QueryCtx, "auth">) {
  if (!(await adminIdentity(ctx)).isAdmin)
    throw new ConvexError("管理者権限が必要です");
}
export const access = query({
  args: {},
  returns: v.object({
    userId: v.union(v.string(), v.null()),
    isAdmin: v.boolean(),
  }),
  handler: adminIdentity,
});
export const streamers = query({
  args: {
    search: v.string(),
    unlinkedOnly: v.optional(v.boolean()),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(
    v.object({
      twitchId: v.string(),
      login: v.string(),
      displayName: v.string(),
      profileImageUrl: v.union(v.string(), v.null()),
      deadlockRank,
      isLive: v.boolean(),
      lastSeenAt: v.union(v.number(), v.null()),
      liveStartedAt: v.union(v.number(), v.null()),
      liveViewerCount: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (
      args.search.length > 100 ||
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50
    )
      throw new ConvexError("検索条件が不正です");
    const search = args.search.trim();
    const result = search
      ? await ctx.db
          .query("streamers")
          .withSearchIndex("search_displayName", (q) =>
            q.search("displayName", search),
          )
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("streamerState")
          .withIndex("by_isLive_and_lastSeenAt")
          .order("desc")
          .paginate(args.paginationOpts);
    return {
      ...result,
      page: (
        await Promise.all(
          result.page.map(async (row) => {
            const rank = await rankForStreamer(ctx, row.twitchId);
            if (args.unlinkedOnly && rank !== null) return null;
            const [profile, state] = await Promise.all([
              "displayName" in row
                ? row
                : ctx.db
                    .query("streamers")
                    .withIndex("by_twitchId", (q) =>
                      q.eq("twitchId", row.twitchId),
                    )
                    .unique(),
              "isLive" in row
                ? row
                : ctx.db
                    .query("streamerState")
                    .withIndex("by_twitchId", (q) =>
                      q.eq("twitchId", row.twitchId),
                    )
                    .unique(),
            ]);
            return {
              twitchId: row.twitchId,
              login: profile?.login ?? row.twitchId,
              displayName: profile?.displayName ?? row.twitchId,
              profileImageUrl: profile?.profileImageUrl ?? null,
              deadlockRank: rank,
              isLive: state?.isLive ?? false,
              lastSeenAt: state?.lastSeenAt ?? null,
              liveStartedAt: state?.liveStartedAt ?? null,
              liveViewerCount: state?.liveViewerCount ?? null,
            };
          }),
        )
      ).filter((row) => row !== null),
    };
  },
});
export const link = mutation({
  args: { twitchId: v.string(), steamAccount: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.steamAccount.length > 300)
      throw new ConvexError("Steamアカウントの入力が長すぎます");
    await ctx.runMutation(internal.steamLinks.link, args);
    return null;
  },
});
export const unlink = mutation({
  args: { twitchId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    await ctx.runMutation(internal.steamLinks.unlink, args);
    return null;
  },
});

export const matchParticipants = action({
  args: { matchId: v.string() },
  returns: v.object({
    matchId: v.number(),
    players: v.array(matchPlayer),
    partial: v.boolean(),
  }),
  handler: async (ctx, { matchId }) => {
    await requireAdmin(ctx);
    return await lookupMatch(matchId);
  },
});

export const searchSteam = action({
  args: { search: v.string() },
  returns: v.array(steamProfile),
  handler: async (ctx, { search }) => {
    await requireAdmin(ctx);
    return await searchSteamProfiles(search);
  },
});

export const steamPlayerNames = action({
  args: { accountIds: v.array(v.number()) },
  returns: v.array(v.object({ accountId: v.number(), name: v.string() })),
  handler: async (ctx, { accountIds }) => {
    await requireAdmin(ctx);
    return await steamNames(accountIds);
  },
});

// Operational details are intentionally available only to administrators.
export const collectionHealth = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      day: v.number(),
      processed: v.number(),
      complete: v.boolean(),
      updatedAt: v.number(),
      completedAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const row = await ctx.db
      .query("periodRefresh")
      .withIndex("by_key", (q) => q.eq("key", "rankings"))
      .unique();
    return row
      ? {
          day: row.day,
          processed: row.processed,
          complete: row.complete,
          updatedAt: row.updatedAt,
          completedAt: row.completedAt,
        }
      : null;
  },
});
export const rankHealth = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(
    v.object({
      twitchId: v.string(),
      displayName: v.string(),
      updatedAt: v.union(v.number(), v.null()),
      lastAttemptAt: v.union(v.number(), v.null()),
      lastError: v.union(v.string(), v.null()),
      failureCount: v.number(),
      unavailable: v.boolean(),
      nextRefreshAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50
    )
      throw new ConvexError("ページ件数が不正です");
    const result = await ctx.db
      .query("steamLinks")
      .withIndex("by_nextRefreshAt")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (row) => {
          const profile = await ctx.db
            .query("streamers")
            .withIndex("by_twitchId", (q) => q.eq("twitchId", row.twitchId))
            .unique();
          return {
            twitchId: row.twitchId,
            displayName: profile?.displayName ?? row.twitchId,
            updatedAt: row.updatedAt,
            lastAttemptAt: row.lastAttemptAt ?? row.updatedAt,
            lastError: row.lastError ?? null,
            failureCount: row.failureCount ?? 0,
            unavailable: row.unavailable,
            nextRefreshAt: row.nextRefreshAt,
          };
        }),
      ),
    };
  },
});
