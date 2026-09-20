import { strict as assert } from "node:assert";
import { getPlatformProxy } from "wrangler";
import { Glob } from "bun";
import { createDb, collector, streamers, eq } from "../src/index";
import { acquireRun, applyObservation } from "../src/ingestion";
import { getDetail, getRanking } from "../src/queries";
import { resetMeasurements } from "../src/reset";
import { ORIGINAL_MEASUREMENT_START } from "../src/time";
import { parseFilters } from "../src/types";
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "../../apps/collector/wrangler.jsonc",
  persist: false,
});
try {
  const files = Array.from(
    new Glob("*/migration.sql").scanSync({ cwd: "migrations" }),
  ).sort();
  for (const file of files)
    for (const stmt of (await Bun.file(`migrations/${file}`).text()).split(
      "--> statement-breakpoint",
    ))
      if (stmt.trim()) await proxy.env.DB.prepare(stmt).run();
  const db = createDb(proxy.env.DB),
    at = Date.now() - 120000;
  await acquireRun(db, "smoke", at, at);
  const live = {
    twitchId: "1",
    twitchStreamId: "test",
    login: "test",
    displayName: "テスト",
    title: "test",
    viewerCount: 10,
    startedAt: at,
    thumbnailUrl: null,
  };
  await applyObservation(db, "smoke", null, live, at);
  const read = () =>
    db.select().from(streamers).where(eq(streamers.twitchId, "1")).get();
  await applyObservation(
    db,
    "smoke",
    (await read())!,
    { ...live, viewerCount: 20 },
    at + 60000,
  );
  await applyObservation(db, "smoke", (await read())!, null, at + 120000);
  await db.update(collector).set({
    lastCollectedAt: at + 120000,
    firstCollectedAt: at,
    state: "ready",
  });
  assert.equal((await read())!.viewerSeconds, 1800);
  assert.equal(
    (await getRanking(db, parseFilters({}))).rows[0].averageViewers,
    15,
  );
  assert.equal(
    (await getDetail(db, "1"))!.data.recentSessions[0].hoursWatched,
    0.5,
  );
  await db
    .update(streamers)
    .set({ steamAccountId: 123 })
    .where(eq(streamers.twitchId, "1"));
  const resetAt = Date.now();
  assert.deepEqual(
    await resetMeasurements(db, ORIGINAL_MEASUREMENT_START, resetAt),
    { measurementStartedAt: resetAt },
  );
  assert.equal((await read())!.steamAccountId, 123);
  assert.equal((await read())!.durationSeconds, 0);
  assert.equal((await getRanking(db, parseFilters({}))).total, 0);
  assert.equal(
    await resetMeasurements(db, ORIGINAL_MEASUREMENT_START, resetAt + 1),
    null,
  );
  console.log(
    "Local D1 runtime: migrations, atomic ingestion, ranking, detail and reset passed",
  );
} finally {
  await proxy.dispose();
}
