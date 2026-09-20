"use client";
import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useAdminStreamers } from "./use-admin-streamers";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Avatar } from "./dashboard-ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Match = FunctionReturnType<typeof api.admin.matchParticipants>;
type Player = Match["players"][number];
type Streamer = FunctionReturnType<typeof api.admin.streamers>["page"][number];
export function errorMessage(error: unknown) {
  return error instanceof ConvexError && typeof error.data === "string"
    ? error.data
    : "処理できませんでした。時間をおいてもう一度お試しください。";
}
export function profileUrl(accountId: number) {
  return `https://steamcommunity.com/profiles/${BigInt(accountId) + BigInt("76561197960265728")}`;
}
export function AdminMatchRegistration({
  onLinked,
}: {
  onLinked?: () => void;
}) {
  const lookup = useAction(api.admin.matchParticipants);
  const [input, setInput] = useState("");
  const [match, setMatch] = useState<Match | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [notice, setNotice] = useState("");
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-labelledby="match-registration-title"
    >
      <h2 id="match-registration-title" className="font-semibold">
        マッチIDから登録
      </h2>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          setMatch(null);
          setNotice("");
          try {
            setMatch(await lookup({ matchId: input.trim() }));
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="match-id" className="sr-only">
          マッチID
        </label>
        <Input
          id="match-id"
          placeholder="マッチID"
          inputMode="numeric"
          pattern="[0-9]+"
          maxLength={16}
          required
          value={input}
          disabled={pending}
          onChange={(event) => {
            setInput(event.target.value);
            setMatch(null);
            setError("");
            setNotice("");
          }}
          className="max-w-sm"
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !input.trim()}
        >
          {pending ? "取得中…" : "参加者を表示"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {pending ? "試合データを取得しています…" : notice}
      </p>
      {match && (
        <>
          <p className="text-sm text-muted-foreground">
            マッチ {match.matchId} · {match.players.length}人
          </p>
          {match.partial && (
            <p className="text-xs text-muted-foreground">
              一部の名前・ヒーロー情報を取得できませんでした。
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {match.players.map((p) => (
              <div
                key={p.accountId}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <Avatar name={p.heroName} url={p.heroImage} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{p.heroName}</p>
                  <a
                    href={profileUrl(p.accountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-muted-foreground hover:underline"
                    title={p.name}
                  >
                    {p.name}
                  </a>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPlayer(p)}
                  aria-label={`${p.name}（${p.heroName}）に配信者を紐付け`}
                >
                  紐付け
                </Button>
              </div>
            ))}
          </div>
        </>
      )}
      {player && (
        <StreamerPicker
          player={player}
          onClose={() => setPlayer(null)}
          onSaved={(name) => {
            setNotice(
              `${name}に ${player.name}（${player.heroName}）を登録しました。`,
            );
            setPlayer(null);
            onLinked?.();
          }}
        />
      )}
    </section>
  );
}
export function StreamerPicker({
  player,
  onClose,
  onSaved,
}: {
  player: { accountId: number; name: string; heroName?: string };
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [input, setInput] = useState("");
  const [selected, setSelected] = useState<Streamer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const {
    results,
    status,
    error: loadError,
    searchFor,
    refresh,
    loadMore,
  } = useAdminStreamers(20);
  const link = useMutation(api.admin.link);
  const replacing =
    selected?.deadlockRank &&
    selected.deadlockRank.accountId !== player.accountId;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[90dvh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>紐付ける配信者を選択</DialogTitle>
          <DialogDescription>
            {player.name}
            {player.heroName ? ` · ${player.heroName}` : ""}
          </DialogDescription>
        </DialogHeader>
        <a
          href={profileUrl(player.accountId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline"
        >
          Steamプロフィールを確認 ↗
        </a>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void searchFor(input.trim());
            setSelected(null);
            setError("");
          }}
        >
          <label htmlFor="match-streamer-search" className="sr-only">
            紐付ける配信者名
          </label>
          <Input
            id="match-streamer-search"
            placeholder="配信者名で検索"
            value={input}
            maxLength={100}
            disabled={pending}
            onChange={(event) => setInput(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={pending}>
            検索
          </Button>
        </form>
        <div
          className="max-h-64 overflow-y-auto rounded-md border"
          aria-label="配信者の候補"
        >
          {results.map((row) => (
            <button
              key={row.twitchId}
              type="button"
              disabled={pending}
              aria-pressed={selected?.twitchId === row.twitchId}
              onClick={() => {
                setSelected(row);
                setError("");
              }}
              className={`flex w-full items-center gap-3 border-b p-3 text-left text-sm last:border-0 hover:bg-muted disabled:opacity-50 ${selected?.twitchId === row.twitchId ? "bg-muted ring-1 ring-inset ring-ring" : ""}`}
            >
              <Avatar name={row.displayName} url={row.profileImageUrl} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {row.displayName}
                </span>
                <span className="text-xs text-muted-foreground">
                  @{row.login}
                  {row.deadlockRank ? " · Steam登録済み" : ""}
                </span>
              </span>
              {selected?.twitchId === row.twitchId && (
                <span aria-hidden="true">✓</span>
              )}
            </button>
          ))}
          {status === "LoadingFirstPage" ? (
            <p role="status" className="p-4 text-sm">
              読み込み中…
            </p>
          ) : (
            !loadError &&
            !results.length && (
              <p className="p-4 text-sm text-muted-foreground">
                配信者が見つかりません。
              </p>
            )
          )}
          {(status === "CanLoadMore" || status === "LoadingMore") && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={pending || status === "LoadingMore"}
              onClick={() => void loadMore()}
            >
              {status === "LoadingMore" ? "読み込み中…" : "さらに表示"}
            </Button>
          )}
        </div>
        {loadError && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setSelected(null);
                void refresh();
              }}
            >
              再試行
            </Button>
          </div>
        )}
        {selected && (
          <p className="text-sm">
            {selected.displayName} に {player.name} を紐付けます。
            {replacing && (
              <span className="mt-1 block text-muted-foreground">
                登録済みのSteamアカウントを変更します。
              </span>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
          <Button
            disabled={!selected || pending}
            onClick={async () => {
              if (!selected || pending) return;
              setPending(true);
              setError("");
              try {
                await link({
                  twitchId: selected.twitchId,
                  steamAccount: String(player.accountId),
                });
                onSaved(selected.displayName);
              } catch (error) {
                setError(errorMessage(error));
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "保存中…" : replacing ? "変更して保存" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
