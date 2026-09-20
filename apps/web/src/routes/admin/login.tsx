import {
  createFileRoute,
  getRouteApi,
  Link,
  useRouter,
} from '@tanstack/react-router'
import { AuthProvider } from '@/components/auth/auth-provider'
import { QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { fetchAdmin } from '@/server/auth.functions'
import { ResetMeasurements } from '@/components/reset-measurements'
import { Separator } from '@/components/ui/separator'
import { SignIn } from '@/components/auth/sign-in'
import { Toaster } from '@/components/ui/sonner'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/admin/login')({
  loader: () => fetchAdmin(),
  head: () => ({
    meta: [
      { title: '管理者ログイン | Deadlock' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: AdminLogin,
})
function AdminLogin() {
  const { configured, admin } = Route.useLoaderData()
  const router = useRouter()
  const { measurementStartedAt } = getRouteApi('__root__').useLoaderData()
  // A separate client for each mounted auth screen, never shared across SSR requests.
  const [queryClient] = useState(() => new QueryClient())
  const [busy, setBusy] = useState(false)
  async function logout() {
    setBusy(true)
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error('logout')
      queryClient.clear()
      await router.invalidate({ sync: true })
    } catch {
      toast.error('ログアウトできませんでした。再度お試しください。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="sr-only">管理者ログイン</h1>
      <Toaster />
      {!configured ? (
        <Card>
          <CardHeader>
            <CardTitle>管理者ログイン</CardTitle>
          </CardHeader>
          <CardContent>ログインはまだ利用できません。</CardContent>
        </Card>
      ) : admin ? (
        <Card>
          <CardHeader>
            <CardTitle>管理者としてログイン中</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{admin.email}</p>
            <Link
              to="/"
              search={{ sort: 'live', live: false, page: 1 }}
              className={buttonVariants()}
            >
              配信者一覧へ
            </Link>
            <Button variant="outline" disabled={busy} onClick={logout}>
              ログアウト
            </Button>
            <Separator />
            <ResetMeasurements measurementStartedAt={measurementStartedAt} />
          </CardContent>
        </Card>
      ) : (
        <AuthProvider
          Link={({ href, ...props }) => <Link to={href} {...props} />}
          authClient={authClient}
          queryClient={queryClient}
          redirectTo="/admin/login"
          basePaths={{ auth: '/admin' }}
          emailAndPassword={{
            enabled: true,
            forgotPassword: false,
            rememberMe: false,
            minPasswordLength: 15,
          }}
          socialProviders={[]}
          navigate={() => {
            void router.invalidate({ sync: true })
          }}
          localization={{
            auth: {
              signIn: '管理者ログイン',
              email: 'メールアドレス',
              emailPlaceholder: 'you@example.com',
              password: 'パスワード',
              passwordPlaceholder: 'パスワードを入力',
              showPassword: 'パスワードを表示',
              hidePassword: 'パスワードを隠す',
              invalidEmail: 'メールアドレスを確認してください',
              fieldRequired: '入力してください',
              tooShort: '{min}文字以上で入力してください',
              tooLong: '{max}文字以内で入力してください',
            },
            errors: {
              generic:
                'ログインできませんでした。時間をおいて再度お試しください。',
              invalidCredentials: 'メールアドレスまたはパスワードが違います。',
              rateLimited:
                '試行回数が多すぎます。しばらく待ってからお試しください。',
              permissionDenied: '管理者権限がありません。',
            },
          }}
        >
          <SignIn />
        </AuthProvider>
      )}
    </div>
  )
}
