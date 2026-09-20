import { createServerFn } from '@tanstack/react-start'
import {
  getRequestHeaders,
  setResponseHeader,
} from '@tanstack/react-start/server'

export const fetchAdmin = createServerFn({ method: 'GET' }).handler(
  async () => {
    setResponseHeader('Cache-Control', 'private, no-store')
    const { getAdmin, isAuthConfigured } = await import('@/lib/auth/server')
    return {
      configured: isAuthConfigured(),
      admin: await getAdmin(getRequestHeaders()),
    }
  },
)
