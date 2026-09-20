// Local D1 only. Run from packages/db; --apply commits the validated batch.
import { getPlatformProxy } from "wrangler";
import { createDb, streamers, eq, isNull } from "../src/index";

const source = new URL(
  "../../../archive/twitch-steam-links.json",
  import.meta.url,
);
const input: unknown = await Bun.file(source).json();
if (!Array.isArray(input) || !input.length)
  throw new Error("Expected a nonempty link array");
const twitchIds = new Set<string>();
const accounts = new Set<number>();
const links = input.map((row) => {
  if (
    !row ||
    typeof row !== "object" ||
    typeof row.twitchId !== "string" ||
    !/^[1-9]\d*$/.test(row.twitchId) ||
    !Number.isSafeInteger(row.accountId) ||
    row.accountId <= 0 ||
    row.accountId > 4294967295 ||
    typeof row.steamId64 !== "string" ||
    !/^\d+$/.test(row.steamId64) ||
    BigInt(row.steamId64) !== 76561197960265728n + BigInt(row.accountId)
  ) {
    throw new Error("Invalid Twitch / Steam identifier");
  }
  if (twitchIds.has(row.twitchId) || accounts.has(row.accountId))
    throw new Error("Duplicate Twitch or Steam identifier");
  twitchIds.add(row.twitchId);
  accounts.add(row.accountId);
  return {
    twitchId: row.twitchId as string,
    steamAccountId: row.accountId as number,
  };
});
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: new URL("../../../apps/collector/wrangler.jsonc", import.meta.url)
    .pathname,
  persist: {
    path: new URL("../../../.wrangler/state/v3", import.meta.url).pathname,
  },
});
try {
  const db = createDb(proxy.env.DB);
  const before = await db.select().from(streamers);
  const pending = links.filter((link) => {
    const existing = before.find((r) => r.twitchId === link.twitchId);
    const owner = before.find((r) => r.steamAccountId === link.steamAccountId);
    if (owner && owner.twitchId !== link.twitchId)
      throw new Error(`Steam account already belongs to ${owner.twitchId}`);
    if (
      existing?.steamAccountId != null &&
      existing.steamAccountId !== link.steamAccountId
    )
      throw new Error(
        `Twitch account ${link.twitchId} already has another Steam link`,
      );
    return existing?.steamAccountId !== link.steamAccountId;
  });
  console.log(
    JSON.stringify({
      total: links.length,
      unchanged: links.length - pending.length,
      newIdentities: pending.filter(
        (l) => !before.some((r) => r.twitchId === l.twitchId),
      ).length,
      existingIdentities: pending.filter((l) =>
        before.some((r) => r.twitchId === l.twitchId),
      ).length,
    }),
  );
  if (!process.argv.includes("--apply")) {
    console.log("Preview only. Pass --apply to import into local D1.");
  } else if (pending.length) {
    const statements = pending.map((link) =>
      db
        .insert(streamers)
        .values(link)
        .onConflictDoUpdate({
          target: streamers.twitchId,
          set: {
            steamAccountId: link.steamAccountId,
            rankTier: null,
            rankSubrank: null,
            rankUpdatedAt: null,
            rankUnavailable: false,
            matchTimeSeconds: null,
            matchTimeUpdatedAt: null,
            recentMatches: [],
            historyUpdatedAt: null,
            enrichmentDueAt: 0,
            enrichmentFailures: 0,
            enrichmentError: null,
          },
          setWhere: isNull(streamers.steamAccountId),
        }),
    );
    await db.batch([statements[0]!, ...statements.slice(1)]);
    for (const link of links) {
      const row = await db
        .select()
        .from(streamers)
        .where(eq(streamers.twitchId, link.twitchId))
        .get();
      if (row?.steamAccountId !== link.steamAccountId)
        throw new Error(`Link verification failed: ${link.twitchId}`);
      const old = before.find((r) => r.twitchId === link.twitchId);
      if (
        old &&
        (old.durationSeconds !== row.durationSeconds ||
          old.viewerSeconds !== row.viewerSeconds ||
          old.peakViewers !== row.peakViewers)
      )
        throw new Error(`Counters changed during import: ${link.twitchId}`);
    }
    console.log(
      `Imported and verified ${pending.length} links in local D1; existing stream counters preserved.`,
    );
  } else console.log("All links already imported.");
} finally {
  await proxy.dispose();
}
