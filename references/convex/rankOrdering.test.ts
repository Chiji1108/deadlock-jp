/// <reference types="vite/client" />
import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { rankOrder, matchTimeOrder } from "./rankOrdering";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.useRealTimers());
test("Initiate 1 through Eternus 6 order by tier then subrank, unknowns last", () => {
  expect(rankOrder({ tier: 1, subrank: 1 })).toEqual({
    rankScore: 11,
    rankReverse: 189,
  });
  expect(rankOrder({ tier: 11, subrank: 6 })).toEqual({
    rankScore: 116,
    rankReverse: 84,
  });
  expect(rankOrder({ tier: 0, subrank: 0 })).toEqual({
    rankScore: 1,
    rankReverse: 1,
  });
  for (const rank of [
    null,
    { tier: 0, subrank: 0, unavailable: true },
    { tier: 0, subrank: 1 },
    { tier: null, subrank: null },
    { tier: 11, subrank: 6, unavailable: true },
  ])
    expect(rankOrder(rank)).toEqual({ rankScore: 0, rankReverse: 0 });
});
test("global rank pagination and LIVE filtering stay correct after backfill, refresh and unlink", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const linkIds = await t.run(async (ctx) => {
    const ids = [];
    const ranks = [
      { tier: 1, subrank: 1 },
      { tier: 11, subrank: 6 },
      { tier: 11, subrank: 5 },
      { tier: 0, subrank: 0 },
      null,
    ];
    for (let i = 0; i < ranks.length; i++) {
      const twitchId = String(i);
      await ctx.db.insert("streamers", {
        twitchId,
        login: twitchId,
        displayName: twitchId,
        profileImageUrl: null,
        profileUpdatedAt: null,
        firstSeenAt: 1,
      });
      await ctx.db.insert("rankings", {
        twitchId,
        period: "week",
        asOfDay: 1,
        isLive: i !== 1,
        durationSeconds: 100,
        viewerSeconds: 100,
        peakViewers: 1,
        averageViewers: 1,
        streamingDays: 1,
      });
      if (ranks[i])
        ids.push(
          await ctx.db.insert("steamLinks", {
            twitchId,
            accountId: i + 1,
            ...ranks[i]!,
            updatedAt: null,
            unavailable: false,
            nextRefreshAt: 0,
          }),
        );
    }
    return ids;
  });
  await t.run((ctx) =>
    ctx.db.insert("migrations", {
      name: "rank-order-v1",
      phase: "ready",
      cursor: null,
      checked: 5,
      repaired: 0,
      updatedAt: 1,
    }),
  );
  expect((await t.query(api.dashboard.status, {})).rankOrderingReady).toBe(
    false,
  );
  await t.mutation(internal.rankOrdering.backfill, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.query(api.dashboard.status, {})).rankOrderingReady).toBe(
    true,
  );
  async function read(sort: "rank" | "rankAsc", liveOnly = false) {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: FunctionReturnType<typeof api.dashboard.ranking> =
        await t.query(api.dashboard.ranking, {
          period: "week",
          sort,
          liveOnly,
          paginationOpts: { numItems: 1, cursor },
        });
      ids.push(...result.page.map((r) => r.twitchId));
      if (result.isDone) return ids;
      cursor = result.continueCursor;
    }
  }
  expect(await read("rank")).toEqual(["1", "2", "0", "3", "4"]);
  expect(await read("rankAsc")).toEqual(["0", "2", "1", "3", "4"]);
  expect(await read("rank", true)).toEqual(["2", "0", "3", "4"]);
  expect(await read("rankAsc", true)).toEqual(["0", "2", "3", "4"]);
  await t.mutation(internal.steamLinks.save, {
    id: linkIds[0],
    attemptedAt: 10,
    result: { tier: 11, subrank: 6 },
  });
  expect((await read("rank", true))[0]).toBe("0");
  await t.mutation(internal.steamLinks.unlink, { twitchId: "0" });
  expect((await read("rankAsc"))[0]).toBe("2");
  await t.mutation(internal.steamLinks.save, {
    id: linkIds[2],
    attemptedAt: 11,
    result: null,
  });
  expect((await read("rankAsc"))[0]).toBe("1");
});

