"use client";
import { DeadlockRank } from "./deadlock-rank";
import { DeadlockMatchTime } from "./deadlock-activity";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import {
  Avatar,
  CollectionNotice,
  LiveBadge,
  LoadingPanel,
  PeriodPicker,
  number,
  useFilters,
  useFreshness,
  type Period,
} from "./dashboard-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@/components/ui/empty";

export type RankingRow = FunctionReturnType<
  typeof api.dashboard.ranking
>["page"][number];
type Sort =
  | "live"
  | "duration"
  | "viewers"
  | "watched"
  | "peak"
  | "rank"
  | "rankAsc"
  | "matchTime";
const sorts = [
  { key: "duration", label: "合計配信時間" },
  { key: "viewers", label: "平均視聴者" },
  { key: "peak", label: "ピーク視聴者" },
  { key: "watched", label: "総視聴時間" },
] as const;

export function RankingTable({
  rows,
  period,
  sort,
  onSort,
  fresh,
}: {
  rows: RankingRow[];
  period: Period;
  sort: Sort;
  onSort: (sort: Sort) => void;
  fresh: boolean;
}) {
  const router = useRouter();
  return (
    <Table>
      <TableCaption className="sr-only">日本語Deadlock配信者一覧</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>配信者</TableHead>
          <TableHead
            aria-sort={
              sort === "rank"
                ? "descending"
                : sort === "rankAsc"
                  ? "ascending"
                  : "none"
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSort(sort === "rank" ? "rankAsc" : "rank")}
              aria-label={`ランクの${sort === "rank" ? "低い" : "高い"}順に並べ替え`}
            >
              ランク
              {sort === "rank" ? (
                <ArrowDown data-icon="inline-end" />
              ) : sort === "rankAsc" ? (
                <ArrowUp data-icon="inline-end" />
              ) : (
                <ArrowUpDown data-icon="inline-end" />
              )}
            </Button>
          </TableHead>
          <TableHead
            className="text-right"
            aria-sort={sort === "matchTime" ? "descending" : "none"}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSort("matchTime")}
              aria-label="累計試合時間の多い順に並べ替え"
            >
              累計試合時間
              {sort === "matchTime" ? (
                <ArrowDown data-icon="inline-end" />
              ) : (
                <ArrowUpDown data-icon="inline-end" />
              )}
            </Button>
          </TableHead>
          {sorts.map((item) => (
            <TableHead
              key={item.key}
              className="text-right"
              aria-sort={sort === item.key ? "descending" : "none"}
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSort(item.key)}
                aria-label={`${item.label}の多い順に並べ替え`}
              >
                {item.label}
                {sort === item.key ? (
                  <ArrowDown data-icon="inline-end" />
                ) : (
                  <ArrowUpDown data-icon="inline-end" />
                )}
              </Button>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.twitchId}
            className="cursor-pointer focus-within:bg-muted/50"
            onClick={(event) => {
              if (
                (event.target as HTMLElement).closest("a, button") ||
                window.getSelection()?.toString()
              )
                return;
              const href = `/streamers/${row.twitchId}?period=${period}`;
              if (event.metaKey || event.ctrlKey)
                window.open(href, "_blank", "noopener,noreferrer");
              else router.push(href);
            }}
          >
            <TableCell>
              <div className="flex min-w-40 items-center gap-3 py-1">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={row.displayName} url={row.profileImageUrl} />
                  <div className="flex min-w-0 max-w-60 flex-col gap-1 sm:max-w-96">
                    <Link
                      className="max-w-52 truncate font-medium hover:underline"
                      href={`/streamers/${row.twitchId}?period=${period}`}
                    >
                      {row.displayName}
                    </Link>
                    {fresh && row.isLive && (
                      <LiveBadge
                        viewers={row.liveViewerCount}
                        startedAt={row.liveStartedAt}
                      />
                    )}
                  </div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              {row.deadlockRank ? (
                <DeadlockRank rank={row.deadlockRank} plain />
              ) : (
                <span
                  className="text-muted-foreground"
                  aria-label="ランク未登録"
                >
                  —
                </span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              <DeadlockMatchTime activity={row.deadlockActivity} plain />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number(row.hoursStreamed, 1)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number(row.averageViewers, 1)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number(row.peakViewers)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {number(row.hoursWatched, 1)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
export function RankingBoard() {
  const { period, search, update } = useFilters();
  const rawSort = search.get("sort");
  const sort: Sort =
    rawSort === "duration" ||
    rawSort === "viewers" ||
    rawSort === "watched" ||
    rawSort === "peak" ||
    rawSort === "rank" ||
    rawSort === "rankAsc" ||
    rawSort === "matchTime"
      ? rawSort
      : "live";
  const liveOnly = search.get("live") === "true";
  const stats = useQuery(api.dashboard.status, {});
  const fresh = useFreshness(stats?.lastCollectedAt);
  const { results, status, loadMore } = usePaginatedQuery(
    api.dashboard.ranking,
    { period, sort, liveOnly },
    { initialNumItems: 30 },
  );
  const rows = liveOnly && !fresh ? [] : results;
  return (
    <>
      <h1 className="sr-only">Deadlock 日本語Twitch配信者ボード</h1>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PeriodPicker
          period={period}
          onChange={(value) => update({ period: value })}
        />
        <FieldGroup className="ml-auto w-32 shrink-0">
          <Field orientation="horizontal">
            <Switch
              id="live-only"
              checked={liveOnly}
              onCheckedChange={(checked) => update({ live: String(checked) })}
            />
            <FieldLabel htmlFor="live-only">配信中のみ</FieldLabel>
          </Field>
        </FieldGroup>
      </div>
      <CollectionNotice />
      {(sort === "rank" || sort === "rankAsc" || sort === "matchTime") &&
      stats?.rankOrderingReady === false ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          {sort === "matchTime"
            ? "試合時間順を準備しています…"
            : "ランク順を準備しています…"}
        </p>
      ) : status === "LoadingFirstPage" ? (
        <LoadingPanel />
      ) : rows.length ? (
        <div className="min-w-0 rounded-lg border">
          <RankingTable
            rows={rows}
            period={period}
            sort={sort}
            onSort={(value) => update({ sort: value })}
            fresh={fresh}
          />
        </div>
      ) : (
        <Empty className="min-h-52 border">
          <EmptyHeader>
            <EmptyTitle>
              {liveOnly
                ? fresh
                  ? "現在、配信中の人はいません"
                  : "配信状況を確認しています"
                : "配信データはまだありません"}
            </EmptyTitle>
            <EmptyDescription>
              {liveOnly
                ? "新しい観測が届くと自動で更新されます。"
                : "日本語のDeadlock配信を観測すると、ここに表示されます。"}
            </EmptyDescription>
          </EmptyHeader>
          {liveOnly && (
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => update({ live: "false" })}
              >
                すべての配信者を見る
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}
      {status !== "Exhausted" && rows.length > 0 && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={status !== "CanLoadMore"}
            onClick={() => loadMore(30)}
          >
            {status === "LoadingMore" ? "読み込み中…" : "さらに表示"}
          </Button>
        </div>
      )}
    </>
  );
}
