/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
const issuer = "https://test.clerk.accounts.dev";
const paging = { search: "", paginationOpts: { numItems: 30, cursor: null } };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "user_admin");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const [twitchId, displayName] of [
      ["1", "Alice"],
      ["2", "Bob"],
    ]) {
      await ctx.db.insert("streamers", {
        twitchId,
        login: displayName.toLowerCase(),
        displayName,
        profileImageUrl: null,
        profileUpdatedAt: null,
        firstSeenAt: 1,
      });
      await ctx.db.insert("streamerState", {
        twitchId,
        isLive: false,
        hasOpenSession: false,
        sessionId: null,
        lastObservedAt: 1,
        lastSeenAt: Number(twitchId) === 1 ? 2 : 1,
        liveViewerCount: null,
        liveStartedAt: null,
        title: null,
        durationSeconds: 0,
        viewerSeconds: 0,
        peakViewers: 0,
      });
    }
  });
  return t;
}
test("unauthenticated and non-admin users cannot list, link, or unlink", async () => {
  const t = await setup();
  for (const user of [
    t,
    t.withIdentity({ subject: "user_other", issuer }),
    t.withIdentity({
      subject: "user_admin",
      issuer: "https://wrong.clerk.accounts.dev",
    }),
  ]) {
    expect((await user.query(api.admin.access, {})).isAdmin).toBe(false);
    await expect(user.query(api.admin.streamers, paging)).rejects.toThrow(
      "管理者権限",
    );
    await expect(
      user.mutation(api.admin.link, { twitchId: "1", steamAccount: "12345" }),
    ).rejects.toThrow("管理者権限");
    await expect(
      user.mutation(api.admin.unlink, { twitchId: "1" }),
    ).rejects.toThrow("管理者権限");
  }
  expect(await t.run((ctx) => ctx.db.query("steamLinks").first())).toBeNull();
});
test("missing allowlist or issuer never grants access", async () => {
  const t = await setup();
  const admin = t.withIdentity({ subject: "user_admin", issuer });
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "");
  expect((await admin.query(api.admin.access, {})).isAdmin).toBe(false);
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "user_admin");
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "");
  expect((await admin.query(api.admin.access, {})).isAdmin).toBe(false);
});
test("admin can search, register, change and remove links; revocation applies to writes", async () => {
  const t = await setup();
  const admin = t.withIdentity({ subject: "user_admin", issuer });
  expect((await admin.query(api.admin.access, {})).isAdmin).toBe(true);
  expect(
    (
      await admin.query(api.admin.streamers, { ...paging, search: "Alice" })
    ).page.map((row) => row.displayName),
  ).toEqual(["Alice"]);
  await admin.mutation(api.admin.link, {
    twitchId: "1",
    steamAccount: "12345",
  });
  expect(
    (await admin.query(api.admin.streamers, paging)).page[0].deadlockRank
      ?.accountId,
  ).toBe(12345);
  await admin.mutation(api.admin.link, {
    twitchId: "1",
    steamAccount: "67890",
  });
  expect(
    (await admin.query(api.admin.streamers, paging)).page[0].deadlockRank
      ?.accountId,
  ).toBe(67890);
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "user_different");
  await expect(
    admin.mutation(api.admin.unlink, { twitchId: "1" }),
  ).rejects.toThrow("管理者権限");
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "user_admin");
  await admin.mutation(api.admin.unlink, { twitchId: "1" });
  expect(
    (await admin.query(api.admin.streamers, paging)).page[0].deadlockRank,
  ).toBeNull();
});
test("admin validations preserve data when input or association is invalid", async () => {
  const t = await setup();
  const admin = t.withIdentity({ subject: "user_admin", issuer });
  await admin.mutation(api.admin.link, {
    twitchId: "1",
    steamAccount: "12345",
  });
  await expect(
    admin.mutation(api.admin.link, { twitchId: "2", steamAccount: "12345" }),
  ).rejects.toThrow("登録済み");
  await expect(
    admin.mutation(api.admin.link, {
      twitchId: "1",
      steamAccount: "not-a-steam-id",
    }),
  ).rejects.toThrow();
  expect(
    (await admin.query(api.admin.streamers, paging)).page[0].deadlockRank
      ?.accountId,
  ).toBe(12345);
  await expect(
    admin.query(api.admin.streamers, {
      ...paging,
      paginationOpts: { numItems: 1000, cursor: null },
    }),
  ).rejects.toThrow();
});

test("live streamers precede offline streamers across pages and expose live badge data", async () => {
  const t = await setup();
  const admin = t.withIdentity({ subject: "user_admin", issuer });
  await t.run(async (ctx) => {
    const state = await ctx.db
      .query("streamerState")
      .withIndex("by_twitchId", (q) => q.eq("twitchId", "2"))
      .unique();
    await ctx.db.patch("streamerState", state!._id, {
      isLive: true,
      liveViewerCount: 42,
      liveStartedAt: 100,
    });
  });
  const first = await admin.query(api.admin.streamers, {
    search: "",
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page[0]).toMatchObject({
    twitchId: "2",
    isLive: true,
    liveViewerCount: 42,
    liveStartedAt: 100,
  });
  const second = await admin.query(api.admin.streamers, {
    search: "",
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  expect(second.page[0]).toMatchObject({ twitchId: "1", isLive: false });
  const search = await admin.query(api.admin.streamers, {
    ...paging,
    search: "Bob",
  });
  expect(search.page[0].isLive).toBe(true);
});

test("unlinked-only excludes linked accounts even while ranks are pending and preserves pagination", async () => {
  const t = await setup();
  const admin = t.withIdentity({ subject: "user_admin", issuer });
  await admin.mutation(api.admin.link, {
    twitchId: "1",
    steamAccount: "12345",
  });
  const first = await admin.query(api.admin.streamers, {
    search: "",
    unlinkedOnly: true,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  const second = await admin.query(api.admin.streamers, {
    search: "",
    unlinkedOnly: true,
    paginationOpts: { numItems: 1, cursor: first.continueCursor },
  });
  expect(second.page.map((row) => row.twitchId)).toEqual(["2"]);
  expect(
    (
      await admin.query(api.admin.streamers, {
        ...paging,
        unlinkedOnly: true,
        search: "Alice",
      })
    ).page,
  ).toEqual([]);
  expect(
    (await admin.query(api.admin.streamers, { ...paging, unlinkedOnly: false }))
      .page,
  ).toHaveLength(2);
  await admin.mutation(api.admin.unlink, { twitchId: "1" });
  expect(
    (await admin.query(api.admin.streamers, { ...paging, unlinkedOnly: true }))
      .page,
  ).toHaveLength(2);
});
