import type { Database } from 'db'
import { resetMeasurements } from 'db/reset'
import type { createAuth } from '@/lib/auth/config'

export function parseResetInput(value: unknown) {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid reset request')
  const input = value as Record<string, unknown>
  if (
    input.confirmation !== 'リセット' ||
    !Number.isSafeInteger(input.expectedStart) ||
    Number(input.expectedStart) <= 0
  )
    throw new Error('Invalid reset confirmation')
  return {
    confirmation: 'リセット',
    expectedStart: Number(input.expectedStart),
  }
}

export async function resetForAdmin(
  db: Database,
  auth: ReturnType<typeof createAuth>,
  headers: Headers,
  input: unknown,
) {
  // This mutation is separate from Better Auth's endpoints, so enforce its own
  // same-origin check as well as a current, server-verified administrator session.
  if (headers.get('origin') !== new URL(String(auth.options.baseURL)).origin)
    throw new Error('この操作はサイト内から実行してください。')
  const session = await auth.api.getSession({ headers })
  if (!session?.user.isAdmin)
    throw new Error('管理者としてログインしてください。')
  const data = parseResetInput(input)
  const result = await resetMeasurements(db, data.expectedStart)
  if (!result)
    throw new Error(
      'すでにリセットされています。画面を再読み込みしてください。',
    )
  console.info('measurement_reset', {
    adminId: session.user.id,
    startedAt: result.measurementStartedAt,
  })
  return result
}
