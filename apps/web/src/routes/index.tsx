import { createFileRoute } from '@tanstack/react-router'
import { parseFilters } from 'db/types'
import { fetchBoard } from '@/server/functions'
import { RankingBoard } from '@/components/ranking-board'
import { LoadingPanel } from '@/components/dashboard-ui'

export const Route = createFileRoute('/')({
  validateSearch: parseFilters,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => fetchBoard({ data: deps }),
  pendingComponent: LoadingPanel,
  component: Board,
})
function Board() {
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()
  return (
    <RankingBoard
      data={data}
      onChange={(search) => void navigate({ search })}
    />
  )
}
