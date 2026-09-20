import { expect, test } from "bun:test";
import { testDatabase } from "./d1";
import { cache, collector, eq, streamers } from "../packages/db/src/index";
import { getDetail } from "../packages/db/src/queries";
import { saveSteamLink } from "../packages/db/src/steam-links";
import { steamAdminAction } from "../apps/web/src/server/steam-admin";
import {
  parseSteamInput,
  steamApi,
  matchPlayers,
} from "../apps/web/src/server/steam-api";
import { saveEnrichment } from "../apps/collector/src/enrichment";

const profile = (id: number) => ({
  account_id: id,
  personaname: `Player ${id}`,
  avatarmedium: "https://avatars.steamstatic.com/avatar.jpg",
});
function api(status = 200) {
  return steamApi(undefined, async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/rank"))
      return Response.json({ rank: 4, subrank: 2, badge: 42 }, { status });
    if (url.pathname.endsWith("/steam-search"))
      return Response.json([profile(55), profile(99)]);
    if (url.pathname.endsWith("/steam"))
      return Response.json(
        url.searchParams
          .get("account_ids")!
          .split(",")
          .map((id) => profile(Number(id))),
      );
    if (url.pathname.endsWith("/metadata"))
      return Response.json({
        match_info: {
          match_id: 123,
          players: [
            { account_id: 55, hero_id: 1 },
            { account_id: 99, hero_id: 1 },
            { account_id: 0, hero_id: 1 },
          ],
        },
      });
    if (url.pathname.endsWith("/heroes"))
      return Response.json([{ id: 1, name: "ヒーロー", images: {} }]);
    throw new Error("unexpected request");
  });
}
async function setup() {
  const result = await testDatabase();
  await result.db.insert(streamers).values([
    {
      twitchId: "1",
      steamAccountId: 10,
      firstSeenAt: 100,
      displayName: "配信者",
      durationSeconds: 120,
      viewerSeconds: 600,
      rankTier: 8,
      rankSubrank: 1,
      matchTimeSeconds: 500,
      recentMatches: [
        {
          matchId: 1,
          heroId: 1,
          heroName: "Old",
          heroImage: null,
          startedAt: 100,
          outcome: "win",
        },
      ],
    },
    {
      twitchId: "2",
      steamAccountId: 99,
      firstSeenAt: 100,
      displayName: "別の配信者",
    },
  ]);
  return result;
}
test("numeric Steam formats resolve precisely and vanity/foreign URLs are rejected", () => {
  for (const value of [
    "55",
    "[U:1:55]",
    "76561197960265783",
    "https://steamcommunity.com/profiles/76561197960265783/",
  ])
    expect(parseSteamInput(value)).toBe(55);
  for (const value of [
    "0",
    "4294967296",
    "-1",
    "1e3",
    "https://steamcommunity.com/id/name",
    "https://evil.example/profiles/76561197960265783",
    "https://steamcommunity.com@evil.example/profiles/76561197960265783",
  ])
    expect(() => parseSteamInput(value)).toThrow();
  expect(() =>
    matchPlayers({ match_info: { match_id: 999, players: [] } }, 123),
  ).toThrow();
});
test("three entry points use verified profile/rank and show duplicate registration", async () => {
  const { db, sqlite } = await setup();
  try {
    for (const action of ["search", "match"] as const) {
      const result = await steamAdminAction(
        db,
        "admin",
        { action, twitchId: "1", value: action === "match" ? "123" : "Player" },
        api(),
      );
      expect(result.kind).toBe("candidates");
      if (result.kind !== "candidates") throw new Error();
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[1].linkedTo).toContain("別の配信者");
      if (action === "match")
        expect(result.candidates[0].heroName).toBe("ヒーロー");
    }
    const result = await steamAdminAction(
      db,
      "admin",
      { action: "preview", twitchId: "1", value: "55" },
      api(),
    );
    if (result.kind !== "preview") throw new Error();
    expect(result.profile.name).toBe("Player 55");
    expect(result.rank.tier).toBe(4);
    expect(result.previousAccountId).toBe(10);
    await expect(saveSteamLink(db, result.token, "other")).rejects.toThrow();
    await expect(
      saveSteamLink(db, result.token, "admin", Date.now(), "2"),
    ).rejects.toThrow();
    await saveSteamLink(db, result.token, "admin");
    const row = (await db
      .select()
      .from(streamers)
      .where(eq(streamers.twitchId, "1"))
      .get())!;
    expect(row).toMatchObject({
      steamAccountId: 55,
      steamLinkVersion: 1,
      rankTier: 4,
      matchTimeSeconds: null,
      recentMatches: [],
      enrichmentDueAt: 0,
      durationSeconds: 120,
      viewerSeconds: 600,
    });
    await expect(saveSteamLink(db, result.token, "admin")).rejects.toThrow();
  } finally {
    sqlite.close();
  }
});
test("API failures block confirmation; unavailable rank can be confirmed explicitly", async () => {
  const { db, sqlite } = await setup();
  try {
    await expect(
      steamAdminAction(
        db,
        "admin",
        { action: "preview", twitchId: "1", value: "55" },
        api(429),
      ),
    ).rejects.toThrow("取得制限");
    expect(await db.select().from(cache)).toHaveLength(0);
    const result = await steamAdminAction(
      db,
      "admin",
      { action: "preview", twitchId: "1", value: "55" },
      api(404),
    );
    if (result.kind !== "preview") throw new Error();
    expect(result.rank.unavailable).toBe(true);
    await db.update(cache).set({ expiresAt: Date.now() - 1 });
    await expect(saveSteamLink(db, result.token, "admin")).rejects.toThrow(
      "有効期限",
    );
  } finally {
    sqlite.close();
  }
});
test("save rejects competing links, stale previews and reset confirmations atomically", async () => {
  const { db, sqlite } = await setup();
  try {
    const preview = () =>
      steamAdminAction(
        db,
        "admin",
        { action: "preview", twitchId: "1", value: "55" },
        api(),
      );
    const result = await preview();
    if (result.kind !== "preview") throw new Error();
    await db
      .update(streamers)
      .set({ steamAccountId: 55 })
      .where(eq(streamers.twitchId, "2"));
    await expect(saveSteamLink(db, result.token, "admin")).rejects.toThrow(
      "紐付け済み",
    );
    expect(
      (await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, "1"))
        .get())!.steamAccountId,
    ).toBe(10);
    await db
      .update(streamers)
      .set({ steamAccountId: 99 })
      .where(eq(streamers.twitchId, "2"));
    await db
      .update(streamers)
      .set({ steamLinkVersion: 1 })
      .where(eq(streamers.twitchId, "1"));
    await expect(saveSteamLink(db, result.token, "admin")).rejects.toThrow(
      "変更",
    );
    const another = await preview();
    if (another.kind !== "preview") throw new Error();
    await db.delete(cache);
    await expect(saveSteamLink(db, another.token, "admin")).rejects.toThrow();
  } finally {
    sqlite.close();
  }
});
test("collector cannot overwrite after linking away and back to the same Steam ID", async () => {
  const { db, sqlite } = await setup();
  try {
    await db.insert(collector).values({ id: 1, runId: "run" });
    const old = (await db
      .select()
      .from(streamers)
      .where(eq(streamers.twitchId, "1"))
      .get())!;
    await db
      .update(streamers)
      .set({ steamLinkVersion: 2 })
      .where(eq(streamers.twitchId, "1"));
    await saveEnrichment(
      db,
      "run",
      old,
      { kind: "ok", value: { tier: 1, subrank: 1 } },
      { kind: "ok", value: [] },
      { kind: "ok", value: 1 },
      Date.now(),
    );
    expect(
      (await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, "1"))
        .get())!.rankTier,
    ).toBe(8);
  } finally {
    sqlite.close();
  }
});

