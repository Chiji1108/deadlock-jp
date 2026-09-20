import { env } from 'cloudflare:workers'
import { createDb } from 'db'
import { getDetail, getRanking, getStatus } from 'db/queries'
import type { Filters, Period } from 'db/types'

export const loadBoard = (filters: Filters) =>
  getRanking(createDb(env.DB), filters)
export const loadDetail = (id: string, period: Period) =>
  getDetail(createDb(env.DB), id, Date.now(), period)
export const loadStatus = () => getStatus(createDb(env.DB))
