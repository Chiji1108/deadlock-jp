import { and, eq, exists, gt, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./index";
import { cache, streamers } from "./schema";
import type { Rank } from "./types";
export class SteamLinkError extends Error {}

export interface SteamLinkPreview {
  adminId: string;
  twitchId: string;
  streamerName: string;
  expectedAccountId: number | null;
  expectedFirstSeenAt: number;
  expectedVersion: number;
  accountId: number | null;
  name: string;
  avatar: string | null;
  rank: Rank;
}
const prefix = "steam-link-preview:";
export async function storeLinkPreview(
  db: Database,
  preview: SteamLinkPreview,
  now = Date.now(),
) {
  const token = crypto.randomUUID();
  await db.batch([
    db
      .delete(cache)
      .where(
        and(
          sql`${cache.key} LIKE 'steam-link-preview:%'`,
          lt(cache.expiresAt, now),
        ),
      ),
    db.insert(cache).values({
      key: prefix + token,
      value: JSON.stringify(preview),
      expiresAt: now + 300000,
    }),
  ]);
  return token;
}
export async function saveSteamLink(
  db: Database,
  token: string,
  adminId: string,
  now = Date.now(),
  twitchId?: string,
) {
  const key = prefix + token;
  const saved = await db
    .select()
    .from(cache)
    .where(and(eq(cache.key, key), gt(cache.expiresAt, now)))
    .get();
  if (!saved)
    throw new SteamLinkError(
      "確認の有効期限が切れました。もう一度選択してください。",
    );
  const value = JSON.parse(saved.value) as SteamLinkPreview;
  if (
    value.adminId !== adminId ||
    (twitchId !== undefined && value.twitchId !== twitchId)
  )
    throw new SteamLinkError("この確認内容は保存できません。");
  const valid = exists(
    db
      .select({ key: cache.key })
      .from(cache)
      .where(
        and(
          eq(cache.key, key),
          eq(cache.value, saved.value),
          gt(cache.expiresAt, now),
        ),
      ),
  );
  try {
    const result = await db.batch([
      db
        .update(streamers)
        .set({
          steamAccountId: value.accountId,
          steamLinkVersion: sql`${streamers.steamLinkVersion} + 1`,
          rankTier: value.rank.tier,
          rankSubrank: value.rank.subrank,
          rankUnavailable: value.rank.unavailable,
          rankUpdatedAt: value.rank.updatedAt,
          recentMatches: [],
          historyUpdatedAt: null,
          matchTimeSeconds: null,
          matchTimeUpdatedAt: null,
          enrichmentDueAt: 0,
          enrichmentFailures: 0,
          enrichmentError: null,
        })
        .where(
          and(
            eq(streamers.twitchId, value.twitchId),
            eq(streamers.firstSeenAt, value.expectedFirstSeenAt),
            eq(streamers.steamLinkVersion, value.expectedVersion),
            value.expectedAccountId === null
              ? isNull(streamers.steamAccountId)
              : eq(streamers.steamAccountId, value.expectedAccountId),
            valid,
          ),
        )
        .returning({ id: streamers.twitchId }),
      db.delete(cache).where(eq(cache.key, key)),
    ]);
    if (!result[0].length)
      throw new SteamLinkError(
        "紐付け状態が変更されました。画面を再読み込みしてください。",
      );
  } catch (error) {
    if (
      String(error).includes("UNIQUE") ||
      String((error as { cause?: unknown }).cause).includes("UNIQUE")
    )
      throw new SteamLinkError(
        "このSteamアカウントは別の配信者に紐付け済みです。",
      );
    throw error;
  }
  return { twitchId: value.twitchId };
}
