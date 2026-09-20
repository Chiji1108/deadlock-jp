import { expect, test } from 'bun:test'
import { hashPassword } from '../apps/web/src/lib/auth/password'
import { createAuth } from '../apps/web/src/lib/auth/config'
import { user, account, session } from '../packages/db/src/auth-schema'
import { eq } from '../packages/db/src/index'
import { testDatabase } from './d1'

const password = 'Test-only-long-password-123!'
const environment = { BETTER_AUTH_SECRET: 'test-only-secret-at-least-32-characters-long', BETTER_AUTH_URL: 'http://localhost:3000' }
async function setup(isAdmin = true) {
  const { db, sqlite } = await testDatabase()
  const now = new Date()
  await db.insert(user).values({ id: 'admin', name: 'Admin', email: 'admin@example.com', isAdmin, createdAt: now, updatedAt: now })
  await db.insert(account).values({ id: 'credential', accountId: 'admin', providerId: 'credential', userId: 'admin', password: await hashPassword(password), createdAt: now, updatedAt: now })
  const auth = createAuth(db, environment)
  const request = (path: string, body: unknown, headers: Record<string,string> = {}) => auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'cf-connecting-ip': '127.0.0.1', ...headers }, body: JSON.stringify(body),
  }))
  return { db, sqlite, auth, request }
}
test('administrator login, session authorization and logout invalidation', async () => {
  const { db, sqlite, auth, request } = await setup()
  try {
    const response = await request('/sign-in/email', { email: 'admin@example.com', password })
    expect(response.status).toBe(200)
    const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    expect(cookie).toContain('session_token=')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    const headers = new Headers({ cookie })
    expect((await auth.api.getSession({ headers }))?.user.isAdmin).toBe(true)
    // Permission is read from D1, never from a cached client-side role.
    await db.update(user).set({ isAdmin: false }).where(eq(user.id, 'admin'))
    expect((await auth.api.getSession({ headers }))?.user.isAdmin).toBe(false)
    expect((await request('/sign-out', {}, { cookie })).status).toBe(200)
    expect(await auth.api.getSession({ headers })).toBeNull()
    expect(await db.select().from(session)).toHaveLength(0)
  } finally { sqlite.close() }
})
test('public signup, wrong password, non-admin login and cross-origin login are rejected', async () => {
  const { sqlite, request } = await setup(false)
  try {
    expect((await request('/sign-up/email', { email: 'new@example.com', password, name: 'New', isAdmin: true })).status).toBe(400)
    expect((await request('/sign-in/email', { email: 'admin@example.com', password: 'Wrong-password-long!' })).status).toBe(401)
    expect((await request('/sign-in/email', { email: 'admin@example.com', password })).status).toBe(403)
    expect((await request('/sign-in/email', { email: 'admin@example.com', password }, { Origin: 'https://untrusted.example' })).status).toBe(403)
  } finally { sqlite.close() }
})
test('login rate limiting persists across auth instances', async () => {
  const { db, sqlite, request } = await setup()
  try {
    for (let i = 0; i < 5; i++) await request('/sign-in/email', { email: 'admin@example.com', password: 'wrong-password-value' })
    const auth = createAuth(db, environment)
    const blocked = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/email', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000', 'cf-connecting-ip': '127.0.0.1' }, body: JSON.stringify({ email: 'admin@example.com', password }) }))
    expect(blocked.status).toBe(429)
  } finally { sqlite.close() }
})

test('expired and tampered session cookies cannot authenticate', async () => {
  const { db, sqlite, auth, request } = await setup()
  try {
    const response = await request('/sign-in/email', { email: 'admin@example.com', password })
    const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookie.replace('session_token=', 'session_token=forged') }) })).toBeNull()
    await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) })
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull()
  } finally { sqlite.close() }
})

test('measurement reset requires same-origin, explicit confirmation and a current administrator session', async () => {
  const { resetForAdmin } = await import('../apps/web/src/server/reset-admin')
  const { ORIGINAL_MEASUREMENT_START } = await import('../packages/db/src/time')
  const { streamers } = await import('../packages/db/src/schema')
  const { db, sqlite, auth, request } = await setup()
  try {
    await db.insert(streamers).values({ twitchId: '1', steamAccountId: 123, durationSeconds: 60 })
    const input = { confirmation: 'リセット', expectedStart: ORIGINAL_MEASUREMENT_START }
    const headers = new Headers({ origin: environment.BETTER_AUTH_URL })
    await expect(resetForAdmin(db, auth, headers, input)).rejects.toThrow('ログイン')
    const response = await request('/sign-in/email', { email: 'admin@example.com', password })
    headers.set('cookie', response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '))
    const foreign = new Headers(headers)
    foreign.set('origin', 'https://untrusted.example')
    await expect(resetForAdmin(db, auth, foreign, input)).rejects.toThrow('サイト内')
    foreign.delete('origin')
    await expect(resetForAdmin(db, auth, foreign, input)).rejects.toThrow('サイト内')
    await expect(resetForAdmin(db, auth, headers, { ...input, confirmation: '' })).rejects.toThrow('confirmation')
    await db.update(user).set({ isAdmin: false }).where(eq(user.id, 'admin'))
    await expect(resetForAdmin(db, auth, headers, input)).rejects.toThrow('ログイン')
    expect((await db.select().from(streamers).get())!.durationSeconds).toBe(60)
    await db.update(user).set({ isAdmin: true }).where(eq(user.id, 'admin'))
    await resetForAdmin(db, auth, headers, input)
    expect((await db.select().from(streamers).get())!.durationSeconds).toBe(0)
    expect((await auth.api.getSession({ headers }))?.user.isAdmin).toBe(true)
    expect(await db.select().from(account)).toHaveLength(1)
  } finally { sqlite.close() }
})
