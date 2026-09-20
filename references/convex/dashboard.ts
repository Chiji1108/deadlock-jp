import { migrationState } from "./rankOrdering";
import { deadlockForStreamer } from "./steamLinks";
import { playerActivity } from "./playerActivityModel";
import { v } from "convex/values";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { query } from "./_generated/server";
import { activeDays, duration, watched } from "./aggregates";
import {
  collectorStatus,
  deadlockRank,
  displayMetricFields,
  metrics,
  periodValidator,
  rankingItem,
} from "./model";
import { DAY, HOUR, dateLabel, dayStart, heatIndex, periodStart } from "./time";

export const status = query({
  args: {},
  returns: v.object({
    rankOrderingReady: v.boolean(),
    configured: v.boolean(),
    lastCollectedAt: v.union(v.number(), v.null()),
    lastAttemptAt: v.union(v.number(), v.null()),
    state: collectorStatus,
    message: v.union(v.string(), v.null()),
    liveCount: v.number(),
    streamerCount: v.number(),
    totalDurationSeconds: v.number(),
    totalViewerSeconds: v.number(),
  }),
  handler: async (ctx) => {
    const value = await ctx.db
      .query("collector")
      .withIndex("by_key", (q) => q.eq("key", "twitch"))
      .unique();
    return {
      rankOrderingReady: (await migrationState(ctx))?.phase === "ready",
      configured: value?.configured ?? false,
      lastCollectedAt: value?.lastCollectedAt ?? null,
      lastAttemptAt: value?.lastAttemptAt ?? null,
      state: value?.state ?? ("unconfigured" as const),
      message: value?.message ?? null,
      liveCount: value?.liveCount ?? 0,
      streamerCount: value?.streamerCount ?? 0,
      totalDurationSeconds: value?.totalDurationSeconds ?? 0,
      totalViewerSeconds: value?.totalViewerSeconds ?? 0,
    };
  },
});