test("unlink requires a fresh confirmation, preserves Twitch metrics and rejects late collector results", async () => {
  const { db, sqlite } = await setup();
  try {
    await db.insert(collector).values({ id: 1, runId: "run" });
    const old = (await db
      .select()
      .from(streamers)
      .where(eq(streamers.twitchId, "1"))
      .get())!;
    const preview = await steamAdminAction(
      db,
      "admin",
      { action: "unlink-preview", twitchId: "1", value: "confirm" },
      api(),
    );
    if (preview.kind !== "unlink-preview") throw new Error();
    expect(preview.accountId).toBe(10);
    expect(
      (await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, "1"))
        .get())!.steamAccountId,
    ).toBe(10);
    await expect(saveSteamLink(db, preview.token, "other")).rejects.toThrow();
    const stale = await steamAdminAction(
      db,
      "admin",
      { action: "preview", twitchId: "1", value: "55" },
      api(),
    );
    if (stale.kind !== "preview") throw new Error();
    await steamAdminAction(
      db,
      "admin",
      { action: "save", twitchId: "1", value: preview.token },
      api(),
    );
    await saveEnrichment(
      db,
      "run",
      old,
      { kind: "ok", value: { tier: 8, subrank: 1 } },
      { kind: "ok", value: old.recentMatches },
      { kind: "ok", value: 500 },
      Date.now(),
    );
    expect(
      await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, "1"))
        .get(),
    ).toMatchObject({
      steamAccountId: null,
      steamLinkVersion: 1,
      rankTier: null,
      rankSubrank: null,
      rankUpdatedAt: null,
      recentMatches: [],
      historyUpdatedAt: null,
      matchTimeSeconds: null,
      matchTimeUpdatedAt: null,
      durationSeconds: 120,
      viewerSeconds: 600,
    });
    await expect(saveSteamLink(db, stale.token, "admin")).rejects.toThrow(
      "変更",
    );
    await expect(saveSteamLink(db, preview.token, "admin")).rejects.toThrow();
    await expect(
      steamAdminAction(
        db,
        "admin",
        { action: "unlink-preview", twitchId: "1", value: "confirm" },
        api(),
      ),
    ).rejects.toThrow("紐付けされていません");
  } finally {
    sqlite.close();
  }
});

