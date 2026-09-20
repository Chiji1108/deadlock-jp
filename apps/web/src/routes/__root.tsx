import {
  HeadContent,
  Link,
  Scripts,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { dateTime, LoadingPanel } from '@/components/dashboard-ui'
import { fetchStatus } from '@/server/functions'
import { fetchAdmin } from '@/server/auth.functions'
import { useAutoRefresh } from '@/hooks/use-auto-refresh'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  loader: async () => {
    const [status, auth] = await Promise.all([fetchStatus(), fetchAdmin()])
    return { ...status, admin: auth.admin }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Deadlock 日本語Twitch配信者ボード' },
      {
        name: 'description',
        content:
          '日本語Deadlock配信者の配信時間・視聴者数・配信状況を確認できます。',
      },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
  pendingComponent: LoadingPanel,
  notFoundComponent: () => (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">ページが見つかりません</h1>
      <Link
        to="/"
        search={{ sort: 'live', live: false, page: 1, period: 'all' }}
      >
        配信者一覧へ
      </Link>
    </div>
  ),
  errorComponent: RouteError,
})
function RootDocument({ children }: { children: React.ReactNode }) {
  useAutoRefresh()
  const status = Route.useLoaderData()
  // The document shell also renders when the root loader fails or is pending.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const lastCollectedAt = status?.lastCollectedAt
  return (
    <html lang="ja">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:bg-background focus:p-3"
          >
            本文へ移動
          </a>
          <header className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link
              to="/"
              search={{ sort: 'live', live: false, page: 1, period: 'all' }}
              className="text-sm font-semibold tracking-tight"
            >
              Deadlock 日本語Twitch配信者ボード
            </Link>
            <nav
              aria-label="メインナビゲーション"
              className="flex items-center gap-1"
            >
              {/* The shell can render before the root loader has completed. */}
              {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition */}
              {status?.admin && (
                <Link
                  to="/admin/login"
                  className="text-xs text-muted-foreground"
                >
                  管理者
                </Link>
              )}
              <Button
                nativeButton={false}
                render={<Link to="/about" />}
                variant="ghost"
                size="sm"
              >
                データについて
              </Button>
            </nav>
          </header>
          <Separator />
          <main
            id="main"
            className="mx-auto flex min-h-[calc(100svh-140px)] max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6"
          >
            {children}
          </main>
          <footer className="mx-auto max-w-6xl px-4 pb-6 sm:px-6">
            <Separator />
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <p>
                最終観測{' '}
                {lastCollectedAt ? `${dateTime(lastCollectedAt)} JST` : '—'}
              </p>
              <p>
                ©{' '}
                <a
                  href="https://www.twitch.tv/miri_ch_"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  ミリちゃんねる
                </a>
              </p>
            </div>
          </footer>
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}

function RouteError({ reset }: { reset: () => void }) {
  const router = useRouter()
  return (
    <div className="flex flex-col gap-4" role="alert">
      <h1 className="text-xl font-semibold">データを取得できませんでした</h1>
      <Button
        className="w-fit"
        onClick={async () => {
          await router.invalidate()
          reset()
        }}
      >
        再試行
      </Button>
    </div>
  )
}
