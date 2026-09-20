import { ConvexError, v } from "convex/values";

export const matchPlayer = v.object({
  accountId: v.number(),
  name: v.string(),
  heroName: v.string(),
  heroImage: v.union(v.string(), v.null()),
  team: v.union(v.number(), v.null()),
});
const BASE = "https://api.deadlock-api.com/v1";
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function parseMatchPlayers(value: unknown, matchId: number) {
  const info = object(object(value).match_info);
  if (
    info.match_id !== matchId ||
    !Array.isArray(info.players) ||
    info.players.length > 64
  )
    throw new ConvexError("試合データの形式を確認できませんでした。");
  const seen = new Set<number>();
  return info.players
    .flatMap((raw: unknown) => {
      const p = object(raw);
      // Bots and unavailable identities must never become linkable Steam accounts.
      if (
        !positiveId(p.account_id) ||
        p.account_id > 4294967295 ||
        seen.has(p.account_id)
      )
        return [];
      seen.add(p.account_id);
      return [
        {
          accountId: p.account_id,
          heroId: positiveId(p.hero_id) ? p.hero_id : null,
          team:
            typeof p.team === "number" && Number.isInteger(p.team)
              ? p.team
              : null,
        },
      ];
    })
    .sort((a, b) => (a.team ?? 99) - (b.team ?? 99));
}
async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 404)
      throw new ConvexError(
        "試合データが見つかりません。マッチIDを確認するか、時間をおいてお試しください。",
      );
    if (response.status === 429)
      throw new ConvexError(
        "取得制限中です。時間をおいてもう一度お試しください。",
      );
    throw new ConvexError(
      "Deadlock APIから取得できませんでした。時間をおいてお試しください。",
    );
  }
  return await response.json();
}
export async function lookupMatch(input: string) {
  const id = input.trim();
  if (!/^\d{1,16}$/.test(id) || !positiveId(Number(id)))
    throw new ConvexError("マッチIDは正の整数で入力してください。");
  try {
    const players = parseMatchPlayers(
      await fetchJson(`/matches/${Number(id)}/metadata`),
      Number(id),
    );
    if (!players.length)
      throw new ConvexError("Steamアカウントを確認できる参加者がいません。");
    const [heroesResult, profilesResult] = await Promise.allSettled([
      fetchJson("/assets/heroes?language=japanese"),
      fetchJson(
        `/players/steam?account_ids=${players.map((p) => p.accountId).join(",")}`,
      ),
    ]);
    const heroes =
      heroesResult.status === "fulfilled" && Array.isArray(heroesResult.value)
        ? heroesResult.value.map(object)
        : [];
    const profiles =
      profilesResult.status === "fulfilled" &&
      Array.isArray(profilesResult.value)
        ? profilesResult.value.map(object)
        : [];
    return {
      matchId: Number(id),
      players: players.map((p) => {
        const hero = heroes.find((h) => h.id === p.heroId);
        const profile = profiles.find((s) => s.account_id === p.accountId);
        const image = object(hero?.images).icon_image_small;
        return {
          accountId: p.accountId,
          name:
            typeof profile?.personaname === "string" && profile.personaname
              ? profile.personaname
              : `Steam ID: ${p.accountId}`,
          heroName:
            typeof hero?.name === "string"
              ? hero.name
              : `ヒーロー ${p.heroId ?? "不明"}`,
          heroImage:
            typeof image === "string" &&
            image.startsWith("https://assets-bucket.deadlock-api.com/")
              ? image
              : null,
          team: p.team,
        };
      }),
      partial:
        heroes.length === 0 ||
        players.some(
          (p) =>
            !profiles.some((s) => s.account_id === p.accountId) ||
            !heroes.some((h) => h.id === p.heroId),
        ),
    };
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError(
      "試合データを取得できませんでした。時間をおいてもう一度お試しください。",
    );
  }
}