test("unlink confirmation cannot remove a replacement link", async () => {
  const { db, sqlite } = await setup();
  try {
    const unlink = await steamAdminAction(
      db,
      "admin",
      { action: "unlink-preview", twitchId: "1", value: "confirm" },
      api(),
    );
    const replacement = await steamAdminAction(
      db,
      "admin",
      { action: "preview", twitchId: "1", value: "55" },
      api(),
    );
    if (unlink.kind !== "unlink-preview" || replacement.kind !== "preview")
      throw new Error();
    await saveSteamLink(db, replacement.token, "admin");
    await expect(saveSteamLink(db, unlink.token, "admin")).rejects.toThrow(
      "変更",
    );
    expect(
      (await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, "1"))
        .get())!.steamAccountId,
    ).toBe(55);
  } finally {
    sqlite.close();
  }
});

test("unobserved match history waits for a stream while ready and unavailable states remain distinct", async () => {
  const { db, sqlite } = await setup();
  try {
    const status = async () =>
      (await getDetail(db, "1"))!.data.deadlockActivity?.status;
    expect(await status()).toBe("waiting");
    await db
      .update(streamers)
      .set({ isLive: true })
      .where(eq(streamers.twitchId, "1"));
    expect(await status()).toBe("pending");
    await db
      .update(streamers)
      .set({ enrichmentError: "Unavailable" })
      .where(eq(streamers.twitchId, "1"));
    expect(await status()).toBe("unavailable");
    await db
      .update(streamers)
      .set({ historyUpdatedAt: Date.now() })
      .where(eq(streamers.twitchId, "1"));
    expect(await status()).toBe("ready");
  } finally {
    sqlite.close();
  }
});