export const ranking = query({
  args: {
    period: periodValidator,
    sort: v.union(
      v.literal("live"),
      v.literal("duration"),
      v.literal("viewers"),
      v.literal("watched"),
      v.literal("peak"),
      v.literal("rank"),
      v.literal("rankAsc"),
      v.literal("matchTime"),
    ),
    liveOnly: v.boolean(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(rankingItem),
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 100
    )
      throw new Error("Page size must be 1–100");
    if (
      (args.sort === "rank" ||
        args.sort === "rankAsc" ||
        args.sort === "matchTime") &&
      (await migrationState(ctx))?.phase !== "ready"
    )
      return { page: [], isDone: true, continueCursor: "" };
    const source = ctx.db.query("rankings");
    // A period-only range retains isLive as the primary descending sort key.
    const ordered =
      args.sort === "live"
        ? source.withIndex("by_period_and_isLive_and_viewerSeconds", (q) =>
            args.liveOnly
              ? q.eq("period", args.period).eq("isLive", true)
              : q.eq("period", args.period),
          )
        : args.sort === "matchTime"
          ? args.liveOnly
            ? source.withIndex("by_period_and_isLive_and_matchTimeScore", (q) =>
                q.eq("period", args.period).eq("isLive", true),
              )
            : source.withIndex("by_period_and_matchTimeScore", (q) =>
                q.eq("period", args.period),
              )
          : args.sort === "rank" || args.sort === "rankAsc"
            ? args.liveOnly
              ? args.sort === "rank"
                ? source.withIndex("by_period_and_isLive_and_rankScore", (q) =>
                    q.eq("period", args.period).eq("isLive", true),
                  )
                : source.withIndex(
                    "by_period_and_isLive_and_rankReverse",
                    (q) => q.eq("period", args.period).eq("isLive", true),
                  )
              : args.sort === "rank"
                ? source.withIndex("by_period_and_rankScore", (q) =>
                    q.eq("period", args.period),
                  )
                : source.withIndex("by_period_and_rankReverse", (q) =>
                    q.eq("period", args.period),
                  )
            : args.liveOnly
              ? args.sort === "duration"
                ? source.withIndex(
                    "by_period_and_isLive_and_durationSeconds",
                    (q) => q.eq("period", args.period).eq("isLive", true),
                  )
                : args.sort === "peak"
                  ? source.withIndex(
                      "by_period_and_isLive_and_peakViewers",
                      (q) => q.eq("period", args.period).eq("isLive", true),
                    )
                  : args.sort === "viewers"
                    ? source.withIndex(
                        "by_period_and_isLive_and_averageViewers",
                        (q) => q.eq("period", args.period).eq("isLive", true),
                      )
                    : source.withIndex(
                        "by_period_and_isLive_and_viewerSeconds",
                        (q) => q.eq("period", args.period).eq("isLive", true),
                      )
              : args.sort === "duration"
                ? source.withIndex("by_period_and_durationSeconds", (q) =>
                    q.eq("period", args.period),
                  )
                : args.sort === "peak"
                  ? source.withIndex("by_period_and_peakViewers", (q) =>
                      q.eq("period", args.period),
                    )
                  : args.sort === "viewers"
                    ? source.withIndex("by_period_and_averageViewers", (q) =>
                        q.eq("period", args.period),
                      )
                    : source.withIndex("by_period_and_viewerSeconds", (q) =>
                        q.eq("period", args.period),
                      );
    const result = await ordered.order("desc").paginate(args.paginationOpts);
    const page = await Promise.all(
      result.page.map(async (row) => {
        const [profile, state, rank] = await Promise.all([
          ctx.db
            .query("streamers")
            .withIndex("by_twitchId", (q) => q.eq("twitchId", row.twitchId))
            .unique(),
          ctx.db
            .query("streamerState")
            .withIndex("by_twitchId", (q) => q.eq("twitchId", row.twitchId))
            .unique(),
          deadlockForStreamer(ctx, row.twitchId),
        ]);
        return {
          ...rank,
          twitchId: row.twitchId,
          login: profile?.login ?? row.twitchId,
          displayName: profile?.displayName ?? row.twitchId,
          profileImageUrl: profile?.profileImageUrl ?? null,
          isLive: state?.isLive ?? false,
          liveViewerCount: state?.liveViewerCount ?? null,
          liveStartedAt: state?.liveStartedAt ?? null,
          title: state?.title ?? null,
          ...metrics({
            durationSeconds: row.durationSeconds,
            viewerSeconds: row.viewerSeconds,
            peakViewers: row.peakViewers,
          }),
        };
      }),
    );
    return { ...result, page };
  },
});

