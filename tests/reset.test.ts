import { expect, test } from "bun:test";
import { testDatabase } from "./d1";
import {
  collector,
  streamers,
  sessions,
  daily,
  hourly,
  cache,
  eq,
} from "../packages/db/src/index";
import { acquireRun, applyObservation } from "../packages/db/src/ingestion";
import { resetMeasurements } from "../packages/db/src/reset";
import { ORIGINAL_MEASUREMENT_START } from "../packages/db/src/time";
import { getRanking, getStatus } from "../packages/db/src/queries";
import { parseFilters } from "../packages/db/src/types";
import { saveEnrichment } from "../apps/collector/src/enrichment";

const at = ORIGINAL_MEASUREMENT_START + 600_000;
const live = {
  twitchId: "1",
  twitchStreamId: "live",
  login: "one",
  displayName: "One",
  title: "title",
  viewerCount: 10,
  startedAt: at - 3600000,
  thumbnailUrl: null,
};
async function setup() {
  const database = await testDatabase();
  const { db } = database;
  await db.insert(streamers).values([
    {
      twitchId: "1",
      steamAccountId: 123,
      rankTier: 5,
      rankSubrank: 2,
      matchTimeSeconds: 300,
      enrichmentFailures: 2,
      enrichmentError: "failed",
    },
    { twitchId: "2", steamAccountId: 456 },
    { twitchId: "3", firstSeenAt: at, durationSeconds: 10, viewerSeconds: 20 },
  ]);
  await db
    .insert(cache)
    .values({ key: "heroes", value: "[]", expiresAt: at + 86400000 });
  await acquireRun(db, "old", at, at);
  const read = () =>
    db.select().from(streamers).where(eq(streamers.twitchId, "1")).get();
  await applyObservation(db, "old", (await read())!, live, at, "portrait");
  await applyObservation(db, "old", (await read())!, live, at + 60000);
  return { ...database, read };
}

test("reset preserves only Steam associations, removes history and starts a fresh generation", async () => {
  const { db, sqlite, read } = await setup();
  try {
    const old = (await read())!;
    const resetAt = at + 120000;
    expect(
      await resetMeasurements(db, ORIGINAL_MEASUREMENT_START, resetAt),
    ).toEqual({ measurementStartedAt: resetAt });
    const rows = await db.select().from(streamers);
    expect(rows.map((r) => [r.twitchId, r.steamAccountId])).toEqual([
      ["1", 123],
      ["2", 456],
    ]);
    // Both the previously observed and import-only identity now have identical defaults.
    const { twitchId: a, steamAccountId: b, ...defaults } = rows[1];
    expect(rows[0]).toEqual({
      ...defaults,
      twitchId: "1",
      steamAccountId: 123,
    });
    expect(rows[0].firstSeenAt).toBeNull();
    expect(rows[0].durationSeconds).toBe(0);
    for (const table of [sessions, daily, hourly, cache])
      expect(await db.select().from(table)).toHaveLength(0);
    expect((await getRanking(db, parseFilters({}), resetAt)).total).toBe(0);
    expect(await getStatus(db, resetAt)).toMatchObject({
      measurementStartedAt: resetAt,
      firstCollectedAt: null,
      lastCollectedAt: null,
      fresh: false,
    });
    // No stale observation, new identity or enrichment can be written back.
    await expect(
      applyObservation(db, "old", old, live, resetAt + 1),
    ).rejects.toThrow("superseded");
    await expect(
      applyObservation(
        db,
        "old",
        null,
        { ...live, twitchId: "99" },
        resetAt + 1,
      ),
    ).rejects.toThrow("superseded");
    const rank = { kind: "ok" as const, value: { tier: 9, subrank: 3 } };
    await saveEnrichment(
      db,
      "old",
      old,
      rank,
      { kind: "ok", value: [] },
      { kind: "ok", value: 900 },
      resetAt + 1,
    );
    expect((await read())!.rankTier).toBeNull();
    expect(await db.select().from(streamers)).toHaveLength(2);
    expect(
      await acquireRun(db, "delayed", resetAt - 1, resetAt + 1),
    ).toBeUndefined();
    expect(
      await acquireRun(db, "new", resetAt + 60000, resetAt + 60000),
    ).toBeDefined();
    await applyObservation(db, "new", (await read())!, live, resetAt + 60000);
    expect((await read())!.durationSeconds).toBe(0);
    await applyObservation(db, "new", (await read())!, live, resetAt + 120000);
    expect((await read())!.durationSeconds).toBe(60);
    expect((await read())!.viewerSeconds).toBe(600);
    // A retried request from the old UI must not erase the new measurement.
    expect(
      await resetMeasurements(db, ORIGINAL_MEASUREMENT_START, resetAt + 180000),
    ).toBeNull();
    expect((await read())!.durationSeconds).toBe(60);
    expect(await db.select().from(sessions)).toHaveLength(1);
  } finally {
    sqlite.close();
  }
});

test("failed reset rolls back deletions, metrics and collector ownership together", async () => {
  const { db, sqlite, read } = await setup();
  try {
    const before = await read();
    sqlite.exec(
      "CREATE TRIGGER fail_reset BEFORE UPDATE OF measurement_started_at ON collector_state BEGIN SELECT RAISE(ABORT, 'test reset failure'); END",
    );
    await expect(
      resetMeasurements(db, ORIGINAL_MEASUREMENT_START, at + 120000),
    ).rejects.toThrow();
    expect(await read()).toEqual(before);
    for (const table of [sessions, daily, hourly, cache])
      expect((await db.select().from(table)).length).toBeGreaterThan(0);
    expect((await db.select().from(collector).get())!.runId).toBe("old");
    expect(await db.select().from(streamers)).toHaveLength(3);
  } finally {
    sqlite.close();
  }
});
