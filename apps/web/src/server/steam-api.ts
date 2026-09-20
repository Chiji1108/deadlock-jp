import { SteamLinkError } from 'db/steam-links'
import { createDeadlockApi } from 'deadlock'
import { parseHeroes, parseRank } from 'deadlock/model'

export const steamProfileUrl = (id: number) =>
  `https://steamcommunity.com/profiles/${BigInt(id) + 76561197960265728n}`
export function accountId(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 4294967295
  )
    throw new SteamLinkError('Steam account IDが不正です。')
  return value
}
export function parseSteamInput(input: string) {
  let value = input.trim()
  if (value.length > 250) throw new SteamLinkError('Steam IDが長すぎます。')
  if (/^https?:\/\//.test(value)) {
    const url = new URL(value)
    const match = url.pathname.match(/^\/profiles\/(\d+)\/?$/)
    if (
      url.hostname !== 'steamcommunity.com' ||
      url.port ||
      url.username ||
      url.password ||
      !match
    )
      throw new SteamLinkError(
        '数値IDのSteamプロフィールURL（/profiles/…）を入力してください。/id/…には対応していません。',
      )
    value = match[1]
  }
  const id3 = value.match(/^\[U:1:(\d+)\]$/)
  if (id3) value = id3[1]
  if (!/^\d{1,20}$/.test(value))
    throw new SteamLinkError(
      'SteamID64・SteamID3・account IDを入力してください。',
    )
  let id = BigInt(value)
  if (id >= 76561197960265728n) id -= 76561197960265728n
  return accountId(Number(id))
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SteamLinkError('APIの応答形式が不正です。')
  return value as Record<string, unknown>
}
export function profiles(value: unknown) {
  if (!Array.isArray(value))
    throw new SteamLinkError('プロフィールを確認できませんでした。')
  const seen = new Set<number>()
  return value.flatMap((raw) => {
    const row = object(raw)
    const id = accountId(row.account_id)
    if (seen.has(id)) return []
    seen.add(id)
    const name =
      typeof row.personaname === 'string'
        ? row.personaname.trim().slice(0, 200)
        : ''
    const avatar =
      typeof row.avatarmedium === 'string' &&
      /^https:\/\/avatars\.(steamstatic\.com|cloudflare\.steamstatic\.com|akamai\.steamstatic\.com)\//.test(
        row.avatarmedium,
      )
        ? row.avatarmedium
        : null
    return [
      {
        accountId: id,
        name: name || `Steam ID: ${id}`,
        avatar,
        nameAvailable: !!name,
      },
    ]
  })
}
export function matchPlayers(value: unknown, matchId: number) {
  const info = object(object(value).match_info)
  if (
    info.match_id !== matchId ||
    !Array.isArray(info.players) ||
    info.players.length > 64
  )
    throw new SteamLinkError('試合データを確認できませんでした。')
  const seen = new Set<number>()
  return info.players.flatMap((raw) => {
    const p = object(raw)
    if (
      typeof p.account_id !== 'number' ||
      !Number.isInteger(p.account_id) ||
      p.account_id <= 0 ||
      p.account_id > 4294967295 ||
      seen.has(p.account_id)
    )
      return []
    seen.add(p.account_id)
    return [
      {
        accountId: p.account_id,
        heroId: typeof p.hero_id === 'number' ? p.hero_id : null,
      },
    ]
  })
}
export function steamApi(apiKey?: string, request: typeof fetch = fetch) {
  const client = createDeadlockApi(apiKey, request, 15_000)
  async function read<T>(
    pending: Promise<{ data?: T; response: Response }>,
    unavailable: number[] = [],
  ): Promise<T | null> {
    let result
    try {
      result = await pending
    } catch {
      throw new SteamLinkError(
        'Deadlock APIと通信できませんでした。再試行してください。',
      )
    }
    if (unavailable.includes(result.response.status)) return null
    if (!result.response.ok)
      throw new SteamLinkError(
        result.response.status === 429
          ? '取得制限中です。時間をおいて再試行してください。'
          : 'Deadlock APIから取得できませんでした。再試行してください。',
      )
    // Match metadata has no response schema in upstream OpenAPI; validate it below.
    if (result.data === undefined)
      throw new SteamLinkError('APIからデータが返りませんでした。')
    return result.data
  }
  return {
    search: async (query: string) =>
      profiles((await read(client.search(query), [404])) ?? []),
    profiles: async (ids: number[]) =>
      profiles((await read(client.profiles(ids), [404])) ?? []),
    rank: async (id: number) => {
      const value = await read(client.rank(id), [403, 404])
      return value === null ? null : parseRank(value)
    },
    match: async (id: number) => matchPlayers(await read(client.match(id)), id),
    heroes: async () => parseHeroes(await read(client.heroes())),
  }
}
