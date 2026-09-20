import { createFileRoute } from '@tanstack/react-router'

async function handler({ request }: { request: Request }) {
  const { getAuth, isAuthConfigured } = await import('@/lib/auth/server')
  if (!isAuthConfigured())
    return Response.json(
      { message: '管理者ログインは未設定です' },
      { status: 503 },
    )
  // Expose only the endpoints needed by the closed administrator login UI.
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, '')
  const allowed =
    request.method === 'GET'
      ? ['/get-session']
      : ['/sign-in/email', '/sign-out']
  if (!allowed.includes(path))
    return Response.json({ message: 'Not found' }, { status: 404 })
  const response = await getAuth().handler(request)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}
export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handler, POST: handler } },
})
