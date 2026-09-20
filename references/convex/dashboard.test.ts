/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import type { FunctionReturnType } from "convex/server";
import aggregate from "@convex-dev/aggregate/test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { DAY, dayStart } from "./time";

const modules = import.meta.glob("./**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  for (const name of ["duration", "watched", "activeDays"])
    aggregate.register(t, name);
  return t;
}
type Test = ReturnType<typeof setup>;
const initial = Date.parse("2026-09-18T05:00:00Z");
function live(viewerCount = 10, twitchStreamId = "stream-1") {
  return {
    twitchStreamId,
    login: "player",
    displayName: "プレイヤー",
    title: "Deadlock 日本語",
    viewerCount,
    twitchStartedAt: initial - 60_000,
  };
}
let serial = 0;
async function observe(
  t: Test,
  at: number,
  value: ReturnType<typeof live> | null,
  twitchId = "1",
) {
  vi.setSystemTime(at);
  const runId = `run-${++serial}`;
  await t.mutation(internal.collectionState.begin, { runId, configured: true });
  const args = { runId, twitchId, observedAt: at, live: value };
  await t.mutation(internal.ingestion.applyObservation, args);
  await t.mutation(internal.collectionState.finish, {
    runId,
    observedAt: at,
    success: true,
  });
  return args;
}
async function ranking(
  t: Test,
  period: "week" | "month" | "quarter" | "all" = "week",
  liveOnly = false,
) {
  return t.query(api.dashboard.ranking, {
    period,
    sort: "duration",
    liveOnly,
    paginationOpts: { numItems: 10, cursor: null },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(initial);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("time-weighted rollups and aggregates are atomic and duplicate observations cannot count twice", async () => {
  const t = setup();
  await observe(t, initial, live(10));
  const args = await observe(t, initial + 60_000, live(30));
  expect(await t.mutation(internal.ingestion.applyObservation, args)).toBe(
    false,
  );
  await observe(t, initial + 120_000, live(50));
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  expect(detail?.summary).toMatchObject({
    durationSeconds: 120,
    viewerSeconds: 2400,
    averageViewers: 20,
    peakViewers: 50,
    streamingDays: 1,
  });
  expect(detail?.recentSessions).toHaveLength(1);
  expect((await ranking(t)).page[0]).toMatchObject({
    durationSeconds: 120,
    averageViewers: 20,
    isLive: true,
  });
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    streamerCount: 1,
    liveCount: 1,
    totalDurationSeconds: 120,
    totalViewerSeconds: 2400,
  });
});

test("JST midnight splits exact seconds into both day and hour buckets", async () => {
  const t = setup();
  const midnight = Date.parse("2026-09-18T15:00:00Z");
  await observe(t, midnight - 30_000, live(12));
  await observe(t, midnight + 30_000, live(24));
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "week",
  });
  const days = detail!.calendar.filter((day) => day.durationSeconds > 0);
  expect(
    days.map((day) => [day.date, day.durationSeconds, day.viewerSeconds]),
  ).toEqual([
    ["2026-09-18", 30, 360],
    ["2026-09-19", 30, 360],
  ]);
  expect(detail?.summary.streamingDays).toBe(2);
  expect(
    detail?.heatmap.reduce((sum, cell) => sum + cell.durationSeconds, 0),
  ).toBe(60);
});

test("long outage closes at last observation and starts a fresh measured session without filling the gap", async () => {
  const t = setup();
  await observe(t, initial, live());
  await observe(t, initial + 60_000, live());
  await observe(t, initial + 600_000, live());
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  expect(detail?.summary.durationSeconds).toBe(60);
  expect(detail?.recentSessions).toHaveLength(2);
  expect(
    detail?.recentSessions.find((session) => session.endedAt !== null)?.endedAt,
  ).toBe(initial + 60_000);
});

