import { expect, spyOn, test } from "bun:test";
import { testDatabase } from "./d1";
import { cache, collector, eq, streamers } from "../packages/db/src/index";
import { refreshEnrichment } from "../apps/collector/src/enrichment";

test("only live linked streamers consume the five slots; offline data survives and resumes when due", async () => {
  const { db, sqlite } = await testDatabase();
  const now = Date.now();
  const calls: string[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith("/rank"))
      return Response.json({ rank: 4, subrank: 2, badge: 42 });
    return Response.json([]);
  });
  try {
    await db
      .insert(collector)
      .values({ id: 1, runId: "run", leaseUntil: now + 120000 });
    await db
      .insert(cache)
      .values({ key: "heroes", value: "[]", expiresAt: now + 86400000 });
    await db.insert(streamers).values([
      // All these are older than the eligible rows but must not consume slots.
      {
        twitchId: "offline",
        steamAccountId: 1,
        enrichmentDueAt: 0,
        rankTier: 2,
        rankSubrank: 1,
        rankUpdatedAt: 123,
        recentMatches: [
          {
            matchId: 1,
            heroId: 1,
            heroName: "Hero",
            heroImage: null,
            startedAt: 123,
            outcome: "win",
          },
        ],
        matchTimeSeconds: 500,
      },
      { twitchId: "import-only", steamAccountId: 2, enrichmentDueAt: 0 },
      { twitchId: "unlinked", isLive: true, enrichmentDueAt: 0 },
      {
        twitchId: "not-due",
        isLive: true,
        steamAccountId: 3,
        enrichmentDueAt: now + 3600000,
      },
      ...Array.from({ length: 7 }, (_, i) => ({
        twitchId: `live-${i}`,
        isLive: true,
        steamAccountId: 10 + i,
        enrichmentDueAt: i + 1,
      })),
    ]);
    const read = (id: string) =>
      db.select().from(streamers).where(eq(streamers.twitchId, id)).get();
    const offline = await read("offline");
    await refreshEnrichment(db, "run");
    expect(calls).toHaveLength(15);
    expect(calls.filter((p) => p.endsWith("/rank"))).toEqual(
      Array.from({ length: 5 }, (_, i) => `/v1/players/${10 + i}/rank`),
    );
    expect(await read("offline")).toEqual(offline);
    expect((await read("import-only"))!.rankUpdatedAt).toBeNull();
    expect((await read("not-due"))!.rankUpdatedAt).toBeNull();
    expect((await read("live-0"))!.enrichmentDueAt).toBeGreaterThanOrEqual(
      now + 3600000,
    );
    calls.length = 0;
    await refreshEnrichment(db, "run");
    expect(calls.filter((p) => p.endsWith("/rank"))).toEqual([
      "/v1/players/15/rank",
      "/v1/players/16/rank",
    ]);
    calls.length = 0;
    await refreshEnrichment(db, "run");
    expect(calls).toHaveLength(0);
    // Coming back online uses the existing due time, without resetting cooldowns.
    await db
      .update(streamers)
      .set({ isLive: true })
      .where(eq(streamers.twitchId, "offline"));
    await refreshEnrichment(db, "run");
    expect(calls).toHaveLength(3);
    expect((await read("offline"))!.rankTier).toBe(4);
    calls.length = 0;
    await db
      .update(streamers)
      .set({ isLive: false })
      .where(eq(streamers.twitchId, "offline"));
    await db
      .update(streamers)
      .set({ isLive: true })
      .where(eq(streamers.twitchId, "offline"));
    await refreshEnrichment(db, "run");
    expect(calls).toHaveLength(0);
    // No API requests (even hero assets) when only offline identities are due.
    await db.update(streamers).set({ isLive: false, enrichmentDueAt: 0 });
    await db.delete(cache);
    await refreshEnrichment(db, "run");
    expect(calls).toHaveLength(0);
  } finally {
    mock.mockRestore();
    sqlite.close();
  }
});
