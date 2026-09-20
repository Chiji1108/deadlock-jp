/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const issuer = "https://test.clerk.accounts.dev";
beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "admin");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const admin = () =>
  convexTest(schema, modules).withIdentity({ subject: "admin", issuer });
test("only administrators can search, and invalid searches never call upstream", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  for (const user of [
    t,
    t.withIdentity({ subject: "other", issuer }),
    t.withIdentity({ subject: "admin", issuer: "wrong" }),
  ]) {
    await expect(
      user.action(api.admin.searchSteam, { search: "name" }),
    ).rejects.toThrow("管理者権限");
  }
  for (const search of [" ", "x".repeat(101)])
    await expect(
      admin().action(api.admin.searchSteam, { search }),
    ).rejects.toThrow("100文字");
  expect(fetchMock).not.toHaveBeenCalled();
});
test("encodes names, includes inactive players, and keeps distinct same-name accounts", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify([
          {
            account_id: 12,
            personaname: "同名",
            avatarmedium: "https://avatars.steamstatic.com/a.jpg",
          },
          {
            account_id: 13,
            personaname: "同名",
            avatarmedium: "javascript:bad",
          },
          { account_id: 0 },
          { account_id: 4294967296 },
          { account_id: 12 },
        ]),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await admin().action(api.admin.searchSteam, { search: " 名前 & test " }),
  ).toEqual([
    {
      accountId: 12,
      name: "同名",
      avatar: "https://avatars.steamstatic.com/a.jpg",
    },
    { accountId: 13, name: "同名", avatar: null },
  ]);
  const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
  expect(url.searchParams.get("search_query")).toBe("名前 & test");
  expect(url.searchParams.get("min_matches_played_last_30d")).toBe("0");
  expect(url.searchParams.get("limit")).toBe("20");
});
test("distinguishes no results, throttling, malformed data, and network errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 404 })),
  );
  expect(
    await admin().action(api.admin.searchSteam, { search: "missing" }),
  ).toEqual([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 429 })),
  );
  await expect(
    admin().action(api.admin.searchSteam, { search: "name" }),
  ).rejects.toThrow("取得制限");
  for (const fetchMock of [
    vi.fn(async () => new Response("{}")),
    vi.fn().mockRejectedValue(new Error("timeout")),
  ]) {
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      admin().action(api.admin.searchSteam, { search: "name" }),
    ).rejects.toThrow("検索できません");
  }
});

test("player names require admin, batch exact account ids, and ignore unrelated profiles", async () => {
  const fetchMock = vi.fn<(url: string) => Promise<Response>>(
    async () =>
      new Response(
        JSON.stringify([
          { account_id: 12, personaname: "Player" },
          { account_id: 99, personaname: "Unrelated" },
          { account_id: 13, personaname: null },
        ]),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    convexTest(schema, modules).action(api.admin.steamPlayerNames, {
      accountIds: [12],
    }),
  ).rejects.toThrow("管理者権限");
  await expect(
    admin().action(api.admin.steamPlayerNames, {
      accountIds: Array(51).fill(12),
    }),
  ).rejects.toThrow("不正");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    await admin().action(api.admin.steamPlayerNames, { accountIds: [12, 13] }),
  ).toEqual([{ accountId: 12, name: "Player" }]);
  expect(
    new URL(fetchMock.mock.calls[0][0]).searchParams.get("account_ids"),
  ).toBe("12,13");
});

test("operational details require admin authorization and return recorded failures", async () => {
  const t = convexTest(schema, modules);
  for (const user of [
    t,
    t.withIdentity({ subject: "other", issuer }),
    t.withIdentity({ subject: "admin", issuer: "wrong" }),
  ]) {
    await expect(user.query(api.admin.collectionHealth, {})).rejects.toThrow(
      "管理者権限",
    );
    await expect(
      user.query(api.admin.rankHealth, {
        paginationOpts: { cursor: null, numItems: 30 },
      }),
    ).rejects.toThrow("管理者権限");
  }
  await t.run((ctx) =>
    ctx.db.insert("steamLinks", {
      twitchId: "player",
      accountId: 12,
      tier: 11,
      subrank: 6,
      updatedAt: 100,
      lastAttemptAt: 200,
      lastError: "http_429",
      failureCount: 3,
      nextRefreshAt: 600,
      unavailable: false,
    }),
  );
  const user = t.withIdentity({ subject: "admin", issuer });
  expect(await user.query(api.admin.collectionHealth, {})).toBeNull();
  expect(
    (
      await user.query(api.admin.rankHealth, {
        paginationOpts: { cursor: null, numItems: 30 },
      })
    ).page[0],
  ).toMatchObject({
    displayName: "player",
    updatedAt: 100,
    lastAttemptAt: 200,
    lastError: "http_429",
    failureCount: 3,
    nextRefreshAt: 600,
  });
});
