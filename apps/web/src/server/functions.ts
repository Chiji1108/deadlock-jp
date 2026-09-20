import { createServerFn } from '@tanstack/react-start'
import { parseFilters } from 'db/types'

export const fetchBoard = createServerFn({ method: 'GET' })
  .validator(parseFilters)
  .handler(async ({ data }) => {
    const { loadBoard } = await import('./data.server')
    return loadBoard(data)
  })
export const fetchDetail = createServerFn({ method: 'GET' })
  .validator((id: string) => {
    if (typeof id !== 'string' || !/^\d{1,30}$/.test(id))
      throw new Error('Invalid Twitch ID')
    return id
  })
  .handler(async ({ data }) => {
    const { loadDetail } = await import('./data.server')
    return loadDetail(data)
  })
export const fetchStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { loadStatus } = await import('./data.server')
    return loadStatus()
  },
)
