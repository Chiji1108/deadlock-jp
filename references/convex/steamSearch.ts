import { ConvexError, v } from "convex/values";

export const steamProfile = v.object({
  accountId: v.number(),
  name: v.string(),
  avatar: v.union(v.string(), v.null()),
});
export async function searchSteamProfiles(input: string) {
  const search = input.trim();
  if (!search || search.length > 100)
    throw new ConvexError("Steamの名前を100文字以内で入力してください。");
  try {
    const params = new URLSearchParams({
      search_query: search,
      limit: "20",
      min_matches_played_last_30d: "0",
    });
    const response = await fetch(
      `https://api.deadlock-api.com/v1/players/steam-search?${params}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (response.status === 404) return [];
    if (response.status === 429)
      throw new ConvexError(
        "検索の取得制限中です。時間をおいてお試しください。",
      );
    if (!response.ok) throw new Error("Search failed");
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid search response");
    const seen = new Set<number>();
    return data.slice(0, 20).flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const p = value as Record<string, unknown>;
      if (
        typeof p.account_id !== "number" ||
        !Number.isInteger(p.account_id) ||
        p.account_id <= 0 ||
        p.account_id > 4294967295 ||
        seen.has(p.account_id)
      )
        return [];
      seen.add(p.account_id);
      const avatar =
        typeof p.avatarmedium === "string" &&
        /^https:\/\/avatars\.(steamstatic\.com|cloudflare\.steamstatic\.com|akamai\.steamstatic\.com)\//.test(
          p.avatarmedium,
        )
          ? p.avatarmedium
          : null;
      return [
        {
          accountId: p.account_id,
          name:
            typeof p.personaname === "string" && p.personaname
              ? p.personaname
              : `Steam ID: ${p.account_id}`,
          avatar,
        },
      ];
    });
  } catch (error) {
    if (error instanceof ConvexError) throw error;
    throw new ConvexError(
      "Steamアカウントを検索できませんでした。時間をおいてお試しください。",
    );
  }
}

export async function steamNames(accountIds: number[]) {
  if (
    accountIds.length > 50 ||
    accountIds.some((id) => !Number.isInteger(id) || id <= 0 || id > 4294967295)
  )
    throw new ConvexError("Steam IDの指定が不正です。");
  if (!accountIds.length) return [];
  try {
    const response = await fetch(
      `https://api.deadlock-api.com/v1/players/steam?account_ids=${[...new Set(accountIds)].join(",")}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (response.status === 404) return [];
    if (!response.ok) throw new Error("Profile lookup failed");
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid profiles");
    return data.flatMap((value: unknown) => {
      if (!value || typeof value !== "object") return [];
      const p = value as Record<string, unknown>;
      return typeof p.account_id === "number" &&
        accountIds.includes(p.account_id) &&
        typeof p.personaname === "string" &&
        p.personaname.trim()
        ? [{ accountId: p.account_id, name: p.personaname }]
        : [];
    });
  } catch {
    throw new ConvexError("Steamのプレイヤーネームを取得できませんでした。");
  }
}
