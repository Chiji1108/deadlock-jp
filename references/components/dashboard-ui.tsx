"use client";
import { useEffect, useState } from "react";
import { useConvexConnectionState, useQuery } from "convex/react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  availablePeriods,
  resolvePeriod,
  MEASUREMENT_START_LABEL,
} from "@/lib/period-availability";
import { api } from "@/convex/_generated/api";
import {
  Avatar as UIAvatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";

export type Period = "week" | "month" | "quarter" | "all";
export const periodLabels: Record<Period, string> = {
  week: "7日間",
  month: "30日間",
  quarter: "90日間",
  all: "累計",
};
export const number = (value: number, digits = 0) =>
  new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits }).format(
    value,
  );
export const dateTime = (value: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);

export function useFilters() {
  const search = useSearchParams();
  const pathname = usePathname();
  const raw = search.get("period");
  const stats = useQuery(api.dashboard.status, {});
  const period = resolvePeriod(raw, stats?.lastCollectedAt);
  useEffect(() => {
    if (stats === undefined || raw === null || raw === period) return;
    const params = new URLSearchParams(search.toString());
    params.set("period", period);
    window.history.replaceState(null, "", `${pathname}?${params}`);
  }, [stats, raw, period, search, pathname]);
  function update(values: Record<string, string>) {
    const params = new URLSearchParams(search.toString());
    Object.entries(values).forEach(([key, value]) => params.set(key, value));
    window.history.pushState(null, "", `${pathname}?${params}`);
  }
  return { period, search, update };
}

export function useFreshness(timestamp: number | null | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  return timestamp != null && now != null && now - timestamp <= 180000;
}

export function PeriodPicker({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  const stats = useQuery(api.dashboard.status, {});
  const choices = availablePeriods(stats?.lastCollectedAt);
  if (choices.length === 1)
    return (
      <span className="text-xs text-muted-foreground">
        {MEASUREMENT_START_LABEL}
      </span>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        value={period}
        onValueChange={(value) => {
          if (value) onChange(value as Period);
        }}
        aria-label="集計期間"
      >
        {choices.map((value) => (
          <ToggleGroupItem key={value} value={value}>
            {periodLabels[value]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="text-xs text-muted-foreground">
        {MEASUREMENT_START_LABEL}
      </span>
    </div>
  );
}

export function Avatar({
  name,
  url,
  large = false,
}: {
  name: string;
  url: string | null;
  large?: boolean;
}) {
  return (
    <UIAvatar size={large ? "lg" : "default"}>
      <AvatarImage src={url ?? undefined} alt="" referrerPolicy="no-referrer" />
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </UIAvatar>
  );
}
export function LoadingPanel() {
  return (
    <div role="status" className="flex flex-col gap-4 py-4">
      <span className="sr-only">配信データを読み込んでいます</span>
      <Skeleton className="h-8 w-40" />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
export function LiveBadge({
  viewers,
  startedAt,
}: {
  viewers?: number | null;
  startedAt?: number | null;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, []);
  const minutes =
    now != null && startedAt != null
      ? Math.max(0, Math.floor((now - startedAt) / 60000))
      : null;
  return (
    <Badge variant="secondary">
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-destructive"
      />
      LIVE{viewers != null && ` · ${number(viewers)}人`}
      {minutes != null && (
        <span
          className="tabular-nums"
          aria-label={`配信開始から${Math.floor(minutes / 60)}時間${minutes % 60}分`}
        >
          · {Math.floor(minutes / 60)}時間{minutes % 60}分
        </span>
      )}
    </Badge>
  );
}
export function Metric({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {note && <CardDescription>{note}</CardDescription>}
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {value}
          {unit && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {unit}
            </span>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
export function ConnectionStatus() {
  const status = useQuery(api.dashboard.status, {});
  const connection = useConvexConnectionState();
  const fresh = useFreshness(status?.lastCollectedAt);
  const text = !status
    ? "読み込み中"
    : !connection.isWebSocketConnected
      ? "接続中"
      : !status.configured
        ? "収集準備中"
        : fresh
          ? "自動更新中"
          : "更新待ち";
  return <Badge variant="outline">{text}</Badge>;
}
export function CollectionNotice() {
  const status = useQuery(api.dashboard.status, {});
  const fresh = useFreshness(status?.lastCollectedAt);
  const connection = useConvexConnectionState();
  if (!status) return null;
  const text = !connection.isWebSocketConnected
    ? "接続を確認しています。復旧すると自動で最新データを表示します。"
    : !status.configured
      ? "収集の準備中です。データが届くと自動で表示されます。"
      : status.state === "error" || (status.lastCollectedAt && !fresh)
        ? `最新データの取得を待っています。${!fresh ? "LIVE表示を一時停止しています。" : ""}記録済みの集計は閲覧できます。`
        : null;
  return text ? (
    <Alert role="status">
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  ) : null;
}

export function LastObserved() {
  const status = useQuery(api.dashboard.status, {});
  return (
    <span>
      最終観測{" "}
      {status?.lastCollectedAt
        ? `${dateTime(status.lastCollectedAt)} JST`
        : "—"}
    </span>
  );
}
