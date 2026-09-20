"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { Avatar } from "./dashboard-ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  StreamerPicker,
  errorMessage,
  profileUrl,
} from "./admin-match-registration";

type Profile = FunctionReturnType<typeof api.admin.searchSteam>[number];
export function AdminSteamSearch({ onLinked }: { onLinked?: () => void }) {
  const search = useAction(api.admin.searchSteam);
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Profile[] | null>(null);
  const [selected, setSelected] = useState<Profile | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <section
      className="space-y-4 rounded-lg border p-4"
      aria-labelledby="steam-search-title"
    >
      <h2 id="steam-search-title" className="font-semibold">
        Steamの名前から登録
      </h2>
      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setResults(null);
          setError("");
          setNotice("");
          try {
            setResults(await search({ search: input.trim() }));
          } catch (error) {
            setError(errorMessage(error));
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="steam-name-search" className="sr-only">
          Steamのプロフィール名
        </label>
        <Input
          id="steam-name-search"
          placeholder="Steamのプロフィール名"
          maxLength={100}
          required
          className="max-w-sm"
          value={input}
          disabled={pending}
          onChange={(event) => {
            setInput(event.target.value);
            setResults(null);
            setError("");
            setNotice("");
          }}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={pending || !input.trim()}
        >
          {pending ? "検索中…" : "アカウントを検索"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {pending
          ? "Steamアカウントを検索しています…"
          : notice ||
            (results?.length === 0
              ? "該当するアカウントが見つかりません。別の名前かSteam IDでお試しください。"
              : "")}
      </p>
      {results && results.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">
            候補 {results.length}件 ·
            同名のアカウントはプロフィールを確認してください。
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {results.map((profile) => (
              <div
                key={profile.accountId}
                className="flex items-center gap-3 rounded-md border p-3"
              >
                <Avatar name={profile.name} url={profile.avatar} />
                <div className="min-w-0 flex-1">
                  <a
                    href={profileUrl(profile.accountId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:underline"
                    title={profile.name}
                  >
                    {profile.name} ↗
                  </a>
                  <p className="text-xs text-muted-foreground">
                    Steam ID: {profile.accountId}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`${profile.name}（${profile.accountId}）に配信者を紐付け`}
                  onClick={() => setSelected(profile)}
                >
                  紐付け
                </Button>
              </div>
            ))}
          </div>
          {results.length === 20 && (
            <p className="text-xs text-muted-foreground">
              上位20件を表示しています。見つからない場合は名前を詳しく入力してください。
            </p>
          )}
        </>
      )}
      {selected && (
        <StreamerPicker
          player={selected}
          onClose={() => setSelected(null)}
          onSaved={(name) => {
            setNotice(`${name}に ${selected.name} を登録しました。`);
            setSelected(null);
            onLinked?.();
          }}
        />
      )}
    </section>
  );
}
