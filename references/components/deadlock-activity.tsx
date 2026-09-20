"use client";

import Image from "next/image";
import { useState, type ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { dateTime, number } from "./dashboard-ui";
import type { RankingRow } from "./ranking-board";

type Activity = NonNullable<RankingRow["deadlockActivity"]>;
const outcomes = { win: "勝利", loss: "敗北", unknown: "判定なし" };

// Hover/focus on desktop, tap on touch. Prevent the containing row's navigation.
function ActivityHint({
  label,
  className,
  children,
  hint,
}: {
  label: string;
  className?: string;
  children: ReactNode;
  hint: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            className,
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={5}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-1">{hint}</div>
      </TooltipContent>
    </Tooltip>
  );
}

function MatchPortrait({
  match,
}: {
  match: Activity["recentMatches"][number];
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const result = outcomes[match.outcome];
  const label = `${match.heroName}・${result}・${dateTime(match.startedAt)} JST`;
  return (
    <ActivityHint
      label={label}
      className={cn(
        "relative flex shrink-0 items-end justify-center overflow-hidden border-b-2",
        "h-10 w-full sm:h-11 sm:w-9",
        match.outcome === "win"
          ? "border-match-win bg-match-win/10"
          : match.outcome === "loss"
            ? "border-match-loss bg-match-loss/10"
            : "border-muted-foreground bg-muted",
      )}
      hint={
        <>
          <span>
            {match.heroName} · {result}
          </span>
          <span>{dateTime(match.startedAt)} JST</span>
        </>
      }
    >
      {match.heroImage && failedSrc !== match.heroImage ? (
        <Image
          src={match.heroImage}
          alt=""
          width={36}
          height={44}
          unoptimized
          className="size-full object-cover object-top"
          onError={() => setFailedSrc(match.heroImage)}
        />
      ) : (
        <span className="self-center text-xs text-muted-foreground">
          {match.heroName.slice(0, 2)}
        </span>
      )}
    </ActivityHint>
  );
}

export function DeadlockMatchTime({
  activity,
  plain = false,
}: {
  activity: RankingRow["deadlockActivity"];
  plain?: boolean;
}) {
  if (!activity || activity.matchTimeSeconds === null)
    return plain ? (
      <span className="text-muted-foreground" aria-label="試合時間未取得">
        —
      </span>
    ) : null;
  const hours = number(activity.matchTimeSeconds / 3600, 1);
  return (
    <ActivityHint
      label={`累計試合時間 ${hours}時間 — 最終確認日時`}
      className={cn(
        "w-fit tabular-nums",
        plain
          ? "text-right text-sm"
          : "text-left text-xs text-muted-foreground",
      )}
      hint={
        <>
          {activity.matchTimeUpdatedAt !== null && (
            <span>最終確認 {dateTime(activity.matchTimeUpdatedAt)} JST</span>
          )}
        </>
      }
    >
      {plain ? hours : `累計試合時間 ${hours}時間`}
    </ActivityHint>
  );
}

export function DeadlockActivity({
  activity,
}: {
  activity: RankingRow["deadlockActivity"];
}) {
  if (!activity) return null;
  const matches = activity.recentMatches.slice(0, 20);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">最近の試合</h2>
        <DeadlockMatchTime activity={activity} />
      </div>
      {matches.length ? (
        <>
          <div
            role="group"
            aria-label={`直近${matches.length}戦・左が最新。緑は勝利、赤は敗北。`}
            className="grid grid-cols-10 gap-1 sm:flex sm:flex-wrap"
          >
            {matches.map((match) => (
              <MatchPortrait key={match.matchId} match={match} />
            ))}
          </div>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">
          {activity.status === "pending"
            ? "試合履歴を取得中"
            : "取得できる試合履歴がありません"}
        </span>
      )}
    </div>
  );
}
