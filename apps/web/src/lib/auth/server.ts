import { env } from 'cloudflare:workers'
import { createDb } from 'db'
import { authConfigured, createAuth } from './config'
import type { AuthEnvironment } from './config'

const environment = env as typeof env & AuthEnvironment
export const isAuthConfigured = () => authConfigured(environment)
export const getAuth = () => createAuth(createDb(env.DB), environment)

export async function getAdmin(headers: Headers) {
  if (!isAuthConfigured()) return null
  const session = await getAuth().api.getSession({ headers })
  if (!session?.user.isAdmin) return null
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  }
}