const detailResult = v.object({
  deadlockRank,
  deadlockActivity: playerActivity,
  streamer: v.object({
    twitchId: v.string(),
    login: v.string(),
    displayName: v.string(),
    profileImageUrl: v.union(v.string(), v.null()),
    firstSeenAt: v.number(),
  }),
  period: periodValidator,
  isLive: v.boolean(),
  live: v.union(
    v.null(),
    v.object({
      title: v.string(),
      viewerCount: v.number(),
      startedAt: v.number(),
      lastSeenAt: v.number(),
      thumbnailUrl: v.union(v.string(), v.null()),
    }),
  ),
  summary: v.object({ ...displayMetricFields, streamingDays: v.number() }),
  calendar: v.array(v.object({ date: v.string(), ...displayMetricFields })),
  heatmap: v.array(
    v.object({
      weekday: v.number(),
      hour: v.number(),
      durationSeconds: v.number(),
      availableSeconds: v.number(),
      fraction: v.number(),
    }),
  ),
  recentSessions: v.array(
    v.object({
      id: v.string(),
      title: v.string(),
      startedAt: v.number(),
      endedAt: v.union(v.number(), v.null()),
      ...displayMetricFields,
    }),
  ),
  lastCollectedAt: v.union(v.number(), v.null()),
});
export const detail = query({
  args: { twitchId: v.string(), period: periodValidator },
  returns: v.union(v.null(), detailResult),
  handler: async (ctx, { twitchId, period }) => {
    const profile = await ctx.db
      .query("streamers")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (!profile) return null;
    const [state, collector] = await Promise.all([
      ctx.db
        .query("streamerState")
        .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
        .unique(),
      ctx.db
        .query("collector")
        .withIndex("by_key", (q) => q.eq("key", "twitch"))
        .unique(),
    ]);
    // A persisted collection clock makes subscriptions deterministic and cacheable.
    const at = Math.max(
      state?.lastObservedAt ?? profile.firstSeenAt,
      collector?.lastAttemptAt ?? 0,
      collector?.lastCollectedAt ?? 0,
    );
    const chartStart = periodStart("quarter", at),
      start = periodStart(period, at);
    const range = {
      namespace: twitchId,
      bounds: {
        lower: { key: start, inclusive: true },
        upper: { key: dayStart(at), inclusive: true },
      },
    };
    const [days, sessions, durationSeconds, viewerSeconds, streamingDays] =
      await Promise.all([
        ctx.db
          .query("daily")
          .withIndex("by_twitchId_and_day", (q) =>
            q
              .eq("twitchId", twitchId)
              .gte("day", chartStart)
              .lte("day", dayStart(at)),
          )
          .take(90),
        ctx.db
          .query("sessions")
          .withIndex("by_twitchId_and_startedAt", (q) =>
            q.eq("twitchId", twitchId),
          )
          .order("desc")
          .take(20),
        duration.sum(ctx, range),
        watched.sum(ctx, range),
        activeDays.sum(ctx, range),
      ]);
    const peakViewers =
      period === "all"
        ? (state?.peakViewers ?? 0)
        : days.reduce(
            (max, day) =>
              day.day >= start ? Math.max(max, day.peakViewers) : max,
            0,
          );
    const byDay = new Map(days.map((day) => [day.day, day]));
    const calendar = [];
    for (let day = chartStart; day <= dayStart(at); day += DAY) {
      const value = byDay.get(day);
      calendar.push({
        date: dateLabel(day),
        ...metrics({
          durationSeconds: value?.durationSeconds ?? 0,
          viewerSeconds: value?.viewerSeconds ?? 0,
          peakViewers: value?.peakViewers ?? 0,
        }),
      });
    }
    const heatmap = Array.from({ length: 168 }, (_, i) => ({
      weekday: Math.floor(i / 24),
      hour: i % 24,
      durationSeconds: 0,
      availableSeconds: 0,
      fraction: 0,
    }));
    const availabilityStart = Math.max(chartStart, profile.firstSeenAt);
    for (
      let hour = Math.floor(availabilityStart / HOUR) * HOUR;
      hour < at;
      hour += HOUR
    ) {
      heatmap[heatIndex(hour)].availableSeconds +=
        Math.max(
          0,
          Math.min(hour + HOUR, at) - Math.max(hour, availabilityStart),
        ) / 1000;
    }
    for (const day of days)
      for (let hour = 0; hour < 24; hour++)
        heatmap[heatIndex(day.day + hour * HOUR)].durationSeconds +=
          day.hours[hour] ?? 0;
    for (const cell of heatmap)
      cell.fraction = cell.availableSeconds
        ? Math.min(1, cell.durationSeconds / cell.availableSeconds)
        : 0;
    return {
      ...(await deadlockForStreamer(ctx, twitchId)),
      streamer: {
        twitchId,
        login: profile.login,
        displayName: profile.displayName,
        profileImageUrl: profile.profileImageUrl,
        firstSeenAt: profile.firstSeenAt,
      },
      period,
      isLive: state?.isLive ?? false,
      live: state?.isLive
        ? {
            title: state.title ?? "",
            viewerCount: state.liveViewerCount ?? 0,
            startedAt: state.liveStartedAt ?? state.lastSeenAt,
            lastSeenAt: state.lastSeenAt,
            thumbnailUrl: state.thumbnailUrl ?? null,
          }
        : null,
      summary: {
        ...metrics({ durationSeconds, viewerSeconds, peakViewers }),
        streamingDays,
      },
      calendar,
      heatmap,
      recentSessions: sessions.map((session) => ({
        id: session._id,
        title: session.title,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        ...metrics({
          durationSeconds: session.durationSeconds,
          viewerSeconds: session.viewerSeconds,
          peakViewers: session.peakViewers,
        }),
      })),
      lastCollectedAt: collector?.lastCollectedAt ?? null,
    };
  },
});