test("migration resumes across batches, verifies every period, and gates mixed legacy rows", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ids = [];
    for (let i = 0; i < 60; i++) {
      const twitchId = String(i);
      await ctx.db.insert("steamLinks", {
        twitchId,
        accountId: i + 1,
        tier: 11,
        subrank: 6,
        updatedAt: 1,
        unavailable: false,
        nextRefreshAt: 0,
      });
      for (const period of ["week", "month", "quarter", "all"] as const)
        ids.push(
          await ctx.db.insert("rankings", {
            twitchId,
            period,
            asOfDay: 1,
            isLive: i % 2 === 0,
            durationSeconds: 1,
            viewerSeconds: 1,
            peakViewers: 1,
            averageViewers: 1,
            ...(i % 2 ? { rankScore: 11, rankReverse: 189 } : {}),
          }),
        );
    }
    return ids;
  });
  const args = {
    period: "week" as const,
    sort: "rank" as const,
    liveOnly: false,
    paginationOpts: { cursor: null, numItems: 100 },
  };
  expect((await t.query(api.dashboard.ranking, args)).page).toHaveLength(0);
  await t.mutation(internal.rankOrdering.backfill, {});
  expect(await t.query(internal.rankOrdering.status, {})).toMatchObject({
    phase: "backfill",
    repaired: 50,
  });
  for (let i = 0; i < 4; i++)
    await t.mutation(internal.rankOrdering.backfill, {});
  expect(await t.query(internal.rankOrdering.status, {})).toMatchObject({
    phase: "verify",
  });
  // Corruption between repair and verification must prevent publication.
  await t.run((ctx) => ctx.db.patch("rankings", ids[0], { rankScore: 0 }));
  await t.mutation(internal.rankOrdering.backfill, {});
  expect(await t.query(internal.rankOrdering.status, {})).toMatchObject({
    phase: "backfill",
  });
  for (let i = 0; i < 10; i++)
    await t.mutation(internal.rankOrdering.backfill, {});
  expect(await t.query(internal.rankOrdering.status, {})).toMatchObject({
    phase: "ready",
    checked: 240,
  });
  for (const period of ["week", "month", "quarter", "all"] as const)
    for (const sort of ["rank", "rankAsc", "matchTime"] as const)
      for (const liveOnly of [true, false])
        expect(
          (
            await t.query(api.dashboard.ranking, {
              ...args,
              period,
              sort,
              liveOnly,
            })
          ).page,
        ).toHaveLength(liveOnly ? 30 : 60);
  const before = await t.query(internal.rankOrdering.status, {});
  await t.mutation(internal.rankOrdering.backfill, {});
  expect(await t.query(internal.rankOrdering.status, {})).toEqual(before);
});

test("known zero match time sorts above missing or invalid time", () => {
  expect(matchTimeOrder(0)).toEqual({ matchTimeScore: 0 });
  expect(matchTimeOrder(3600)).toEqual({ matchTimeScore: 3600 });
  for (const value of [null, undefined, -1, NaN, Infinity])
    expect(matchTimeOrder(value)).toEqual({ matchTimeScore: -1 });
});

