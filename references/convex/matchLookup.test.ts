/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { parseMatchPlayers } from "./matchLookup";
const modules = import.meta.glob("./**/*.ts");
const issuer = "https://test.clerk.accounts.dev";
const metadata = {
  match_info: {
    match_id: 6669,
    players: [
      { account_id: 12345, hero_id: 1, team: 0 },
      { account_id: 67890, hero_id: 2, team: 1 },
      { account_id: 0, hero_id: 1, team: 0 },
    ],
  },
};
const json = (x: unknown) => new Response(JSON.stringify(x));
beforeEach(() => {
  vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", issuer);
  vi.stubEnv("CLERK_ADMIN_USER_IDS", "admin");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function admin() {
  return convexTest(schema, modules).withIdentity({ subject: "admin", issuer });
}
test("rejects unauthorized lookups before any external request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  for (const user of [
    t,
    t.withIdentity({ subject: "other", issuer }),
    t.withIdentity({ subject: "admin", issuer: "wrong" }),
  ]) {
    await expect(
      user.action(api.admin.matchParticipants, { matchId: "6669" }),
    ).rejects.toThrow("管理者権限");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
test("validates match ids before requests", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  for (const matchId of [
    "0",
    "-1",
    "1e3",
    "12/metadata",
    "9007199254740992",
    "abc",
  ]) {
    await expect(
      admin().action(api.admin.matchParticipants, { matchId }),
    ).rejects.toThrow("正の整数");
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
test("joins heroes and profiles by id, keeps unknown players linkable, excludes bots", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/matches/")) return json(metadata);
      if (url.includes("/assets/"))
        return json([
          {
            id: 1,
            name: "インファーナス",
            images: {
              icon_image_small:
                "https://assets-bucket.deadlock-api.com/hero.png",
            },
          },
        ]);
      return json([{ account_id: 12345, personaname: "Player A" }]);
    }),
  );
  const result = await admin().action(api.admin.matchParticipants, {
    matchId: " 6669 ",
  });
  expect(result).toMatchObject({
    matchId: 6669,
    partial: true,
    players: [
      {
        accountId: 12345,
        name: "Player A",
        heroName: "インファーナス",
        team: 0,
      },
      {
        accountId: 67890,
        name: "Steam ID: 67890",
        heroName: "ヒーロー 2",
        heroImage: null,
        team: 1,
      },
    ],
  });
});
test("optional enrichment failures retain participants", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/matches/")
        ? json(metadata)
        : new Response("", { status: 503 }),
    ),
  );
  const result = await admin().action(api.admin.matchParticipants, {
    matchId: "6669",
  });
  expect(result.players).toHaveLength(2);
  expect(result.partial).toBe(true);
});
test("reports missing matches, rate limits, and network errors", async () => {
  for (const [status, message] of [
    [404, "見つかりません"],
    [429, "取得制限"],
    [500, "取得できません"],
  ] as const) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status })),
    );
    await expect(
      admin().action(api.admin.matchParticipants, { matchId: "6669" }),
    ).rejects.toThrow(message);
  }
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
  await expect(
    admin().action(api.admin.matchParticipants, { matchId: "6669" }),
  ).rejects.toThrow("取得できません");
});
test("rejects mismatched metadata and removes duplicate or invalid identities", () => {
  expect(() => parseMatchPlayers(metadata, 999)).toThrow("形式");
  expect(() => parseMatchPlayers({}, 6669)).toThrow("形式");
  expect(
    parseMatchPlayers(
      {
        match_info: {
          match_id: 6669,
          players: [
            ...metadata.match_info.players,
            { account_id: 12345, hero_id: 2 },
            { account_id: 4294967296 },
            { account_id: 1.5 },
          ],
        },
      },
      6669,
    ),
  ).toHaveLength(2);
});

test("looked-up account links through the existing admin save flow and rejects duplicate ownership", async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    const user = t.withIdentity({ subject: "admin", issuer });
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/matches/") ? json(metadata) : json([]),
      ),
    );
    const match = await user.action(api.admin.matchParticipants, {
      matchId: "6669",
    });
    const steamAccount = String(match.players[0].accountId);
    await user.mutation(api.admin.link, { twitchId: "a", steamAccount });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("steamLinks")
          .withIndex("by_twitchId", (q) => q.eq("twitchId", "a"))
          .unique(),
      ),
    ).toMatchObject({ accountId: 12345 });
    await expect(
      user.mutation(api.admin.link, { twitchId: "b", steamAccount }),
    ).rejects.toThrow("登録済み");
  } finally {
    vi.useRealTimers();
  }
});
