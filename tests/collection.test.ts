import { createDeadlockClient } from "../apps/collector/src/deadlock-client";
import { describe, expect, test } from "bun:test";
import {
  collector,
  daily,
  eq,
  hourly,
  sessions,
  streamers,
} from "../packages/db/src/index";
import {
  acquireRun,
  applyObservation,
  renewRun,
} from "../packages/db/src/ingestion";
import type { Observation } from "../packages/db/src/ingestion";
import { getDetail, getRanking } from "../packages/db/src/queries";
import { parseFilters } from "../packages/db/src/types";
import { testDatabase } from "./d1";
import { saveEnrichment } from "../apps/collector/src/enrichment";
import { collect } from "../apps/collector/src/index";
import { TwitchClient } from "../apps/collector/src/twitch";
const at = Date.parse("2026-09-20T23:59:30+09:00");
const live: Observation = {
  twitchId: "123",
  twitchStreamId: "stream",
  login: "test",
  displayName: "テスト",
  title: "Deadlock",
  viewerCount: 10,
  startedAt: at - 3600000,
  thumbnailUrl: null,
};
async function setup() {
  const data = await testDatabase();
  await acquireRun(data.db, "run", at, at);
  return {
    ...data,
    read: () =>
      data.db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, live.twitchId))
        .get(),
  };
}
describe("Drizzle collection on SQLite", () => {
  test("starts at first observation, splits JST midnight and weights viewers", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    expect((await read())?.durationSeconds).toBe(0);
    await applyObservation(
      db,
      "run",
      (await read())!,
      { ...live, viewerCount: 20 },
      at + 60000,
    );
    await applyObservation(db, "run", (await read())!, null, at + 120000);
    const row = (await read())!;
    expect(row.durationSeconds).toBe(120);
    expect(row.viewerSeconds).toBe(1800);
    expect(row.averageViewers).toBe(15);
    expect(row.peakViewers).toBe(20);
    expect(row.isLive).toBe(false);
    const days = await db.select().from(daily).orderBy(daily.day);
    expect(days.map((d) => d.durationSeconds)).toEqual([30, 90]);
    expect(
      (await db.select().from(hourly)).reduce(
        (n, r) => n + r.durationSeconds,
        0,
      ),
    ).toBe(120);
    expect((await db.select().from(sessions))[0].endedAt).toBe(at + 120000);
  });
  test("duplicate or superseded observations cannot double-count", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    const old = (await read())!;
    await applyObservation(db, "run", old, live, at + 60000);
    await expect(
      applyObservation(db, "run", old, live, at + 60000),
    ).rejects.toThrow("superseded");
    expect((await read())?.durationSeconds).toBe(60);
    await db.update(collector).set({ runId: "replacement" });
    await expect(
      applyObservation(db, "run", (await read())!, live, at + 120000),
    ).rejects.toThrow("superseded");
    expect((await read())?.durationSeconds).toBe(60);
  });
  test("long gaps are not billed and create a separate session", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await applyObservation(db, "run", (await read())!, live, at + 600000);
    expect((await read())?.durationSeconds).toBe(0);
    const records = await db
      .select()
      .from(sessions)
      .orderBy(sessions.startedAt);
    expect(records.length).toBe(2);
    expect(records[0].endedAt).toBe(at);
  });
  test("stream restart closes old segment and 0 viewers is still LIVE", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await applyObservation(
      db,
      "run",
      (await read())!,
      { ...live, twitchStreamId: "new", viewerCount: 0 },
      at + 60000,
    );
    expect((await read())?.isLive).toBe(true);
    expect((await read())?.viewerSeconds).toBe(600);
    expect((await db.select().from(sessions)).length).toBe(2);
  });
  test("failed batch rolls back session, daily and lifetime changes", async () => {
    const { db, sqlite, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    sqlite.exec(
      "CREATE TRIGGER fail_write BEFORE UPDATE ON streamers BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    await expect(
      applyObservation(db, "run", (await read())!, live, at + 60000),
    ).rejects.toThrow();
    expect((await db.select().from(sessions))[0].durationSeconds).toBe(0);
    expect((await db.select().from(hourly)).length).toBe(0);
    expect((await read())?.durationSeconds).toBe(0);
  });
  test("Cron lease excludes overlap, duplicate schedules and old owners", async () => {
    const { db } = await setup();
    expect(
      await acquireRun(db, "other", at + 60000, at + 60000),
    ).toBeUndefined();
    expect(
      await acquireRun(db, "other", at + 180000, at + 180000),
    ).toBeDefined();
    await expect(renewRun(db, "run", at + 180000)).rejects.toThrow();
    expect(
      await acquireRun(db, "third", at + 180000, at + 400000),
    ).toBeUndefined();
  });
});
describe("public server queries", () => {
  test("LIVE then watch-time order is applied before paging/filtering", async () => {
    const { db } = await setup();
    await db
      .update(collector)
      .set({ lastCollectedAt: at, firstCollectedAt: at, state: "ready" });
    for (let i = 0; i < 65; i++)
      await db.insert(streamers).values({
        twitchId: String(1000 + i),
        displayName: String(i),
        firstSeenAt: at,
        isLive: i < 35,
        durationSeconds: 600,
        viewerSeconds: i * 60,
      });
    const first = await getRanking(db, parseFilters({}), at);
    const next = await getRanking(db, parseFilters({ page: 2 }), at);
    expect(first.rows[0].twitchId).toBe("1034");
    expect(first.rows.at(-1)?.twitchId).toBe("1005");
    expect(next.rows.slice(0, 5).every((r) => r.isLive)).toBe(true);
    expect(next.rows[5].twitchId).toBe("1064");
    const only = await getRanking(
      db,
      parseFilters({ live: true, page: 2 }),
      at,
    );
    expect(only.total).toBe(35);
    expect(only.rows.length).toBe(5);
    const stale = await getRanking(db, parseFilters({}), at + 240000);
    expect(stale.rows[0].twitchId).toBe("1064");
    expect(stale.rows.every((r) => !r.isLive)).toBe(true);
    expect(
      (await getRanking(db, parseFilters({ live: true }), at + 240000)).total,
    ).toBe(0);
  });
  test("every metric sorts on the server, missing ranks always last", async () => {
    const { db } = await setup();
    await db.insert(streamers).values([
      {
        twitchId: "1",
        firstSeenAt: at,
        durationSeconds: 100,
        viewerSeconds: 1000,
        peakViewers: 90,
        rankTier: 2,
        rankSubrank: 1,
        matchTimeSeconds: 400,
      },
      {
        twitchId: "2",
        firstSeenAt: at,
        durationSeconds: 200,
        viewerSeconds: 400,
        peakViewers: 20,
        rankTier: 0,
        rankSubrank: 0,
        matchTimeSeconds: 0,
      },
      {
        twitchId: "3",
        firstSeenAt: at,
        durationSeconds: 50,
        viewerSeconds: 900,
        peakViewers: 30,
        rankTier: 1,
        rankSubrank: 1,
      },
      { twitchId: "4", firstSeenAt: at },
      { twitchId: "5", steamAccountId: 123 },
    ]);
    for (const [sort, id] of [
      ["duration", "2"],
      ["viewers", "3"],
      ["peak", "1"],
      ["watched", "1"],
      ["matchTime", "1"],
      ["rank", "1"],
      ["rankAsc", "3"],
    ]) {
      const result = await getRanking(db, parseFilters({ sort }), at);
      expect(result.rows[0].twitchId).toBe(id);
      expect(result.total).toBe(4);
    }
    expect(
      (await getRanking(db, parseFilters({ sort: "rankAsc" }), at)).rows.map(
        (r) => r.twitchId,
      ),
    ).toEqual(["3", "1", "2", "4"]);
    expect(
      parseFilters({ sort: "DROP TABLE", page: "-1", live: "false" }),
    ).toEqual({ sort: "live", page: 1, live: false });
    expect((await getRanking(db, parseFilters({ page: 10000 }), at)).page).toBe(
      1,
    );
  });
  test("detail returns bounded history and deterministic 168-cell heatmap", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await applyObservation(db, "run", (await read())!, live, at + 60000);
    await db.update(collector).set({
      firstCollectedAt: at,
      lastCollectedAt: at + 60000,
      state: "ready",
    });
    const result = (await getDetail(db, "123", at + 60000))!;
    expect(result.data.heatmap.length).toBe(168);
    expect(result.data.summary.streamingDays).toBe(2);
    expect(result.data.heatmap.reduce((n, r) => n + r.durationSeconds, 0)).toBe(
      60,
    );
    expect(result.data.live?.viewerCount).toBe(10);
    expect(result.data.recentSessions[0].hoursWatched).toBe(600 / 3600);
    expect(await getDetail(db, "123' OR 1=1", at)).toBeNull();
    expect(await getDetail(db, "999", at)).toBeNull();
  });
});
describe("external API failure handling", () => {
  test("failed discovery preserves open sessions", async () => {
    const { db, binding, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await db
      .update(collector)
      .set({ runId: null, leaseUntil: 0, lastScheduledAt: 0 });
    const client = new TwitchClient(
      "id",
      "secret",
      async () => new Response("", { status: 503 }),
    );
    await expect(
      collect({ DB: binding }, Date.now(), client),
    ).rejects.toThrow();
    expect((await read())?.isLive).toBe(true);
    expect((await read())?.durationSeconds).toBe(0);
    expect((await db.select().from(collector).get())?.state).toBe("error");
  });
  test("transient enrichment errors retain each successful field; unlink fences stale data", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await db.update(streamers).set({
      steamAccountId: 55,
      rankTier: 4,
      rankSubrank: 2,
      matchTimeSeconds: 100,
    });
    const row = (await read())!;
    const error = {
      kind: "error" as const,
      error: "HTTP 429",
      retryAt: at + 7200000,
    };
    await saveEnrichment(
      db,
      "run",
      row,
      error,
      { kind: "ok", value: [] },
      { kind: "ok", value: 300 },
      at,
    );
    expect((await read())?.rankTier).toBe(4);
    expect((await read())?.matchTimeSeconds).toBe(300);
    expect((await read())?.enrichmentDueAt).toBe(at + 7200000);
    await db
      .update(streamers)
      .set({ steamAccountId: null, rankTier: null, rankSubrank: null });
    await saveEnrichment(
      db,
      "run",
      row,
      { kind: "ok", value: { tier: 8, subrank: 1 } },
      error,
      error,
      at + 1,
    );
    expect((await read())?.rankTier).toBeNull();
  });
  test("403/404 clear unavailable values; Retry-After is respected", async () => {
    const { db, read } = await setup();
    await applyObservation(db, "run", null, live, at);
    await db.update(streamers).set({
      steamAccountId: 55,
      rankTier: 4,
      rankSubrank: 2,
      matchTimeSeconds: 100,
    });
    await saveEnrichment(
      db,
      "run",
      (await read())!,
      { kind: "unavailable" },
      { kind: "unavailable" },
      { kind: "unavailable" },
      at,
    );
    expect((await read())?.rankTier).toBeNull();
    expect((await read())?.matchTimeSeconds).toBeNull();
    const now = Date.now();
    const result = await createDeadlockClient(
      undefined,
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "7200" } }),
    ).rank(55);
    expect(result.kind).toBe("error");
    if (result.kind === "error")
      expect(result.retryAt).toBeGreaterThanOrEqual(now + 7200000);
  });
});
