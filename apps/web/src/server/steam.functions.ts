import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseHeader,
} from '@tanstack/react-start/server'
import type { SteamActionInput } from './steam-admin'

export const steamAction = createServerFn({ method: 'POST' })
  .validator((input: SteamActionInput) => input)
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'private, no-store')
    const { env } = await import('cloudflare:workers')
    const { createDb } = await import('db')
    const { getAuth } = await import('@/lib/auth/server')
    const { requireSteamAdmin, steamAdminAction } =
      await import('./steam-admin')
    const { steamApi } = await import('./steam-api')
    const { SteamLinkError } = await import('db/steam-links')
    const db = createDb(env.DB)
    try {
      const adminId = await requireSteamAdmin(
        db,
        getAuth(),
        getRequestHeaders(),
      )
      return {
        ok: true as const,
        result: await steamAdminAction(
          db,
          adminId,
          data,
          steamApi(
            (env as typeof env & { DEADLOCK_API_KEY?: string })
              .DEADLOCK_API_KEY,
          ),
        ),
      }
    } catch (error) {
      // Avoid exposing SQL, credentials or request internals in browser errors.
      const message =
        error instanceof SteamLinkError
          ? error.message
          : '操作に失敗しました。時間をおいて再試行してください。'
      return { ok: false as const, message }
    }
  })