test("normal offline transition accounts for the final observed interval and leaves no LIVE row", async () => {
  const t = setup();
  await observe(t, initial, live(7));
  await observe(t, initial + 60_000, null);
  expect((await ranking(t, "week", true)).page).toEqual([]);
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "week",
  });
  expect(detail?.summary).toMatchObject({
    durationSeconds: 60,
    viewerSeconds: 420,
    peakViewers: 7,
  });
  expect(detail?.recentSessions[0].endedAt).toBe(initial + 60_000);
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    liveCount: 0,
  });
});

test("LIVE expiration updates indexed filtering but keeps open sessions eligible for verification", async () => {
  const t = setup();
  await observe(t, initial, live());
  vi.setSystemTime(initial + 240_000);
  await t.mutation(internal.maintenance.expireLive, {});
  expect((await ranking(t, "week", true)).page).toEqual([]);
  const active = await t.query(internal.ingestion.activePage, {
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(active.page).toEqual(["1"]);
  await observe(t, initial + 300_000, live());
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  expect(detail?.recentSessions).toHaveLength(2);
  expect(detail?.summary.durationSeconds).toBe(0);
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    liveCount: 1,
  });
});

test("dormant streamers expire out of rolling windows while all-time Aggregate totals survive", async () => {
  const t = setup();
  await observe(t, initial, live(25));
  await observe(t, initial + 60_000, null);
  vi.setSystemTime(dayStart(initial) + 7 * DAY);
  await t.mutation(internal.maintenance.refreshPeriods, {});
  expect((await ranking(t, "week")).page).toEqual([]);
  expect((await ranking(t, "month")).page[0].durationSeconds).toBe(60);
  expect((await ranking(t, "all")).page[0].viewerSeconds).toBe(1500);
});

test("collector lease blocks overlap; an obsolete run cannot overwrite newer observations", async () => {
  const t = setup();
  const first = await t.mutation(internal.collectionState.begin, {
    runId: "first",
    configured: true,
  });
  expect(first).toBe(initial);
  expect(
    await t.mutation(internal.collectionState.begin, {
      runId: "overlap",
      configured: true,
    }),
  ).toBeNull();
  vi.setSystemTime(initial + 10 * 60_000);
  expect(
    await t.mutation(internal.collectionState.begin, {
      runId: "replacement",
      configured: true,
    }),
  ).not.toBeNull();
  expect(
    await t.mutation(internal.ingestion.applyObservation, {
      runId: "first",
      twitchId: "1",
      observedAt: initial,
      live: live(),
    }),
  ).toBe(false);
  expect((await ranking(t)).page).toEqual([]);
});

test("unset credentials give an honest empty setup state and unknown streamers return null", async () => {
  const t = setup();
  await t.mutation(internal.collectionState.begin, {
    runId: "not-configured",
    configured: false,
  });
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    configured: false,
    state: "unconfigured",
    lastCollectedAt: null,
    streamerCount: 0,
  });
  expect(
    await t.query(api.dashboard.detail, {
      twitchId: "missing",
      period: "week",
    }),
  ).toBeNull();
});