test("match time is globally paginated in every period, with LIVE filtering and atomic refresh/relink/unlink", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const linkIds = await t.run(async (ctx) => {
    const ids = [];
    const times = [7200, 36000, 0, null];
    for (let i = 0; i < 5; i++) {
      const twitchId = String(i);
      await ctx.db.insert("streamers", {
        twitchId,
        login: twitchId,
        displayName: twitchId,
        profileImageUrl: null,
        profileUpdatedAt: null,
        firstSeenAt: 1,
      });
      for (const period of ["week", "month", "quarter", "all"] as const)
        await ctx.db.insert("rankings", {
          twitchId,
          period,
          asOfDay: 1,
          isLive: i !== 1,
          durationSeconds: 100,
          viewerSeconds: 100,
          peakViewers: 1,
          averageViewers: 1,
        });
      if (i < 4)
        ids.push(
          await ctx.db.insert("steamLinks", {
            twitchId,
            accountId: i + 1,
            tier: 1,
            subrank: 1,
            updatedAt: null,
            unavailable: false,
            nextRefreshAt: 0,
            matchTimeSeconds: times[i],
          }),
        );
    }
    return ids;
  });
  const args = {
    period: "all" as const,
    sort: "matchTime" as const,
    liveOnly: false,
    paginationOpts: { numItems: 1, cursor: null },
  };
  expect((await t.query(api.dashboard.ranking, args)).page).toHaveLength(0);
  await t.mutation(internal.rankOrdering.backfill, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  async function read(
    period: "week" | "month" | "quarter" | "all" = "all",
    liveOnly = false,
  ) {
    const rows: FunctionReturnType<typeof api.dashboard.ranking>["page"] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: FunctionReturnType<typeof api.dashboard.ranking> =
        await t.query(api.dashboard.ranking, {
          ...args,
          period,
          liveOnly,
          paginationOpts: { numItems: 1, cursor },
        });
      rows.push(...result.page);
      if (result.isDone) return rows;
      cursor = result.continueCursor;
    }
  }
  for (const period of ["week", "month", "quarter", "all"] as const) {
    const rows = await read(period);
    expect(rows.slice(0, 3).map((r) => r.twitchId)).toEqual(["1", "0", "2"]);
    expect(new Set(rows.slice(3).map((r) => r.twitchId))).toEqual(
      new Set(["3", "4"]),
    );
    expect(
      (await read(period, true)).slice(0, 2).map((r) => r.twitchId),
    ).toEqual(["0", "2"]);
  }
  await t.mutation(internal.playerActivity.save, {
    id: linkIds[0],
    attemptedAt: 100,
    history: { kind: "ok", matches: [] },
    time: { kind: "ok", seconds: 72000 },
  });
  await t.mutation(internal.steamLinks.save, {
    id: linkIds[0],
    attemptedAt: 100,
    result: { tier: 9, subrank: 1 },
  });
  for (const period of ["week", "month", "quarter", "all"] as const) {
    const first = (await read(period))[0];
    expect(first.twitchId).toBe("0");
    expect(first.deadlockActivity?.matchTimeSeconds).toBe(72000);
  }
  await t.mutation(internal.playerActivity.save, {
    id: linkIds[0],
    attemptedAt: 101,
    history: { kind: "ok", matches: [] },
    time: { kind: "error", error: "http_429", retryAfterMs: 1000 },
  });
  expect((await read())[0].twitchId).toBe("0");
  await t.mutation(internal.steamLinks.link, {
    twitchId: "0",
    steamAccount: "99",
  });
  await t.mutation(internal.playerActivity.save, {
    id: linkIds[0],
    attemptedAt: 102,
    history: { kind: "ok", matches: [] },
    time: { kind: "ok", seconds: 999999 },
  });
  expect((await read()).slice(0, 2).map((r) => r.twitchId)).toEqual(["1", "2"]);
  await t.mutation(internal.playerActivity.save, {
    id: linkIds[1],
    attemptedAt: 103,
    history: { kind: "ok", matches: [] },
    time: { kind: "unavailable" },
  });
  expect((await read())[0].twitchId).toBe("2");
  await t.mutation(internal.steamLinks.unlink, { twitchId: "2" });
  expect(
    (await read()).every((r) => r.deadlockActivity?.matchTimeSeconds == null),
  ).toBe(true);
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query("rankings").collect()).every(
        (r) => r.matchTimeScore === -1,
      ),
    ),
  ).toBe(true);
});
