import { env } from 'cloudflare:workers'
import { createDb } from 'db'
import { getDetail, getRanking, getStatus } from 'db/queries'
import type { Filters } from 'db/types'

export const loadBoard = (filters: Filters) =>
  getRanking(createDb(env.DB), filters)
export const loadDetail = (id: string) => getDetail(createDb(env.DB), id)
export const loadStatus = () => getStatus(createDb(env.DB))
