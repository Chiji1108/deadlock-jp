/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  parseHeroes,
  parseHistory,
  parseMatchTime,
} from "./playerActivityModel";

const modules = import.meta.glob("./**/*.ts");
const accountId = 12345;
const heroes = [{ id: 1, name: "Infernus", image: null }];
const raw = (matchId = 1, overrides = {}) => ({
  account_id: accountId,
  match_id: matchId,
  start_time: matchId * 100,
  hero_id: 1,
  game_mode: 1,
  match_mode: 4,
  match_duration_s: 1800,
  player_match_outcome: 1,
  player_team: 0,
  match_result: 0,
  ...overrides,
});
const goodHistory = {
  kind: "ok" as const,
  matches: parseHistory([raw()], accountId, heroes),
};
const goodTime = { kind: "ok" as const, seconds: 7200 };
const error = {
  kind: "error" as const,
  error: "http_429",
  retryAfterMs: 7_200_000,
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const id = await t.run(async (ctx) => {
    await ctx.db.insert("streamers", {
      twitchId: "a",
      login: "a",
      displayName: "A",
      profileImageUrl: null,
      profileUpdatedAt: null,
      firstSeenAt: 1,
    });
    return ctx.db.insert("steamLinks", {
      twitchId: "a",
      accountId,
      tier: null,
      subrank: null,
      updatedAt: null,
      unavailable: false,
      nextRefreshAt: 0,
    });
  });
  return { t, id };
}

test("history filters game modes before selecting 20 unique games in descending time order", () => {
  const input = Array.from({ length: 25 }, (_, i) => raw(i + 1));
  input.push(
    raw(25),
    raw(30, { match_mode: 2 }),
    raw(31, { game_mode: 4 }),
    raw(32, { match_duration_s: 0 }),
  );
  const matches = parseHistory(input, accountId, heroes);
  expect(matches).toHaveLength(20);
  expect(matches[0]).toMatchObject({
    matchId: 25,
    startedAt: 2_500_000,
    heroName: "Infernus",
    outcome: "win",
  });
  expect(matches.at(-1)?.matchId).toBe(6);
  expect(
    parseHistory([raw(1, { match_mode: 1 })], accountId, heroes),
  ).toHaveLength(1);
});

test("winner team is a fallback only for legacy outcomes; unscored matches stay neutral", () => {
  const results = [
    { player_match_outcome: 2 },
    { player_match_outcome: 0, player_team: 1, match_result: 1 },
    { player_match_outcome: 0, player_team: 1, match_result: 0 },
    { player_match_outcome: 5 },
    { player_match_outcome: 0, match_result: 2 },
  ].map(
    (overrides) =>
      parseHistory([raw(1, overrides)], accountId, heroes)[0].outcome,
  );
  expect(results).toEqual(["loss", "win", "loss", "unknown", "unknown"]);
  expect(
    parseHistory([raw(1, { hero_id: 999 })], accountId, heroes)[0],
  ).toMatchObject({ heroName: "Hero 999", heroImage: null });
});

test("invalid histories never masquerade as empty success", () => {
  for (const value of [
    {},
    [raw(1, { account_id: 9 })],
    [raw(1, { start_time: "today" })],
    [raw(1, { hero_id: -1 })],
  ])
    expect(() => parseHistory(value, accountId, heroes)).toThrow();
  expect(parseHistory([], accountId, heroes)).toEqual([]);
});

test("cumulative time sums heroes once, rejects wrong accounts and represents absent coverage as null", () => {
  const row = { account_id: accountId, hero_id: 1, time_played: 3600 };
  expect(
    parseMatchTime([row, { ...row, hero_id: 2, time_played: 1800 }], accountId),
  ).toBe(5400);
  expect(parseMatchTime([], accountId)).toBeNull();
  for (const input of [
    [row, row],
    [{ ...row, account_id: 8 }],
    [{ ...row, time_played: -1 }],
    [{ ...row, time_played: "3600" }],
  ])
    expect(() => parseMatchTime(input, accountId)).toThrow();
});

test("hero image URLs are restricted to the asset host", () => {
  expect(
    parseHeroes([
      {
        id: 1,
        name: "Infernus",
        images: { icon_image_small_webp: "https://evil.example/a.webp" },
      },
    ])[0].image,
  ).toBeNull();
  expect(
    parseHeroes([
      {
        id: 1,
        name: "Infernus",
        images: {
          icon_image_small_webp:
            "https://assets-bucket.deadlock-api.com/a.webp",
        },
      },
    ])[0].image,
  ).toContain("assets-bucket.deadlock-api.com");
});

