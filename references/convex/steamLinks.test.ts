/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { parseRank, steamAccountId } from "./deadlock";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function setup() {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const twitchId of ["a", "b"])
      await ctx.db.insert("streamers", {
        twitchId,
        login: twitchId,
        displayName: twitchId,
        profileImageUrl: null,
        profileUpdatedAt: null,
        firstSeenAt: 1,
      });
  });
  return t;
}
test("Steam numeric formats normalize without precision loss and reject ambiguous identities", () => {
  for (const id of [
    "12345",
    "[U:1:12345]",
    "76561197960278073",
    "https://steamcommunity.com/profiles/76561197960278073/",
  ])
    expect(steamAccountId(id)).toBe(12345);
  for (const id of [
    "0",
    "-1",
    "4294967296",
    "https://evil.test/profiles/76561197960278073",
    "https://steamcommunity.com/id/vanity",
    "1e3",
  ])
    expect(() => steamAccountId(id)).toThrow();
});
test("validates upstream rank, including no ranked data", () => {
  expect(parseRank({ rank: 11, subrank: 6, badge: 116 })).toEqual({
    tier: 11,
    subrank: 6,
  });
  expect(parseRank({ rank: 0, subrank: 0, badge: 0 })).toEqual({
    tier: 0,
    subrank: 0,
  });
  for (const value of [
    null,
    {},
    { rank: 1, subrank: 7, badge: 17 },
    { rank: 1, subrank: 1, badge: 99 },
  ])
    expect(() => parseRank(value)).toThrow();
});
test("link requires existing streamer, prevents duplicate ownership and unlink is idempotent", async () => {
  const t = await setup();
  await expect(
    t.mutation(internal.steamLinks.link, {
      twitchId: "missing",
      steamAccount: "12345",
    }),
  ).rejects.toThrow();
  await t.mutation(internal.steamLinks.link, {
    twitchId: "a",
    steamAccount: "12345",
  });
  await expect(
    t.mutation(internal.steamLinks.link, {
      twitchId: "b",
      steamAccount: "12345",
    }),
  ).rejects.toThrow();
  await t.mutation(internal.steamLinks.unlink, { twitchId: "a" });
  await t.mutation(internal.steamLinks.unlink, { twitchId: "a" });
  await t.mutation(internal.steamLinks.link, {
    twitchId: "b",
    steamAccount: "12345",
  });
});
test("in-flight result cannot resurrect unlinked or overwrite relinked accounts", async () => {
  const t = await setup();
  await t.mutation(internal.steamLinks.link, {
    twitchId: "a",
    steamAccount: "12345",
  });
  const old = await t.run((ctx) => ctx.db.query("steamLinks").first());
  await t.mutation(internal.steamLinks.link, {
    twitchId: "a",
    steamAccount: "67890",
  });
  await t.mutation(internal.steamLinks.save, {
    id: old!._id,
    attemptedAt: 99,
    result: { tier: 11, subrank: 6 },
  });
  const next = await t.run((ctx) => ctx.db.query("steamLinks").first());
  expect(next).toMatchObject({ accountId: 67890, tier: null });
  await t.mutation(internal.steamLinks.unlink, { twitchId: "a" });
  await t.mutation(internal.steamLinks.save, {
    id: next!._id,
    attemptedAt: 100,
    result: { tier: 11, subrank: 6 },
  });
  expect(await t.run((ctx) => ctx.db.query("steamLinks").first())).toBeNull();
});
test("refresh parses response and clears ranks on protected responses", async () => {
  const t = await setup();
  await t.mutation(internal.steamLinks.link, {
    twitchId: "a",
    steamAccount: "12345",
  });
  const row = await t.run((ctx) => ctx.db.query("steamLinks").first());
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ rank: 9, subrank: 3, badge: 93 })),
    );
  vi.stubGlobal("fetch", fetchMock);
  await t.action(internal.steamLinks.refresh, { id: row!._id });
  expect(
    await t.query(internal.steamLinks.get, { id: row!._id }),
  ).toMatchObject({ tier: 9, subrank: 3, unavailable: false });
  fetchMock.mockResolvedValue(new Response("", { status: 403 }));
  await t.action(internal.steamLinks.refresh, { id: row!._id });
  expect(
    await t.query(internal.steamLinks.get, { id: row!._id }),
  ).toMatchObject({ tier: null, subrank: null, unavailable: true });
});
test("due refresh claims at most ten links without scheduling them twice", async () => {
  const t = await setup();
  await t.run(async (ctx) => {
    for (let i = 0; i < 12; i++)
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
  await t.mutation(internal.steamLinks.refreshDue, {});
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("steamLinks")
        .withIndex("by_nextRefreshAt", (q) => q.eq("nextRefreshAt", 0))
        .collect(),
    ),
  ).toHaveLength(2);
  await t.mutation(internal.steamLinks.refreshDue, {});
  expect(
    await t.run((ctx) =>
      ctx.db
        .query("steamLinks")
        .withIndex("by_nextRefreshAt", (q) => q.eq("nextRefreshAt", 0))
        .collect(),
    ),
  ).toHaveLength(0);
  expect(
    await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect()),
  ).toHaveLength(12);
});

test.each([429, 500, 503, "network", "invalid"] as const)(
  "transient failure %s preserves rank, records reason and backs off",
  async (failure) => {
    const t = await setup();
    const id = await t.run((ctx) =>
      ctx.db.insert("steamLinks", {
        twitchId: "a",
        accountId: 12345,
        tier: 11,
        subrank: 6,
        updatedAt: 1,
        unavailable: false,
        nextRefreshAt: 0,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (failure === "network") throw new Error("timeout");
        if (failure === "invalid") return new Response("{}");
        return new Response("", {
          status: failure,
          headers: { "Retry-After": "600" },
        });
      }),
    );
    const at = Date.now();
    await t.action(internal.steamLinks.refresh, { id });
    const row = await t.query(internal.steamLinks.get, { id });
    expect(row).toMatchObject({
      tier: 11,
      subrank: 6,
      updatedAt: 1,
      unavailable: false,
      failureCount: 1,
      lastAttemptAt: at,
    });
    expect(row?.lastError).toBeTruthy();
    expect(row!.nextRefreshAt).toBeGreaterThanOrEqual(at + 300_000);
    if (typeof failure === "number")
      expect(row!.nextRefreshAt).toBe(at + 600_000);
    await t.mutation(internal.steamLinks.save, {
      id,
      attemptedAt: at - 1,
      result: null,
    });
    expect((await t.query(internal.steamLinks.get, { id }))?.tier).toBe(11);
    await t.mutation(internal.steamLinks.save, {
      id,
      attemptedAt: at + 1,
      result: { tier: 0, subrank: 0 },
    });
    expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
      tier: 0,
      unavailable: false,
      failureCount: 0,
    });
    expect(
      (await t.query(internal.steamLinks.get, { id }))?.lastError,
    ).toBeUndefined();
  },
);

test("failed initial refresh is unavailable, not permanently loading", async () => {
  const t = await setup();
  const id = await t.run((ctx) =>
    ctx.db.insert("steamLinks", {
      twitchId: "a",
      accountId: 12345,
      tier: null,
      subrank: null,
      updatedAt: null,
      unavailable: false,
      nextRefreshAt: 0,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 429 })),
  );
  await t.action(internal.steamLinks.refresh, { id });
  expect(await t.query(internal.steamLinks.get, { id })).toMatchObject({
    tier: null,
    updatedAt: null,
    unavailable: true,
    lastError: "http_429",
  });
});