test("indexed ranking pages cover every streamer without duplicates and sort by weighted viewers", async () => {
  const t = setup();
  await observe(t, initial, live(10), "1");
  await observe(t, initial, live(50), "2");
  await observe(t, initial + 60_000, null, "1");
  await observe(t, initial + 60_000, null, "2");
  const first = await t.query(api.dashboard.ranking, {
    period: "week",
    sort: "viewers",
    liveOnly: false,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page[0].twitchId).toBe("2");
  expect(first.isDone).toBe(false);
  const second = await t.query(api.dashboard.ranking, {
    period: "week",
    sort: "viewers",
    liveOnly: false,
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  expect(second.page[0].twitchId).toBe("1");
  expect(second.isDone).toBe(true);
});

const twitchStream = (id: string, viewers = 20) => ({
  id: `stream-${id}`,
  user_id: id,
  user_login: `player${id}`,
  user_name: `Player ${id}`,
  game_id: "deadlock",
  language: "ja",
  title: "Deadlock",
  viewer_count: viewers,
  started_at: new Date(initial - 60_000).toISOString(),
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function collectorFetch(...responses: Response[]) {
  vi.stubEnv("TWITCH_CLIENT_ID", "test-client");
  vi.stubEnv("TWITCH_CLIENT_SECRET", "test-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(response({ access_token: "test-token" }))
    .mockResolvedValueOnce(
      response({ data: [{ id: "deadlock", name: "Deadlock" }] }),
    );
  for (const value of responses) fetch.mockResolvedValueOnce(value);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

test.each([
  ["malformed", "not-a-date"],
  ["future", new Date(initial + DAY).toISOString()],
])(
  "collector rejects an entire snapshot with a %s timestamp before persisting any streamer",
  async (_label, started_at) => {
    const t = setup();
    await observe(t, initial, live(10));
    vi.setSystemTime(initial + 60_000);
    const fetch = collectorFetch(
      response({
        data: [twitchStream("1"), { ...twitchStream("2"), started_at }],
      }),
    );
    await t.action(internal.collector.collect, {});
    const detail = await t.query(api.dashboard.detail, {
      twitchId: "1",
      period: "all",
    });
    expect(detail?.summary).toMatchObject({
      durationSeconds: 0,
      viewerSeconds: 0,
      peakViewers: 10,
    });
    expect(detail?.live?.viewerCount).toBe(10);
    expect(
      await t.query(api.dashboard.detail, { twitchId: "2", period: "all" }),
    ).toBeNull();
    expect(await t.query(api.dashboard.status, {})).toMatchObject({
      state: "error",
      lastCollectedAt: initial,
      streamerCount: 1,
      totalDurationSeconds: 0,
    });
    // Neither profile lookup nor a streamer write can precede complete validation.
    expect(fetch).toHaveBeenCalledTimes(3);
  },
);

test("collector preserves sessions and Aggregate totals when a later Twitch discovery page fails", async () => {
  const t = setup();
  await observe(t, initial, live(10));
  await observe(t, initial + 60_000, live(30));
  const before = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  vi.setSystemTime(initial + 120_000);
  collectorFetch(
    response({ data: [twitchStream("2")], pagination: { cursor: "next" } }),
    response({ error: "rate limited" }, 429),
  );
  await t.action(internal.collector.collect, {});
  const after = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  expect(after?.summary).toEqual(before?.summary);
  expect(after?.recentSessions).toEqual(before?.recentSessions);
  expect(after?.isLive).toBe(true);
  expect((await ranking(t, "all")).page.map((row) => row.twitchId)).toEqual([
    "1",
  ]);
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    state: "error",
    lastCollectedAt: initial + 60_000,
    totalViewerSeconds: 600,
  });
});

test("collector keeps sampling when optional portrait lookup fails", async () => {
  const t = setup();
  await observe(t, initial, live(10));
  vi.setSystemTime(initial + 60_000);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  collectorFetch(
    response({ data: [twitchStream("1", 40)] }),
    response({}, 503),
  );
  await t.action(internal.collector.collect, {});
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "all",
  });
  expect(detail?.summary).toMatchObject({
    durationSeconds: 60,
    viewerSeconds: 600,
    averageViewers: 10,
    peakViewers: 40,
  });
  expect(detail?.live?.viewerCount).toBe(40);
  expect(await t.query(api.dashboard.status, {})).toMatchObject({
    state: "healthy",
    lastCollectedAt: initial + 60_000,
  });
});

test.each([
  ["duration", ["1", "3", "2"], ["1", "2"]],
  ["viewers", ["2", "3", "1"], ["2", "1"]],
  ["watched", ["3", "2", "1"], ["2", "1"]],
  ["peak", ["2", "3", "1"], ["2", "1"]],
] as const)(
  "%s ranking pagination applies LIVE filtering before ordering and Aggregate updates remain accurate",
  async (sort, expectedAll, expectedLive) => {
    const t = setup();
    // Different durations and viewing rates give a distinct order for every metric.
    await observe(t, initial, live(10), "1");
    await observe(t, initial + 60_000, live(10), "1");
    await observe(t, initial + 120_000, live(10), "1");
    await observe(t, initial + 180_000, live(10), "1");
    await observe(t, initial + 120_000, live(100), "2");
    await observe(t, initial + 180_000, live(100), "2");
    await observe(t, initial + 60_000, live(70), "3");
    await observe(t, initial + 120_000, live(70), "3");
    await observe(t, initial + 180_000, null, "3");
    for (const [liveOnly, expected] of [
      [false, expectedAll],
      [true, expectedLive],
    ] as const) {
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page: FunctionReturnType<typeof api.dashboard.ranking> =
          await t.query(api.dashboard.ranking, {
            period: "week",
            sort,
            liveOnly,
            paginationOpts: { numItems: 1, cursor },
          });
        ids.push(...page.page.map((row) => row.twitchId));
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      expect(ids).toEqual(expected);
    }
    const totals = await t.query(api.dashboard.status, {});
    expect(totals).toMatchObject({
      totalDurationSeconds: 360,
      totalViewerSeconds: 16200,
      liveCount: 2,
      streamerCount: 3,
    });
    const summary = await t.query(api.dashboard.detail, {
      twitchId: "3",
      period: "all",
    });
    expect(summary?.summary).toMatchObject({
      durationSeconds: 120,
      viewerSeconds: 8400,
      averageViewers: 70,
      streamingDays: 1,
    });
  },
);

test.each(["week", "month", "quarter", "all"] as const)(
  "%s peak sorting uses the maximum rather than the average viewer count",
  async (period) => {
    const t = setup();
    await observe(t, initial, live(100), "1");
    await observe(t, initial + 60_000, live(1), "1");
    await observe(t, initial + 120_000, live(1), "1");
    await observe(t, initial, live(70), "2");
    await observe(t, initial + 120_000, live(70), "2");
    for (const liveOnly of [false, true]) {
      const options = {
        period,
        liveOnly,
        paginationOpts: { numItems: 10, cursor: null },
      };
      const peak = await t.query(api.dashboard.ranking, {
        ...options,
        sort: "peak",
      });
      const average = await t.query(api.dashboard.ranking, {
        ...options,
        sort: "viewers",
      });
      expect(peak.page.map((row) => row.twitchId)).toEqual(["1", "2"]);
      expect(average.page.map((row) => row.twitchId)).toEqual(["2", "1"]);
    }
  },
);

test("live thumbnail reaches detail and is cleared when the stream ends", async () => {
  const t = setup();
  const observation = {
    ...live(),
    thumbnailUrl:
      "https://static-cdn.jtvnw.net/previews-ttv/live_user_player-640x360.jpg",
  };
  await observe(t, initial, observation);
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "week",
  });
  expect(detail?.live?.thumbnailUrl).toBe(observation.thumbnailUrl);
  await observe(t, initial + 60_000, null);
  expect(
    (await t.query(api.dashboard.detail, { twitchId: "1", period: "week" }))
      ?.live,
  ).toBeNull();
  const state = await t.run(async (ctx) =>
    ctx.db
      .query("streamerState")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", "1"))
      .unique(),
  );
  expect(state?.thumbnailUrl).toBeNull();
});

test("linked rank appears in both public views and disappears on unlink", async () => {
  const t = setup();
  await observe(t, initial, live());
  await t.mutation(internal.steamLinks.link, {
    twitchId: "1",
    steamAccount: "12345",
  });
  const link = await t.run((ctx) => ctx.db.query("steamLinks").first());
  await t.mutation(internal.steamLinks.save, {
    id: link!._id,
    attemptedAt: initial,
    result: { tier: 9, subrank: 3 },
  });
  const detail = await t.query(api.dashboard.detail, {
    twitchId: "1",
    period: "week",
  });
  const list = await t.query(api.dashboard.ranking, {
    period: "week",
    sort: "duration",
    liveOnly: false,
    paginationOpts: { numItems: 30, cursor: null },
  });
  expect(detail?.deadlockRank).toMatchObject({
    accountId: 12345,
    tier: 9,
    subrank: 3,
  });
  expect(list.page[0].deadlockRank).toEqual(detail?.deadlockRank);
  await t.mutation(internal.steamLinks.unlink, { twitchId: "1" });
  expect(
    (await t.query(api.dashboard.detail, { twitchId: "1", period: "week" }))
      ?.deadlockRank,
  ).toBeNull();
});

test("daily refresh resumes after a lost continuation, is idempotent, and starts a new JST day", async () => {
  const t = setup();
  for (let i = 0; i < 9; i++) await observe(t, initial, live(), String(i));
  vi.setSystemTime(initial + DAY);
  await t.mutation(internal.maintenance.refreshPeriods, {});
  expect(
    await t.run((ctx) => ctx.db.query("periodRefresh").first()),
  ).toMatchObject({ processed: 8, complete: false });
  // Model a stopped continuation. The watchdog must recover from stored progress.
  await t.run(async (ctx) => {
    for (const job of await ctx.db.system
      .query("_scheduled_functions")
      .collect())
      if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
  });
  await t.mutation(internal.maintenance.refreshPeriods, {});
  const completed = await t.run((ctx) => ctx.db.query("periodRefresh").first());
  expect(completed).toMatchObject({
    processed: 9,
    complete: true,
    day: dayStart(initial + DAY),
  });
  const rows = await t.run((ctx) => ctx.db.query("rankings").collect());
  expect(rows).toHaveLength(36);
  expect(rows.every((row) => row.asOfDay === dayStart(initial + DAY))).toBe(
    true,
  );
  await t.mutation(internal.maintenance.refreshPeriods, {});
  expect(await t.run((ctx) => ctx.db.query("periodRefresh").first())).toEqual(
    completed,
  );
  vi.setSystemTime(initial + 2 * DAY);
  await t.mutation(internal.maintenance.refreshPeriods, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(
    await t.run((ctx) => ctx.db.query("periodRefresh").first()),
  ).toMatchObject({
    processed: 9,
    complete: true,
    day: dayStart(initial + 2 * DAY),
  });
});

test("stream ingestion and period regeneration retain cumulative match time ordering", async () => {
  const t = setup();
  await observe(t, initial, live());
  await t.run((ctx) =>
    ctx.db.insert("steamLinks", {
      twitchId: "1",
      accountId: 12345,
      tier: null,
      subrank: null,
      updatedAt: null,
      unavailable: false,
      nextRefreshAt: 0,
      matchTimeSeconds: 5400,
    }),
  );
  await observe(t, initial + 60_000, live());
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query("rankings").collect()).map(
        (row) => row.matchTimeScore,
      ),
    ),
  ).toEqual([5400, 5400, 5400, 5400]);
  await observe(t, initial + DAY, live());
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query("rankings").collect()).every(
        (row) => row.matchTimeScore === 5400,
      ),
    ),
  ).toBe(true);
});

