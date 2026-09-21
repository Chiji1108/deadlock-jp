'use client'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { dateTime } from './dashboard-ui'
import type { RankingRow } from 'db/types'

const names = [
  'Obscurus',
  'Initiate',
  'Seeker',
  'Acolyte',
  'Sentinel',
  'Mystic',
  'Ritualist',
  'Emissary',
  'Oracle',
  'Phantom',
  'Ascendant',
  'Eternus',
]
export function DeadlockRank({
  rank,
  plain = false,
  render,
}: {
  rank: RankingRow['deadlockRank']
  plain?: boolean
  render?: ReactElement
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!rank) return null
  const label =
    rank.tier === null
      ? rank.unavailable
        ? 'ランク取得不可'
        : 'ランク取得中'
      : rank.tier === 0
        ? names[0]
        : `${names[rank.tier]} ${rank.subrank}`
  const src =
    rank.tier === 0
      ? 'https://assets-bucket.deadlock-api.com/assets-api-res/images/ranks/rank00_lg.webp'
      : rank.tier && rank.subrank
        ? `https://api.deadlock-api.com/v1/assets/ranks/${rank.tier}/${rank.subrank}/image?format=webp`
        : null
  const content = (
    <>
      {src && failedSrc !== src && (
        <img
          src={src}
          alt=""
          width={20}
          height={20}
          onError={() => setFailedSrc(src)}
        />
      )}
      {label}
    </>
  )
  return (
    <Tooltip>
      <TooltipTrigger
        className="inline-flex w-fit rounded-md focus-visible:outline-2 focus-visible:outline-ring"
        render={
          render ?? (
            <a
              href={`https://steamcommunity.com/profiles/${BigInt(rank.accountId) + BigInt('76561197960265728')}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${label} — Steamプロフィール`}
            />
          )
        }
      >
        {plain ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
            {content}
          </span>
        ) : (
          <Badge variant="secondary">{content}</Badge>
        )}
      </TooltipTrigger>
      <TooltipContent>
        {rank.tier === null ? (
          <p>Deadlock APIでランクを確認できていません。</p>
        ) : rank.tier === 0 ? (
          <p>ランク認定中</p>
        ) : null}
        {rank.updatedAt && <p>最終確認 {dateTime(rank.updatedAt)} JST</p>}
      </TooltipContent>
    </Tooltip>
  )
}
