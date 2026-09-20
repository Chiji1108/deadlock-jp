import { useRef, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { resetMeasurementData } from '@/server/reset.functions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel } from '@/components/ui/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'

export function ResetMeasurements({
  measurementStartedAt,
}: {
  measurementStartedAt: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [expectedStart, setExpectedStart] = useState(measurementStartedAt)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)

  async function reset() {
    if (submitting.current || confirmation !== 'リセット') return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      await resetMeasurementData({ data: { confirmation, expectedStart } })
      setOpen(false)
      setComplete(true)
      // A refresh failure must not turn a successful destructive operation into
      // a retry prompt. Replaying the old generation is also rejected server-side.
      try {
        await router.invalidate({ sync: true })
      } catch {
        setError('リセットは完了しました。画面を再読み込みしてください。')
      }
    } catch {
      setError(
        'リセットできませんでした。画面を再読み込みし、ログイン状態と計測開始日時を確認してください。',
      )
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (submitting.current) return
          setOpen(next)
          if (next) {
            setConfirmation('')
            setExpectedStart(measurementStartedAt)
            setError('')
            setComplete(false)
          }
        }}
      >
        <AlertDialogTrigger
          render={<Button variant="destructive" disabled={busy} />}
        >
          計測データをリセット
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              全配信者の計測データをリセットしますか？
            </AlertDialogTitle>
            <AlertDialogDescription>
              配信履歴・集計・ランク・試合情報をすべて削除します。Steam紐付けと管理者アカウントは残ります。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            計測開始日時はリセットした時刻に変わります。次回の収集から計測を再開し、配信者は再び観測された時点で一覧に表示されます。
          </p>
          <Field>
            <FieldLabel htmlFor="reset-confirmation">
              確認のため「リセット」と入力してください
            </FieldLabel>
            <Input
              id="reset-confirmation"
              value={confirmation}
              disabled={busy}
              autoComplete="off"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>キャンセル</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy || confirmation !== 'リセット'}
              onClick={reset}
            >
              {busy && <Spinner data-icon="inline-start" />}
              削除して計測をやり直す
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {complete && (
        <p role="status" className="text-sm text-muted-foreground">
          リセットしました。次回の収集から計測を再開します。
        </p>
      )}
      {!open && error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
