import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { TwitchClient } from "./twitch";

export const collect = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const clientId = env.TWITCH_CLIENT_ID,
      secret = env.TWITCH_CLIENT_SECRET;
    const runId = crypto.randomUUID();
    let observedAt: number | null = await ctx.runMutation(
      internal.collectionState.begin,
      { runId, configured: !!clientId && !!secret },
    );
    if (observedAt === null) return null;
    try {
      const twitch = new TwitchClient(clientId!, secret!);
      const active: string[] = [];
      let cursor: string | null = null;
      do {
        const page: {
          page: string[];
          continueCursor: string;
          isDone: boolean;
        } = await ctx.runQuery(internal.ingestion.activePage, {
          paginationOpts: { numItems: 100, cursor },
        });
        active.push(...page.page);
        cursor = page.isDone ? null : page.continueCursor;
        if (active.length > 3000)
          throw new Error("Active stream safety limit reached");
      } while (cursor);
      const gameId = await twitch.gameId();
      const discovered = await twitch.discover(gameId);
      const streams = new Map(discovered.map((s) => [s.user_id, s]));
      // Discovery is viewer-sorted, so users can move between pages. Verify any
      // previously active user omitted from discovery before closing their session.
      for (const stream of await twitch.byUsers(
        active.filter((id) => !streams.has(id)),
      ))
        streams.set(stream.user_id, stream);
      const snapshot = new Map(
        [...streams].filter(
          ([, s]) => s.game_id === gameId && s.language === "ja",
        ),
      );
      observedAt = Date.now();
      // Validate time-dependent invariants for the entire snapshot before the first
      // streamer transaction. A bad later row must not leave an earlier row committed.
      for (const stream of snapshot.values()) {
        const startedAt = Date.parse(stream.started_at);
        if (
          !Number.isSafeInteger(startedAt) ||
          startedAt <= 0 ||
          startedAt > observedAt
        )
          throw new Error("Invalid Twitch stream start time in snapshot");
      }
      const ids = [...snapshot.keys()];
      const portraits = new Map<string, string>();
      for (let i = 0; i < ids.length; i += 100) {
        const due: string[] = await ctx.runQuery(
          internal.ingestion.profilesDue,
          { ids: ids.slice(i, i + 100), at: observedAt },
        );
        try {
          for (const profile of await twitch.profiles(due))
            portraits.set(profile.id, profile.url);
        } catch {
          console.warn("Optional Twitch portrait refresh failed");
        }
      }
      // No writes to stream state happen until all discovery and verification calls succeed.
      // Each stream's rollups, session, aggregates and ranking commit atomically.
      for (const id of new Set([...active, ...snapshot.keys()])) {
        const stream = snapshot.get(id);
        const accepted: boolean = await ctx.runMutation(
          internal.ingestion.applyObservation,
          {
            runId,
            twitchId: id,
            observedAt,
            live: stream
              ? {
                  twitchStreamId: stream.id,
                  login: stream.user_login,
                  displayName: stream.user_name,
                  title: stream.title,
                  viewerCount: stream.viewer_count,
                  twitchStartedAt: Date.parse(stream.started_at),
                  ...(stream.thumbnail_url
                    ? { thumbnailUrl: stream.thumbnail_url }
                    : {}),
                  ...(portraits.has(id)
                    ? { profileImageUrl: portraits.get(id)! }
                    : {}),
                }
              : null,
          },
        );
        if (!accepted)
          throw new Error("Observation superseded by another collection");
      }
      await ctx.runMutation(internal.collectionState.finish, {
        runId,
        observedAt,
        success: true,
      });
    } catch (error) {
      console.error(
        "Twitch collection failed",
        error instanceof Error ? error.message : "Unknown error",
      );
      await ctx.runMutation(internal.collectionState.finish, {
        runId,
        observedAt,
        success: false,
      });
    }
    return null;
  },
});
