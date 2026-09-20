import { expect, test } from "bun:test";
import {
  availablePeriods,
  periodStart,
  resolvePeriod,
} from "../packages/db/src/periods";
import { DAY, dayStart } from "../packages/db/src/time";
import { parseFilters } from "../packages/db/src/types";
import { getRanking, getDetail } from "../packages/db/src/queries";
import { collector, daily, streamers } from "../packages/db/src/index";
import { testDatabase } from "./d1";
const start = Date.parse("2026-09-21T08:01:00+09:00");
test("period availability follows measurement reset and successful collection, at exact thresholds", () => {
  expect(availablePeriods(start, null)).toEqual(["all"]);
  expect(availablePeriods(start, start + 7 * DAY - 1)).toEqual(["all"]);
  expect(availablePeriods(start, start + 7 * DAY)).toEqual(["week", "all"]);
  expect(availablePeriods(start, start + 30 * DAY)).toEqual([
    "week",
    "month",
    "all",
  ]);
  expect(availablePeriods(start, start + 90 * DAY)).toEqual([
    "week",
    "month",
    "quarter",
    "all",
  ]);
  expect(resolvePeriod("quarter", start, start + 8 * DAY)).toBe("all");
  expect(resolvePeriod("invalid", start, start + 100 * DAY)).toBe("all");
  expect(periodStart("week", start)).toBe(dayStart(start) - 6 * DAY);
});
test("period rankings aggregate before paging, weight averages, keep inactive and lifetime game data", async () => {
  const { db, sqlite } = await testDatabase();
  try {
    const at = start + 100 * DAY;
    await db
      .insert(collector)
      .values({
        id: 1,
        measurementStartedAt: start,
        lastCollectedAt: at,
        state: "ready",
      });
    for (let i = 1; i <= 32; i++) {
      await db
        .insert(streamers)
        .values({
          twitchId: String(i),
          firstSeenAt: start,
          lastObservedAt: at,
          durationSeconds: 100000,
          viewerSeconds: 100000 * i,
          peakViewers: 1000,
          steamAccountId: i,
          matchTimeSeconds: 999,
          isLive: i === 1,
        });
      if (i < 32)
        await db.insert(daily).values([
          {
            twitchId: String(i),
            day: dayStart(at) - 7 * DAY,
            durationSeconds: 10000,
            viewerSeconds: 9999999,
            peakViewers: 1000,
          },
          {
            twitchId: String(i),
            day: dayStart(at) - 6 * DAY,
            durationSeconds: 60,
            viewerSeconds: 60 * i,
            peakViewers: i,
          },
          {
            twitchId: String(i),
            day: dayStart(at),
            durationSeconds: 120,
            viewerSeconds: 240 * i,
            peakViewers: 2 * i,
          },
        ]);
    }
    const week = await getRanking(
      db,
      parseFilters({ period: "week", sort: "watched" }),
      at,
    );
    expect(week.rows[0].twitchId).toBe("31");
    expect(week.rows[0].averageViewers).toBe((300 * 31) / 180);
    expect(week.rows[0].peakViewers).toBe(62);
    const next = await getRanking(
      db,
      parseFilters({ period: "week", sort: "watched", page: 2 }),
      at,
    );
    expect(next.rows.map((r) => r.twitchId)).toEqual(["1", "32"]);
    expect(next.rows[1].hoursStreamed).toBe(0);
    expect(next.rows[1].deadlockActivity?.matchTimeSeconds).toBe(999);
    const live = await getRanking(
      db,
      parseFilters({ period: "week", live: true }),
      at,
    );
    expect(live.rows.map((r) => r.twitchId)).toEqual(["1"]);
    const all = await getRanking(
      db,
      parseFilters({ period: "all", sort: "watched" }),
      at,
    );
    expect(all.rows[0].twitchId).toBe("32");
    for (const period of ["week", "month", "quarter", "all"] as const) {
      const detail = (await getDetail(db, "31", at, period))!.data;
      const board = await getRanking(
        db,
        parseFilters({ period, sort: "watched" }),
        at,
      );
      const row = board.rows.find((r) => r.twitchId === "31")!;
      expect(detail.summary.hoursWatched).toBe(row.hoursWatched);
      expect(detail.summary.streamingDays).toBe(period === "week" ? 2 : 3);
      expect(detail.deadlockActivity?.matchTimeSeconds).toBe(999);
      expect(detail.heatmapDays).toBe(90);
    }
    const empty = (await getDetail(db, "32", at, "week"))!.data;
    expect(empty.summary).toEqual({
      hoursStreamed: 0,
      hoursWatched: 0,
      averageViewers: 0,
      peakViewers: 0,
      streamingDays: 0,
    });
    await db.update(collector).set({ measurementStartedAt: at });
    expect(
      (await getRanking(db, parseFilters({ period: "week" }), at)).filters
        .period,
    ).toBe("all");
    expect((await getDetail(db, "31", at, "week"))!.data.period).toBe("all");
  } finally {
    sqlite.close();
  }
});
