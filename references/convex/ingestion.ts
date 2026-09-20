import { rankOrder, matchTimeOrder } from "./rankOrdering";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { duration, syncDaily, watched } from "./aggregates";
import { liveObservation, periods } from "./model";
import { DAY, MAX_GAP, dayStart, periodStart, splitHours } from "./time";

export async function refreshRankings(
  ctx: MutationCtx,
  state: Doc<"streamerState">,
  at: number,
) {
  const rank = await ctx.db
    .query("steamLinks")
    .withIndex("by_twitchId", (q) => q.eq("twitchId", state.twitchId))
    .unique();
  const day = dayStart(at);
  const ranges = periods.map((period) => ({
    namespace: state.twitchId,
    bounds: {
      lower: { key: periodStart(period, at), inclusive: true },
      upper: { key: day, inclusive: true },
    },
  }));
  const [durations, viewers, counts] = await Promise.all([
    duration.sumBatch(ctx, ranges),
    watched.sumBatch(ctx, ranges),
    duration.countBatch(ctx, ranges),
  ]);
  let recent: Doc<"daily">[] | undefined;
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const old = await ctx.db
      .query("rankings")
      .withIndex("by_twitchId_and_period", (q) =>
        q.eq("twitchId", state.twitchId).eq("period", period),
      )
      .unique();
    if (!counts[i]) {
      if (old) await ctx.db.delete("rankings", old._id);
      continue;
    }
    let peak = state.peakViewers;
    if (period !== "all") {
      // Within one JST day windows only gain observations. Recompute window MAX at rollover.
      if (old?.asOfDay === day)
        peak = Math.max(old.peakViewers, state.liveViewerCount ?? 0);
      else {
        recent ??= await ctx.db
          .query("daily")
          .withIndex("by_twitchId_and_day", (q) =>
            q
              .eq("twitchId", state.twitchId)
              .gte("day", periodStart("quarter", at))
              .lte("day", day),
          )
          .take(90);
        peak = recent.reduce(
          (max, d) =>
            d.day >= periodStart(period, at)
              ? Math.max(max, d.peakViewers)
              : max,
          0,
        );
      }
    }
    const value = {
      twitchId: state.twitchId,
      period,
      asOfDay: day,
      isLive: state.isLive,
      durationSeconds: durations[i],
      viewerSeconds: viewers[i],
      averageViewers: durations[i] ? viewers[i] / durations[i] : 0,
      peakViewers: peak,
      ...rankOrder(rank),
      ...matchTimeOrder(rank?.matchTimeSeconds),
    };
    if (old) await ctx.db.replace("rankings", old._id, value);
    else await ctx.db.insert("rankings", value);
  }
}

export const activePage = internalQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.string()),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("streamerState")
      .withIndex("by_hasOpenSession_and_twitchId", (q) =>
        q.eq("hasOpenSession", true),
      )
      .paginate(args.paginationOpts);
    return { ...page, page: page.page.map((s) => s.twitchId) };
  },
});
export const profilesDue = internalQuery({
  args: { ids: v.array(v.string()), at: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    if (args.ids.length > 100) throw new Error("Profile batch is too large");
    const due: string[] = [];
    for (const id of args.ids) {
      const profile = await ctx.db
        .query("streamers")
        .withIndex("by_twitchId", (q) => q.eq("twitchId", id))
        .unique();
      if (
        !profile?.profileUpdatedAt ||
        args.at - profile.profileUpdatedAt >= DAY
      )
        due.push(id);
    }
    return due;
  },
});

