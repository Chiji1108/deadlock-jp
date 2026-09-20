"use client";
import { useEffect, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { dayStart } from "@/convex/time";
import { Button } from "./ui/button";

const dateTime = (at: number | null) =>
  at === null
    ? "未取得"
    : new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(at);
function failureLabel(error: string) {
  if (error === "http_429") return "アクセス制限";
  if (error === "network_error") return "通信失敗";
  if (error === "invalid_response") return "応答形式の異常";
  if (error.startsWith("http_5")) return "API側のエラー";
  return "API取得失敗";
}
function HealthDetails() {
  const summary = useQuery(api.admin.collectionHealth, {});
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.rankHealth,
    {},
    { initialNumItems: 30 },
  );
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  const today = now === null ? null : dayStart(now);
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p role="status">
        日次集計：
        {summary === undefined
          ? "読み込み中…"
          : !summary
            ? "開始待ち"
            : today !== null && summary.day < today
              ? "本日分の更新待ち"
              : summary.complete
                ? `完了（${summary.processed}人・${dateTime(summary.completedAt)} JST）`
                : `${now !== null && now - summary.updatedAt >= 600_000 ? "10分以上進捗なし" : "更新中"}（${summary.processed}人・最終進捗 ${dateTime(summary.updatedAt)} JST）`}
      </p>
      <p className="text-muted-foreground">ランク更新（次回試行の早い順）</p>
      {status === "LoadingFirstPage" ? (
        <p>読み込み中…</p>
      ) : !results.length ? (
        <p>登録アカウントはありません。</p>
      ) : (
        <ul className="divide-y">
          {results.map((row) => {
            const stale =
              now !== null &&
              row.updatedAt !== null &&
              now - row.updatedAt >= 86_400_000;
            const label = row.lastError
              ? `${failureLabel(row.lastError)}・連続${row.failureCount}回`
              : row.unavailable
                ? "取得不可"
                : row.updatedAt === null
                  ? "取得待ち"
                  : stale
                    ? "24時間以上更新なし"
                    : "正常";
            return (
              <li key={row.twitchId} className="py-2">
                <div className="flex flex-wrap justify-between gap-x-4">
                  <span>{row.displayName}</span>
                  <span
                    className={
                      row.lastError || row.unavailable || stale
                        ? "text-destructive"
                        : "text-muted-foreground"
                    }
                  >
                    {label}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  最終確認 {dateTime(row.updatedAt)}
                  {stale ? "（24時間以上前）" : ""} · 最終試行{" "}
                  {dateTime(row.lastAttemptAt)} · 次回試行{" "}
                  {dateTime(row.nextRefreshAt)} JST
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {status !== "Exhausted" && status !== "LoadingFirstPage" && (
        <Button
          variant="outline"
          disabled={status !== "CanLoadMore"}
          onClick={() => loadMore(30)}
        >
          さらに表示
        </Button>
      )}
    </div>
  );
}
export function AdminHealth() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="rounded-lg border p-4"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-sm font-medium">更新状況</summary>
      {open && <HealthDetails />}
    </details>
  );
}
