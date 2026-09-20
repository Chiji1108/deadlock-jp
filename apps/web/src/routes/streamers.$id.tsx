import { createFileRoute, notFound } from '@tanstack/react-router'
import { parsePeriod } from 'db/types'
import { fetchDetail } from '@/server/functions'
import { StreamerDetailView } from '@/components/streamer-detail'
import { CollectionNotice, LoadingPanel } from '@/components/dashboard-ui'

export const Route = createFileRoute('/streamers/$id')({
  validateSearch: (search) => ({ period: parsePeriod(search.period) }),
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps }) => {
    if (!/^\d{1,30}$/.test(params.id)) throw notFound()
    const result = await fetchDetail({
      data: { id: params.id, period: deps.period },
    })
    if (!result) throw notFound()
    return result
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.data.streamer.displayName ?? '配信者'} | Deadlock 日本語Twitch配信者ボード`,
      },
    ],
  }),
  pendingComponent: LoadingPanel,
  component: Detail,
})
function Detail() {
  const { data, status } = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <>
      <CollectionNotice status={status} />
      <StreamerDetailView
        data={data}
        onPeriodChange={(period) => void navigate({ search: { period } })}
        fresh={status.fresh}
        measurementStartedAt={status.measurementStartedAt}
      />
    </>
  )
}
