export interface RecentMatch {
  matchId: number;
  heroId: number;
  heroName: string;
  heroImage: string | null;
  startedAt: number;
  outcome: "win" | "loss" | "unknown";
}
export interface Rank {
  accountId: number;
  tier: number | null;
  subrank: number | null;
  unavailable: boolean;
  updatedAt: number | null;
}
export interface Activity {
  recentMatches: RecentMatch[];
  historyUpdatedAt: number | null;
  matchTimeSeconds: number | null;
  matchTimeUpdatedAt: number | null;
  status: "pending" | "ready" | "unavailable";
}
export interface Metrics {
  hoursStreamed: number;
  hoursWatched: number;
  averageViewers: number;
  peakViewers: number;
}
export interface RankingRow extends Metrics {
  twitchId: string;
  login: string;
  displayName: string;
  profileImageUrl: string | null;
  isLive: boolean;
  liveViewerCount: number | null;
  liveStartedAt: number | null;
  deadlockRank: Rank | null;
  deadlockActivity: Activity | null;
}
export interface Status {
  measurementStartedAt: number;
  lastCollectedAt: number | null;
  firstCollectedAt: number | null;
  state: "unconfigured" | "collecting" | "ready" | "error";
  fresh: boolean;
}
export interface Session extends Metrics {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
}
export interface StreamerData {
  streamer: Pick<
    RankingRow,
    "twitchId" | "login" | "displayName" | "profileImageUrl"
  >;
  deadlockRank: Rank | null;
  deadlockActivity: Activity | null;
  isLive: boolean;
  live: {
    title: string;
    viewerCount: number;
    startedAt: number;
    lastSeenAt: number;
    thumbnailUrl: string | null;
  } | null;
  summary: Metrics & { streamingDays: number };
  heatmap: {
    weekday: number;
    hour: number;
    durationSeconds: number;
    availableSeconds: number;
    fraction: number;
  }[];
  heatmapDays: number;
  recentSessions: Session[];
  lastCollectedAt: number | null;
}
export const sorts = [
  "live",
  "duration",
  "viewers",
  "watched",
  "peak",
  "rank",
  "rankAsc",
  "matchTime",
] as const;
export type Sort = (typeof sorts)[number];
export interface Filters {
  sort: Sort;
  live: boolean;
  page: number;
}
export function parseFilters(input: unknown): Filters {
  const v =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const page = Number(v.page);
  return {
    sort: sorts.includes(v.sort as Sort) ? (v.sort as Sort) : "live",
    live: v.live === true || v.live === "true",
    page: Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 10000) : 1,
  };
}
