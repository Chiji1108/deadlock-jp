import { betterAuth } from 'better-auth'
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { APIError } from 'better-auth/api'
import type { Database } from 'db'
import * as schema from 'db/auth-schema'

export type AuthEnvironment = {
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
}
export function authConfigured(env: AuthEnvironment) {
  return Boolean(
    env.BETTER_AUTH_SECRET &&
    env.BETTER_AUTH_SECRET.length >= 32 &&
    env.BETTER_AUTH_URL,
  )
}
export function createAuth(db: Database, env: AuthEnvironment) {
  if (!authConfigured(env))
    throw new Error('Admin authentication is not configured')
  const baseURL = env.BETTER_AUTH_URL!
  const url = new URL(baseURL)
  if (
    url.protocol !== 'https:' &&
    !(
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
  ) {
    throw new Error('Authentication requires HTTPS')
  }
  return betterAuth({
    appName: 'Deadlock 日本語Twitch配信者ボード',
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        isAdmin: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    advanced: { ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] } },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const { eq } = await import('db')
            const admin = await db
              .select({ isAdmin: schema.user.isAdmin })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId))
              .get()
            if (!admin?.isAdmin)
              throw new APIError('FORBIDDEN', {
                message: '管理者アカウントではありません',
              })
          },
        },
      },
    },
  })
}
