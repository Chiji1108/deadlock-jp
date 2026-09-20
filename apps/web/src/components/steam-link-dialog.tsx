import { useSteamLink } from '@/hooks/use-steam-link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { DeadlockRank } from './deadlock-rank'
import { Avatar } from './dashboard-ui'

const profileUrl = (id: number) =>
  `https://steamcommunity.com/profiles/${BigInt(id) + 76561197960265728n}`
const methods = {
  search: { label: '名前検索', placeholder: 'プレイヤーネーム' },
  match: { label: 'マッチID', placeholder: 'マッチID' },
  direct: {
    label: '直接入力',
    placeholder: 'Steam ID または /profiles/… のURL',
  },
}
export function SteamLinkDialog({
  twitchId,
  linked,
}: {
  twitchId: string
  linked: boolean
}) {
  const {
    open,
    method,
    value,
    candidates,
    preview,
    selected,
    error,
    notice,
    busy,
    request,
    setOpen,
    setMethod,
    setValue,
    back,
    search,
  } = useSteamLink(twitchId)
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="sm" />}>
          {linked ? 'Steam紐付けを変更' : 'Steamを紐付ける'}
        </DialogTrigger>
        <DialogContent
          className="max-h-[85dvh] overflow-y-auto"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>Steamアカウントの紐付け</DialogTitle>
            <DialogDescription>
              候補を選び、プレイヤーネームとランクを確認して保存します。
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={method}
            onValueChange={(next) => setMethod(next as keyof typeof methods)}
          >
            <TabsList className="w-full">
              {Object.entries(methods).map(([key, item]) => (
                <TabsTrigger key={key} value={key} disabled={busy}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value={method} className="flex flex-col gap-3">
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void search()
                }}
              >
                <Field>
                  <FieldLabel htmlFor="steam-link-input">
                    {methods[method].label}
                  </FieldLabel>
                  <Input
                    id="steam-link-input"
                    value={value}
                    maxLength={250}
                    disabled={busy}
                    placeholder={methods[method].placeholder}
                    onChange={(event) => setValue(event.target.value)}
                  />
                  {method === 'direct' && (
                    <FieldDescription>
                      SteamID64・SteamID3・account
                      IDに対応。カスタムURL（/id/…）は非対応です。
                    </FieldDescription>
                  )}
                </Field>
                <Button type="submit" disabled={busy || !value.trim()}>
                  {busy && <Spinner data-icon="inline-start" />}
                  {method === 'direct' ? 'アカウントを確認' : '検索'}
                </Button>
              </form>
              {!preview && error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {candidates && (
                <div className="flex flex-col gap-2" aria-live="polite">
                  {!candidates.length && (
                    <p className="text-sm text-muted-foreground">
                      候補が見つかりませんでした。入力内容や検索方法を変えてお試しください。
                    </p>
                  )}
                  {candidates.map((candidate) => (
                    <Button
                      key={candidate.accountId}
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-3"
                      disabled={busy || !!candidate.linkedTo}
                      onClick={() =>
                        request(
                          'preview',
                          String(candidate.accountId),
                          candidate,
                        )
                      }
                    >
                      <Avatar name={candidate.name} url={candidate.avatar} />
                      <span className="flex min-w-0 flex-col items-start gap-1 text-left">
                        <span className="break-all">{candidate.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ID: {candidate.accountId}
                          {candidate.linkedTo ? ` · ${candidate.linkedTo}` : ''}
                        </span>
                        {candidate.heroName && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            {candidate.heroImage && (
                              <img
                                src={candidate.heroImage}
                                alt=""
                                className="size-6"
                              />
                            )}
                            {candidate.heroName}
                          </span>
                        )}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
          {linked && (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => request('unlink-preview', 'confirm')}
            >
              紐付けを解除
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!preview}
        onOpenChange={(next) => {
          if (!next) back()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preview?.kind === 'unlink-preview'
                ? 'Steamアカウントの紐付けを解除しますか？'
                : 'このSteamアカウントを紐付けますか？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preview?.streamerName} の紐付け先を確認してください。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {preview?.kind === 'unlink-preview' && (
            <div className="flex flex-col gap-3">
              <a
                href={profileUrl(preview.accountId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline underline-offset-4"
              >
                Steamプロフィール · ID: {preview.accountId}
              </a>
              <p className="text-sm text-muted-foreground">
                ランク・試合履歴・総試合時間を削除します。配信履歴と配信集計は残ります。
              </p>
            </div>
          )}
          {preview?.kind === 'preview' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Avatar
                  name={preview.profile.name}
                  url={preview.profile.avatar}
                />
                <span className="break-all font-medium">
                  {preview.profile.name}
                </span>
              </div>
              <a
                href={profileUrl(preview.profile.accountId)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm underline underline-offset-4"
              >
                Steamプロフィール · ID: {preview.profile.accountId}
              </a>
              <DeadlockRank rank={preview.rank} />
              {selected?.heroName && (
                <p className="text-sm">使用キャラ：{selected.heroName}</p>
              )}
              {preview.previousAccountId !== null && (
                <p className="text-sm text-muted-foreground">
                  現在の紐付け先：
                  <a
                    className="underline"
                    href={profileUrl(preview.previousAccountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {preview.previousAccountId}
                  </a>
                  <br />
                  変更すると以前のランク・試合情報は置き換わります。配信集計は残ります。
                </p>
              )}
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={busy} onClick={back}>
              戻る
            </Button>
            <Button
              variant={
                preview?.kind === 'unlink-preview' ? 'destructive' : 'default'
              }
              disabled={busy || !preview}
              onClick={() => preview && request('save', preview.token)}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {preview?.kind === 'unlink-preview'
                ? '紐付けを解除'
                : '紐付けを保存'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </>
  )
}
