import { ConvexError } from "convex/values";
const STEAM_BASE = BigInt("76561197960265728");

/** Accept only unambiguous numeric Steam identities; vanity names need manual resolution. */
export function steamAccountId(input: string): number {
  let value = input.trim();
  if (value.startsWith("https://")) {
    const url = new URL(value);
    const match = url.pathname.match(/^\/profiles\/(\d+)\/?$/);
    if (
      url.hostname !== "steamcommunity.com" ||
      !match ||
      url.username ||
      url.password
    )
      throw new ConvexError("数値IDのSteamプロフィールURLを入力してください");
    value = match[1];
  }
  const id3 = value.match(/^\[U:1:(\d+)\]$/);
  if (id3) value = id3[1];
  if (!/^\d+$/.test(value))
    throw new ConvexError(
      "SteamID64・SteamID3・数値のaccount IDを入力してください",
    );
  let id = BigInt(value);
  if (id >= STEAM_BASE) id -= STEAM_BASE;
  if (id <= BigInt(0) || id > BigInt("4294967295"))
    throw new ConvexError("Steam IDの範囲が不正です");
  return Number(id);
}

export function parseRank(value: unknown): { tier: number; subrank: number } {
  if (!value || typeof value !== "object")
    throw new Error("Invalid rank response");
  const r = value as Record<string, unknown>;
  const tier = r.rank,
    subrank = r.subrank;
  if (
    typeof tier !== "number" ||
    typeof subrank !== "number" ||
    !Number.isInteger(tier) ||
    !Number.isInteger(subrank) ||
    tier < 0 ||
    tier > 11 ||
    (tier === 0 ? subrank !== 0 : subrank < 1 || subrank > 6) ||
    r.badge !== tier * 10 + subrank
  )
    throw new Error("Invalid rank response");
  return { tier, subrank };
}