test("refresh initializes existing links, bounds batches and claims each link only once", async () => {
  const { t } = await setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 6; i++)
      await ctx.db.insert("steamLinks", {
        twitchId: String(i),
        accountId: i + 1,
        tier: null,
        subrank: null,
        updatedAt: null,
        unavailable: false,
        nextRefreshAt: 0,
      });
  });
  await t.mutation(internal.playerActivity.refreshDue, {});
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(5);
  await t.mutation(internal.playerActivity.refreshDue, {});
  await t.mutation(internal.playerActivity.refreshDue, {});
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(7);
});

test("partial failures preserve each last success, respect retry-after, and ignore older responses", async () => {
  const { t, id } = await setup();
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 100,
    history: goodHistory,
    time: goodTime,
  });
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 200,
    history: error,
    time: { kind: "ok", seconds: 9000 },
  });
  expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
    recentMatches: goodHistory.matches,
    historyUpdatedAt: 100,
    matchTimeSeconds: 9000,
    matchTimeUpdatedAt: 200,
    nextActivityRefreshAt: 7_200_200,
    activityFailureCount: 1,
  });
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 150,
    history: { kind: "unavailable" },
    time: { kind: "unavailable" },
  });
  expect(
    (await t.query(internal.steamLinks.get, { id }))?.matchTimeSeconds,
  ).toBe(9000);
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 300,
    history: { kind: "unavailable" },
    time: { kind: "unavailable" },
  });
  expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
    recentMatches: [],
    matchTimeSeconds: null,
    activityFailureCount: 0,
  });
});

test("relink and unlink invalidate activity and all in-flight responses", async () => {
  const { t, id } = await setup();
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 100,
    history: goodHistory,
    time: goodTime,
  });
  await t.mutation(internal.steamLinks.link, {
    twitchId: "a",
    steamAccount: "67890",
  });
  await t.mutation(internal.playerActivity.save, {
    id,
    attemptedAt: 200,
    history: goodHistory,
    time: goodTime,
  });
  const next = await t.run((ctx) => ctx.db.query("steamLinks").first());
  expect(next?.accountId).toBe(67890);
  expect(next?.recentMatches).toBeUndefined();
  await t.mutation(internal.steamLinks.unlink, { twitchId: "a" });
  await t.mutation(internal.playerActivity.save, {
    id: next!._id,
    attemptedAt: 300,
    history: goodHistory,
    time: goodTime,
  });
  expect(await t.query(internal.steamLinks.get, { id: next!._id })).toBeNull();
});

test("action fetches scoped history and time, reuses cached heroes, exposes only public snapshot", async () => {
  const { t, id } = await setup();
  await t.mutation(internal.playerActivity.saveAssets, {
    heroes,
    updatedAt: Date.now(),
  });
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("match-history")
            ? [raw()]
            : [{ account_id: accountId, hero_id: 1, time_played: 7200 }],
        ),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await t.action(internal.playerActivity.refresh, { id });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
    `https://api.deadlock-api.com/v1/players/hero-stats?account_ids=${accountId}&game_mode=normal&match_mode=ranked,unranked`,
  );
  expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
    recentMatches: goodHistory.matches,
    matchTimeSeconds: 7200,
  });
  await t.run((ctx) =>
    ctx.db.insert("rankings", {
      twitchId: "a",
      period: "all",
      asOfDay: 0,
      isLive: false,
      durationSeconds: 0,
      viewerSeconds: 0,
      peakViewers: 0,
      averageViewers: 0,
    }),
  );
  const page = await t.query(api.dashboard.ranking, {
    period: "all",
    sort: "duration",
    liveOnly: false,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page[0].deadlockActivity).toMatchObject({
    recentMatches: goodHistory.matches,
    matchTimeSeconds: 7200,
    status: "ready",
  });
  expect(page.page[0].deadlockActivity).not.toHaveProperty("activityLastError");
});

test.each([429, 500, "invalid", "network"] as const)(
  "action failure %s retains cached activity",
  async (failure) => {
    const { t, id } = await setup();
    await t.mutation(internal.playerActivity.saveAssets, {
      heroes,
      updatedAt: Date.now(),
    });
    await t.mutation(internal.playerActivity.save, {
      id,
      attemptedAt: 100,
      history: goodHistory,
      time: goodTime,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failure === "network") throw new Error("offline");
        if (failure === "invalid") return new Response("{}");
        return new Response("[]", {
          status: failure,
          headers: { "Retry-After": "7200" },
        });
      }),
    );
    await t.action(internal.playerActivity.refresh, { id });
    expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
      recentMatches: goodHistory.matches,
      matchTimeSeconds: 7200,
      historyUpdatedAt: 100,
      activityFailureCount: 1,
    });
  },
);
