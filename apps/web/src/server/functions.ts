import { createServerFn } from '@tanstack/react-start'
import { parseFilters, parsePeriod } from 'db/types'

export const fetchBoard = createServerFn({ method: 'GET' })
  .validator(parseFilters)
  .handler(async ({ data }) => {
    const { loadBoard } = await import('./data.server')
    return loadBoard(data)
  })
export const fetchDetail = createServerFn({ method: 'GET' })
  .validator((input: { id: string; period?: unknown }) => {
    if (typeof input.id !== 'string' || !/^\d{1,30}$/.test(input.id))
      throw new Error('Invalid Twitch ID')
    return { id: input.id, period: parsePeriod(input.period) }
  })
  .handler(async ({ data }) => {
    const { loadDetail } = await import('./data.server')
    return loadDetail(data.id, data.period)
  })
export const fetchStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { loadStatus } = await import('./data.server')
    return loadStatus()
  },
)
