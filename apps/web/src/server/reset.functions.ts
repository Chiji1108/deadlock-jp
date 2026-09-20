import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseHeader,
} from '@tanstack/react-start/server'

export const resetMeasurementData = createServerFn({ method: 'POST' })
  .validator((input: { confirmation: string; expectedStart: number }) => input)
  .handler(async ({ data }) => {
    setResponseHeader('Cache-Control', 'private, no-store')
    const { env } = await import('cloudflare:workers')
    const { createDb } = await import('db')
    const { getAuth } = await import('@/lib/auth/server')
    const { resetForAdmin } = await import('./reset-admin')
    return resetForAdmin(createDb(env.DB), getAuth(), getRequestHeaders(), data)
  })
