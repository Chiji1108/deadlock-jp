import { useEffect } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'

/** Revalidate page loaders without navigating or replacing the SSR document. */
export function useAutoRefresh() {
  const router = useRouter()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  useEffect(() => {
    if (pathname !== '/' && !/^\/streamers\/\d+\/?$/.test(pathname)) return

    let disposed = false
    let running = false
    async function refresh() {
      if (
        disposed ||
        running ||
        document.visibilityState !== 'visible' ||
        !navigator.onLine ||
        router.state.isLoading
      )
        return

      running = true
      try {
        await router.invalidate({ sync: true })
      } catch {
        // The route error UI handles failures; the next tick retries.
      } finally {
        running = false
      }
    }

    const timer = window.setInterval(() => void refresh(), 60_000)
    const onResume = () => void refresh()
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('online', onResume)
    return () => {
      disposed = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('online', onResume)
    }
  }, [router, pathname])
}
