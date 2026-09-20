"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SignIn, UserButton, useAuth } from "@clerk/nextjs";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Avatar, LoadingPanel, LiveBadge, useFreshness } from "./dashboard-ui";
import { Switch } from "./ui/switch";
import { AdminHealth } from "./admin-health";
import { useAdminStreamers } from "./use-admin-streamers";
import { SteamNameCache } from "@/lib/steam-name-cache";
import { AdminSteamSearch } from "./admin-steam-search";
import { AdminMatchRegistration } from "./admin-match-registration";
import { DeadlockRank } from "./deadlock-rank";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "./ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "./ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

type AdminRow = FunctionReturnType<typeof api.admin.streamers>["page"][number];
function message(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "保存できませんでした。時間をおいてもう一度お試しください。";
}
export function AdminDashboard() {
  const { isLoaded, isSignedIn } = useAuth();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const access = useQuery(api.admin.access, isAuthenticated ? {} : "skip");
  if (!isLoaded || isLoading) return <LoadingPanel />;
  if (!isSignedIn)
    return (
      <div className="flex flex-col items-center gap-6 py-6">
        <h1 className="text-xl font-semibold">管理者ログイン</h1>
        <SignIn routing="hash" />
      </div>
    );
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">配信者の管理</h1>
        <UserButton />
      </div>
      {!isAuthenticated ? (
        <Alert>
          <AlertTitle>ログインを確認できませんでした</AlertTitle>
          <AlertDescription>
            再読み込みしても続く場合は、一度ログアウトしてからお試しください。
          </AlertDescription>
        </Alert>
      ) : access === undefined ? (
        <LoadingPanel />
      ) : !access.isAdmin ? (
        <Alert>
          <AlertTitle>管理者権限がありません</AlertTitle>
          <AlertDescription>
            <p>このアカウントでは編集できません。</p>
            <p className="break-all">ユーザーID：{access.userId}</p>
          </AlertDescription>
        </Alert>
      ) : (
        <AdminWorkspace />
      )}
    </>
  );
}
function AdminWorkspace() {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const {
    search,
    unlinkedOnly,
    setUnlinkedOnly,
    results,
    status,
    error,
    updatedAt,
    searchFor,
    refresh,
    loadMore,
  } = useAdminStreamers(30, true);
  const getNames = useAction(api.admin.steamPlayerNames);
  const [nameCache] = useState(() => new SteamNameCache());
  const [steamNames, setSteamNames] = useState<Record<number, string>>({});
  const accountIds = JSON.stringify(
    [
      ...new Set(
        results.flatMap((row) =>
          row.deadlockRank ? [row.deadlockRank.accountId] : [],
        ),
      ),
    ].sort((a, b) => a - b),
  );
  useEffect(() => {
    let cancelled = false;
    const ids: number[] = JSON.parse(accountIds);
    async function loadNames() {
      const names = await nameCache.load(ids, (accountIds) =>
        getNames({ accountIds }),
      );
      if (!cancelled) setSteamNames(names);
    }
    void loadNames();
    const timer = setInterval(() => void loadNames(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountIds, getNames, nameCache]);
  const link = useMutation(api.admin.link);
  const unlink = useMutation(api.admin.unlink);
  return (
    <>
      <AdminHealth />
      <AdminSteamSearch onLinked={() => void refresh()} />
      <AdminMatchRegistration onLinked={() => void refresh()} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void searchFor(input.trim());
        }}
      >
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="streamer-search" className="sr-only">
              配信者名で検索
            </FieldLabel>
            <Input
              id="streamer-search"
              className="max-w-sm"
              placeholder="配信者名で検索"
              value={input}
              maxLength={100}
              onChange={(event) => setInput(event.target.value)}
            />
            <Button type="submit" variant="outline">
              検索
            </Button>
            {search && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setInput("");
                  void searchFor("");
                }}
              >
                クリア
              </Button>
            )}
          </Field>
        </FieldGroup>
      </form>
      <label className="flex w-fit items-center gap-2 text-sm">
        <Switch
          checked={unlinkedOnly}
          onCheckedChange={(checked) => void setUnlinkedOnly(checked)}
        />
        Steam未登録のみ
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {updatedAt === null
            ? ""
            : `${new Intl.DateTimeFormat("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Tokyo",
              }).format(updatedAt)} 時点`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={status === "LoadingFirstPage" || status === "LoadingMore"}
          onClick={() => void refresh()}
        >
          更新
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
      {status === "LoadingFirstPage" ? (
        <LoadingPanel />
      ) : error && !results.length ? null : (
        <AdminStreamerList
          rows={results}
          emptyMessage={
            status === "CanLoadMore"
              ? "このページに対象の配信者はいません。「さらに表示」で続きを確認できます。"
              : undefined
          }
          steamNames={steamNames}
          onSave={async (twitchId, steamAccount) => {
            await link({ twitchId, steamAccount });
            setNotice(
              "Steamアカウントを保存しました。ランク取得後は「更新」で確認できます。",
            );
            await refresh();
          }}
          onUnlink={async (twitchId) => {
            await unlink({ twitchId });
            setNotice("紐付けを解除しました。");
            await refresh();
          }}
        />
      )}
      {status !== "Exhausted" && status !== "LoadingFirstPage" && (
        <Button
          className="self-center"
          variant="outline"
          disabled={status !== "CanLoadMore"}
          onClick={() => void loadMore()}
        >
          {status === "LoadingMore" ? "読み込み中…" : "さらに表示"}
        </Button>
      )}
    </>
  );
}
export function AdminStreamerList({
  rows,
  steamNames = {},
  emptyMessage,
  onSave,
  onUnlink,
}: {
  rows: AdminRow[];
  emptyMessage?: string;
  steamNames?: Record<number, string>;
  onSave: (twitchId: string, steamAccount: string) => Promise<void>;
  onUnlink: (twitchId: string) => Promise<void>;
}) {
  if (!rows.length)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "配信者が見つかりません。"}
      </p>
    );
  return (
    <div className="divide-y rounded-lg border">
      {[...rows]
        .sort((a, b) => Number(b.isLive) - Number(a.isLive))
        .map((row) => (
          <div
            key={row.twitchId}
            className="flex flex-wrap items-center justify-between gap-4 p-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={row.displayName} url={row.profileImageUrl} />
              <div className="flex min-w-0 flex-col gap-1">
                <Link
                  className="break-all font-medium hover:underline"
                  href={`/streamers/${row.twitchId}`}
                >
                  {row.displayName}
                </Link>
                <span className="break-all text-xs text-muted-foreground">
                  @{row.login}
                </span>
                <AdminLiveBadge row={row} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {row.deadlockRank ? (
                <div className="flex flex-col items-start gap-1">
                  <a
                    href={`https://steamcommunity.com/profiles/${BigInt(row.deadlockRank.accountId) + BigInt("76561197960265728")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-64 truncate text-sm font-medium hover:underline"
                    title={
                      steamNames[row.deadlockRank.accountId] ??
                      "Steamプレイヤーネーム未取得"
                    }
                  >
                    {steamNames[row.deadlockRank.accountId] ??
                      `Steam ID: ${row.deadlockRank.accountId}`}
                  </a>
                  <DeadlockRank rank={row.deadlockRank} />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">未登録</span>
              )}
              <SteamEditor
                row={row}
                onSave={(value) => onSave(row.twitchId, value)}
              />
              {row.deadlockRank && (
                <UnlinkButton
                  name={row.displayName}
                  onUnlink={() => onUnlink(row.twitchId)}
                />
              )}
            </div>
          </div>
        ))}
    </div>
  );
}
function AdminLiveBadge({ row }: { row: AdminRow }) {
  const fresh = useFreshness(row.lastSeenAt);
  return row.isLive && fresh ? (
    <a
      href={`https://www.twitch.tv/${encodeURIComponent(row.login)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${row.displayName}のライブ配信をTwitchで開く（別タブ）`}
      className="w-fit rounded-full transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <LiveBadge viewers={row.liveViewerCount} startedAt={row.liveStartedAt} />
    </a>
  ) : null;
}
function SteamEditor({
  row,
  onSave,
}: {
  row: AdminRow;
  onSave: (value: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  function changeOpen(next: boolean) {
    if (pending) return;
    if (next) {
      setValue(
        row.deadlockRank
          ? `https://steamcommunity.com/profiles/${BigInt(row.deadlockRank.accountId) + BigInt("76561197960265728")}`
          : "",
      );
      setError("");
    }
    setOpen(next);
  }
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={`${row.displayName}のSteamを${row.deadlockRank ? "変更" : "登録"}`}
        >
          {row.deadlockRank ? "変更" : "Steamを登録"}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>
            Steamアカウントの{row.deadlockRank ? "変更" : "登録"}
          </DialogTitle>
          <DialogDescription>
            {row.displayName}（@{row.login}）
          </DialogDescription>
        </DialogHeader>
        <form
          id={`steam-${row.twitchId}`}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError("");
            try {
              await onSave(value.trim());
              setOpen(false);
            } catch (error) {
              setError(message(error));
            } finally {
              setPending(false);
            }
          }}
        >
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor={`steam-input-${row.twitchId}`}>
                SteamプロフィールURL / ID
              </FieldLabel>
              <Input
                id={`steam-input-${row.twitchId}`}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder="https://steamcommunity.com/profiles/…"
                required
                maxLength={300}
                disabled={pending}
                aria-invalid={!!error}
                aria-describedby={`steam-help-${row.twitchId}`}
              />
              <FieldDescription id={`steam-help-${row.twitchId}`}>
                数値ID付きURL、SteamID64、SteamID3に対応しています。本人のアカウントを確認して登録してください。
              </FieldDescription>
              {error && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            キャンセル
          </Button>
          <Button
            form={`steam-${row.twitchId}`}
            type="submit"
            disabled={pending || !value.trim()}
          >
            {pending ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function UnlinkButton({
  name,
  onUnlink,
}: {
  name: string;
  onUnlink: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
          setError("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${name}のSteam紐付けを解除`}
        >
          解除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Steamの紐付けを解除しますか？</AlertDialogTitle>
          <AlertDialogDescription>
            {name}のランク表示が消えます。配信の記録は残ります。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={async (event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              try {
                await onUnlink();
                setOpen(false);
              } catch (error) {
                setError(message(error));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "解除中…" : "解除する"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
