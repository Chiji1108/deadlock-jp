import { and, eq, inArray, isNotNull, sql, streamers } from 'db'
import type { Database } from 'db'
import { rateLimit } from 'db/auth-schema'
import { saveSteamLink, storeLinkPreview, SteamLinkError } from 'db/steam-links'
import type { createAuth } from '@/lib/auth/config'
import { parseSteamInput, steamApi } from './steam-api'

export type SteamActionInput = {
  action: 'search' | 'match' | 'preview' | 'unlink-preview' | 'save'
  twitchId: string
  value: string
}
export type SteamCandidate = {
  accountId: number
  name: string
  avatar: string | null
  heroName?: string
  heroImage?: string | null
  linkedTo: string | null
}
export async function requireSteamAdmin(
  db: Database,
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
) {
  if (headers.get('origin') !== new URL(String(auth.options.baseURL)).origin)
    throw new SteamLinkError('サイト内から操作してください。')
  const session = await auth.api.getSession({ headers })
  if (!session?.user.isAdmin)
    throw new SteamLinkError('管理者としてログインしてください。')
  const now = Date.now()
  const key = `steam-admin:${session.user.id}`
  const [limit] = await db
    .insert(rateLimit)
    .values({ id: key, key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${rateLimit.lastRequest} <= ${now - 60000} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${rateLimit.lastRequest} <= ${now - 60000} THEN ${now} ELSE ${rateLimit.lastRequest} END`,
      },
    })
    .returning({ count: rateLimit.count })
  if (limit.count > 20)
    throw new SteamLinkError(
      '操作回数が多いため、1分ほど待ってからお試しください。',
    )
  return session.user.id
}
export async function steamAdminAction(
  db: Database,
  adminId: string,
  raw: unknown,
  api = steamApi(),
) {
  const input = raw as Partial<SteamActionInput> | null
  if (
    !input ||
    !['search', 'match', 'preview', 'unlink-preview', 'save'].includes(
      input.action ?? '',
    ) ||
    typeof input.twitchId !== 'string' ||
    !/^\d{1,30}$/.test(input.twitchId) ||
    typeof input.value !== 'string' ||
    !input.value.trim() ||
    input.value.length > 250
  )
    throw new SteamLinkError('入力内容を確認してください。')
  const target = await db
    .select()
    .from(streamers)
    .where(
      and(
        eq(streamers.twitchId, input.twitchId),
        isNotNull(streamers.firstSeenAt),
      ),
    )
    .get()
  if (!target)
    throw new SteamLinkError(
      '配信者が見つかりません。画面を再読み込みしてください。',
    )
  const value = input.value.trim()
  if (input.action === 'save') {
    if (!/^[\da-f-]{36}$/.test(value))
      throw new SteamLinkError('確認内容が不正です。')
    return {
      kind: 'saved' as const,
      ...(await saveSteamLink(db, value, adminId, Date.now(), target.twitchId)),
    }
  }
  if (input.action === 'unlink-preview') {
    if (target.steamAccountId === null)
      throw new SteamLinkError('Steamアカウントは紐付けされていません。')
    const token = await storeLinkPreview(db, {
      adminId,
      twitchId: target.twitchId,
      streamerName: target.displayName,
      expectedAccountId: target.steamAccountId,
      expectedFirstSeenAt: target.firstSeenAt!,
      expectedVersion: target.steamLinkVersion,
      accountId: null,
      name: '',
      avatar: null,
      rank: {
        accountId: target.steamAccountId,
        tier: null,
        subrank: null,
        unavailable: false,
        updatedAt: null,
      },
    })
    return {
      kind: 'unlink-preview' as const,
      token,
      accountId: target.steamAccountId,
      streamerName: target.displayName,
    }
  }
  const annotate = async (
    candidates: Omit<SteamCandidate, 'linkedTo'>[],
  ): Promise<SteamCandidate[]> => {
    if (!candidates.length) return []
    const links = await db
      .select({
        accountId: streamers.steamAccountId,
        name: streamers.displayName,
        id: streamers.twitchId,
      })
      .from(streamers)
      .where(
        inArray(
          streamers.steamAccountId,
          candidates.map((p) => p.accountId),
        ),
      )
    return candidates.map((p) => {
      const linked = links.find((row) => row.accountId === p.accountId)
      return {
        ...p,
        linkedTo: linked
          ? linked.id === target.twitchId
            ? '現在の紐付け先'
            : `${linked.name || linked.id}に紐付け済み`
          : null,
      }
    })
  }
  if (input.action === 'search') {
    if (value.length > 100)
      throw new SteamLinkError('名前は100文字以内で入力してください。')
    return {
      kind: 'candidates' as const,
      candidates: await annotate(await api.search(value)),
    }
  }
  if (input.action === 'match') {
    if (
      !/^\d{1,16}$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) <= 0
    )
      throw new SteamLinkError('マッチIDは正の整数で入力してください。')
    const players = await api.match(Number(value))
    if (!players.length) return { kind: 'candidates' as const, candidates: [] }
    const [profiles, heroes] = await Promise.all([
      api.profiles(players.map((p) => p.accountId)),
      api.heroes(),
    ])
    return {
      kind: 'candidates' as const,
      candidates: await annotate(
        players.map((p) => {
          const profile = profiles.find((row) => row.accountId === p.accountId)
          const hero = heroes.find((row) => row.id === p.heroId)
          return {
            accountId: p.accountId,
            name: profile?.name ?? `Steam ID: ${p.accountId}`,
            avatar: profile?.avatar ?? null,
            heroName: hero?.name ?? `Hero ${p.heroId ?? '?'}`,
            heroImage: hero?.image ?? null,
          }
        }),
      ),
    }
  }
  const id = parseSteamInput(value)
  const duplicate = await db
    .select()
    .from(streamers)
    .where(eq(streamers.steamAccountId, id))
    .get()
  if (duplicate)
    throw new SteamLinkError(
      duplicate.twitchId === target.twitchId
        ? 'このアカウントは現在の紐付け先です。'
        : '別の配信者に紐付け済みです。',
    )
  const [profiles, rank] = await Promise.all([api.profiles([id]), api.rank(id)])
  const profile = profiles.find((p) => p.accountId === id)
  if (!profile?.nameAvailable)
    throw new SteamLinkError(
      'プレイヤーネームを確認できませんでした。時間をおいて再試行してください。',
    )
  const preview = {
    adminId,
    twitchId: target.twitchId,
    streamerName: target.displayName,
    expectedAccountId: target.steamAccountId,
    expectedFirstSeenAt: target.firstSeenAt!,
    expectedVersion: target.steamLinkVersion,
    accountId: id,
    name: profile.name,
    avatar: profile.avatar,
    rank: {
      accountId: id,
      tier: rank?.tier ?? null,
      subrank: rank?.subrank ?? null,
      unavailable: rank === null,
      updatedAt: rank ? Date.now() : null,
    },
  }
  const token = await storeLinkPreview(db, preview)
  // The client gets a one-use confirmation token; never accepts rank data on save.
  return {
    kind: 'preview' as const,
    token,
    profile,
    rank: preview.rank,
    previousAccountId: target.steamAccountId,
    streamerName: target.displayName,
  }
}