export const applyObservation = internalMutation({
  args: {
    runId: v.string(),
    twitchId: v.string(),
    observedAt: v.number(),
    live: v.union(liveObservation, v.null()),
  },
  returns: v.boolean(),
  handler: async (ctx, { runId, twitchId, observedAt, live }) => {
    if (!Number.isSafeInteger(observedAt) || observedAt <= 0 || !twitchId)
      throw new Error("Invalid observation");
    if (
      live &&
      (!Number.isSafeInteger(live.viewerCount) ||
        live.viewerCount < 0 ||
        !Number.isFinite(live.twitchStartedAt) ||
        live.twitchStartedAt > observedAt)
    )
      throw new Error("Invalid live observation");
    const collector = await ctx.db
      .query("collector")
      .withIndex("by_key", (q) => q.eq("key", "twitch"))
      .unique();
    if (!collector || collector.runId !== runId) return false;
    const previous = await ctx.db
      .query("streamerState")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (previous && observedAt <= previous.lastObservedAt) return false;
    if (!previous && !live) return false;
    let profile = await ctx.db
      .query("streamers")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", twitchId))
      .unique();
    if (live) {
      const portrait =
        live.profileImageUrl !== undefined
          ? {
              profileImageUrl: live.profileImageUrl || null,
              profileUpdatedAt: observedAt,
            }
          : {};
      if (!profile) {
        const id = await ctx.db.insert("streamers", {
          twitchId,
          login: live.login,
          displayName: live.displayName,
          firstSeenAt: observedAt,
          profileImageUrl: null,
          profileUpdatedAt: null,
          ...portrait,
        });
        profile = await ctx.db.get("streamers", id);
      } else if (
        profile.login !== live.login ||
        profile.displayName !== live.displayName ||
        live.profileImageUrl !== undefined
      ) {
        await ctx.db.patch("streamers", profile._id, {
          login: live.login,
          displayName: live.displayName,
          ...portrait,
        });
      }
    }
    const oldSession = previous?.sessionId
      ? await ctx.db.get("sessions", previous.sessionId)
      : null;
    let sessionId = previous?.sessionId ?? null;
    let addedSeconds = 0,
      addedViewers = 0;
    const buckets = new Map<
      number,
      {
        durationSeconds: number;
        viewerSeconds: number;
        peakViewers: number;
        hours: number[];
      }
    >();
    const bucket = (day: number) => {
      let value = buckets.get(day);
      if (!value) {
        value = {
          durationSeconds: 0,
          viewerSeconds: 0,
          peakViewers: 0,
          hours: Array<number>(24).fill(0),
        };
        buckets.set(day, value);
      }
      return value;
    };
    let continued = false;
    if (oldSession && oldSession.endedAt === null) {
      const gap = observedAt - oldSession.lastSeenAt;
      continued =
        live?.twitchStreamId === oldSession.twitchStreamId && gap <= MAX_GAP;
      // Only observed intervals count. Long outages are unknown, never invented watch time.
      const end = gap <= MAX_GAP ? observedAt : oldSession.lastSeenAt;
      addedSeconds = (end - oldSession.lastSeenAt) / 1000;
      addedViewers = addedSeconds * oldSession.lastViewerCount;
      for (const part of splitHours(oldSession.lastSeenAt, end)) {
        const value = bucket(part.day);
        value.durationSeconds += part.seconds;
        value.viewerSeconds += part.seconds * oldSession.lastViewerCount;
        value.peakViewers = Math.max(
          value.peakViewers,
          oldSession.lastViewerCount,
        );
        value.hours[part.hour] += part.seconds;
      }
      await ctx.db.patch("sessions", oldSession._id, {
        endedAt: continued ? null : end,
        lastSeenAt: continued ? observedAt : oldSession.lastSeenAt,
        title: continued ? live!.title : oldSession.title,
        lastViewerCount: continued
          ? live!.viewerCount
          : oldSession.lastViewerCount,
        durationSeconds: oldSession.durationSeconds + addedSeconds,
        viewerSeconds: oldSession.viewerSeconds + addedViewers,
        peakViewers: Math.max(
          oldSession.peakViewers,
          continued ? live!.viewerCount : 0,
        ),
      });
      if (!continued) sessionId = null;
    }
    if (live) {
      if (!continued)
        sessionId = await ctx.db.insert("sessions", {
          twitchId,
          twitchStreamId: live.twitchStreamId,
          title: live.title,
          twitchStartedAt: live.twitchStartedAt,
          startedAt: observedAt,
          lastSeenAt: observedAt,
          endedAt: null,
          lastViewerCount: live.viewerCount,
          durationSeconds: 0,
          viewerSeconds: 0,
          peakViewers: live.viewerCount,
        });
      bucket(dayStart(observedAt)).peakViewers = Math.max(
        bucket(dayStart(observedAt)).peakViewers,
        live.viewerCount,
      );
    }
    for (const [day, delta] of buckets) {
      const old = await ctx.db
        .query("daily")
        .withIndex("by_twitchId_and_day", (q) =>
          q.eq("twitchId", twitchId).eq("day", day),
        )
        .unique();
      const value = {
        twitchId,
        day,
        durationSeconds: (old?.durationSeconds ?? 0) + delta.durationSeconds,
        viewerSeconds: (old?.viewerSeconds ?? 0) + delta.viewerSeconds,
        peakViewers: Math.max(old?.peakViewers ?? 0, delta.peakViewers),
        hours: delta.hours.map((seconds, i) => seconds + (old?.hours[i] ?? 0)),
      };
      const id = old ? old._id : await ctx.db.insert("daily", value);
      if (old) await ctx.db.replace("daily", id, value);
      await syncDaily(ctx, old, (await ctx.db.get("daily", id))!);
    }
    const next = {
      twitchId,
      isLive: live !== null,
      hasOpenSession: sessionId !== null,
      sessionId,
      lastObservedAt: observedAt,
      lastSeenAt: live ? observedAt : previous!.lastSeenAt,
      liveViewerCount: live?.viewerCount ?? null,
      liveStartedAt: live?.twitchStartedAt ?? null,
      thumbnailUrl: live?.thumbnailUrl ?? null,
      title: live?.title ?? null,
      durationSeconds: (previous?.durationSeconds ?? 0) + addedSeconds,
      viewerSeconds: (previous?.viewerSeconds ?? 0) + addedViewers,
      peakViewers: Math.max(previous?.peakViewers ?? 0, live?.viewerCount ?? 0),
    };
    const stateId = previous
      ? previous._id
      : await ctx.db.insert("streamerState", next);
    if (previous) await ctx.db.replace("streamerState", stateId, next);
    await refreshRankings(
      ctx,
      (await ctx.db.get("streamerState", stateId))!,
      observedAt,
    );
    await ctx.db.patch("collector", collector._id, {
      totalDurationSeconds: collector.totalDurationSeconds + addedSeconds,
      totalViewerSeconds: collector.totalViewerSeconds + addedViewers,
      streamerCount: collector.streamerCount + (previous ? 0 : 1),
      liveCount:
        collector.liveCount + (live ? 1 : 0) - (previous?.isLive ? 1 : 0),
    });
    return true;
  },
});