test.each(["week", "month", "quarter", "all"] as const)(
  "%s default ordering puts live streamers first across pages, then sorts by hours watched",
  async (period) => {
    const t = setup();
    for (const [id, seconds, isLive, viewers] of [
      ["offline-long", 180, false, 10],
      ["live-short", 60, true, 30],
      ["offline-short", 120, false, 40],
      ["live-long", 120, true, 10],
    ] as const) {
      await observe(t, initial, live(viewers), id);
      await observe(t, initial + seconds * 1000, isLive ? live(viewers) : null, id);
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 4; i++) {
      const result: FunctionReturnType<typeof api.dashboard.ranking> =
        await t.query(api.dashboard.ranking, {
          period,
          sort: "live",
          liveOnly: false,
          paginationOpts: { numItems: 1, cursor },
        });
      ids.push(...result.page.map((row) => row.twitchId));
      cursor = result.continueCursor;
      if (result.isDone) break;
    }
    expect(ids).toEqual([
      "live-short",
      "live-long",
      "offline-short",
      "offline-long",
    ]);
    const filtered = await t.query(api.dashboard.ranking, {
      period,
      sort: "live",
      liveOnly: true,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(filtered.page.map((row) => row.twitchId)).toEqual([
      "live-short",
      "live-long",
    ]);
    const duration = await ranking(t, period);
    expect(duration.page[0].twitchId).toBe("offline-long");
  },
);
