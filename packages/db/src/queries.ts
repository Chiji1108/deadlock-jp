import {
  getTableColumns,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  sql,
} from "drizzle-orm";
import { collector, daily, hourly, sessions, streamers as s } from "./schema";
import type { StreamerRecord } from "./schema";
import type { Database } from "./index";
import {
  DAY,
  HOUR,
  MAX_GAP,
  ORIGINAL_MEASUREMENT_START,
  dayStart,
  heatIndex,
} from "./time";
import { periodStart, resolvePeriod } from "./periods";
import type { Period } from "./types";
import { parseFilters } from "./types";
import type {
  Activity,
  Filters,
  RankingRow,
  Status,
  StreamerData,
} from "./types";
export const PAGE_SIZE = 30;
export const sortColumns = {
  duration: s.durationSeconds,
  viewers: s.averageViewers,
  watched: s.viewerSeconds,
  peak: s.peakViewers,
  rank: s.rankScore,
  rankAsc: s.rankAscScore,
  matchTime: s.matchTimeSeconds,
};
export function metrics(row: {
  durationSeconds: number;
  viewerSeconds: number;
  peakViewers: number;
}) {
  return {
    hoursStreamed: row.durationSeconds / 3600,
    hoursWatched: row.viewerSeconds / 3600,
    averageViewers:
      row.durationSeconds > 0 ? row.viewerSeconds / row.durationSeconds : 0,
    peakViewers: row.peakViewers,
  };
}
function gameData(row: StreamerRecord) {
  const activity: Activity | null =
    row.steamAccountId === null
      ? null
      : {
          recentMatches: row.recentMatches,
          historyUpdatedAt: row.historyUpdatedAt,
          matchTimeSeconds: row.matchTimeSeconds,
          matchTimeUpdatedAt: row.matchTimeUpdatedAt,
          status:
            row.historyUpdatedAt !== null
              ? "ready"
              : row.enrichmentError
                ? "unavailable"
                : row.isLive
                  ? "pending"
                  : "waiting",
        };
  return {
    deadlockRank:
      row.steamAccountId === null
        ? null
        : {
            accountId: row.steamAccountId,
            tier: row.rankTier,
            subrank: row.rankSubrank,
            updatedAt: row.rankUpdatedAt,
            unavailable: row.rankUnavailable,
          },
    deadlockActivity: activity,
  };
}
export async function getStatus(
  db: Database,
  now = Date.now(),
): Promise<Status> {
  const row = await db
    .select()
    .from(collector)
    .where(eq(collector.id, 1))
    .get();
  return {
    measurementStartedAt:
      row?.measurementStartedAt ?? ORIGINAL_MEASUREMENT_START,
    firstCollectedAt: row?.firstCollectedAt ?? null,
    lastCollectedAt: row?.lastCollectedAt ?? null,
    state: row?.state ?? "unconfigured",
    fresh: row?.lastCollectedAt != null && now - row.lastCollectedAt <= MAX_GAP,
  };
}
export function toRankingRow(row: StreamerRecord, fresh: boolean): RankingRow {
  return {
    twitchId: row.twitchId,
    login: row.login,
    displayName: row.displayName,
    profileImageUrl: row.profileImageUrl,
    isLive: fresh && row.isLive,
    liveViewerCount: row.liveViewerCount,
    liveStartedAt: row.liveStartedAt,
    ...metrics(row),
    ...gameData(row),
  };
}
export async function getRanking(
  db: Database,
  input: Filters,
  now = Date.now(),
) {
  const filters = parseFilters(input),
    status = await getStatus(db, now);
  filters.period = resolvePeriod(
    filters.period,
    status.measurementStartedAt,
    status.lastCollectedAt,
  );
  const where = and(
    isNotNull(s.firstSeenAt),
    filters.live ? (status.fresh ? eq(s.isLive, true) : sql`0`) : undefined,
  );
  const total =
    (await db.select({ total: count() }).from(s).where(where).get())?.total ??
    0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE)),
    page = Math.min(filters.page, pageCount);
  const window =
    filters.period === "all"
      ? null
      : db
          .select({
            twitchId: daily.twitchId,
            durationSeconds: sql<number>`sum(${daily.durationSeconds})`.as(
              "period_duration",
            ),
            viewerSeconds: sql<number>`sum(${daily.viewerSeconds})`.as(
              "period_viewers",
            ),
            peakViewers: sql<number>`max(${daily.peakViewers})`.as(
              "period_peak",
            ),
          })
          .from(daily)
          .where(
            and(
              gte(
                daily.day,
                periodStart(filters.period, status.lastCollectedAt!),
              ),
              lte(daily.day, dayStart(status.lastCollectedAt!)),
            ),
          )
          .groupBy(daily.twitchId)
          .as("period_stats");
  const duration = window
    ? sql<number>`coalesce(${window.durationSeconds}, 0)`
    : s.durationSeconds;
  const watched = window
    ? sql<number>`coalesce(${window.viewerSeconds}, 0)`
    : s.viewerSeconds;
  const peak = window
    ? sql<number>`coalesce(${window.peakViewers}, 0)`
    : s.peakViewers;
  const average = window
    ? sql<number>`case when ${duration} > 0 then 1.0 * ${watched} / ${duration} else 0 end`
    : s.averageViewers;
  const columns = { ...sortColumns, duration, watched, peak, viewers: average };
  const order =
    filters.sort === "live"
      ? [
          ...(status.fresh ? [desc(s.isLive)] : []),
          desc(watched),
          asc(s.twitchId),
        ]
      : [desc(columns[filters.sort]), asc(s.twitchId)];
  const query = db
    .select({
      ...getTableColumns(s),
      durationSeconds: duration,
      viewerSeconds: watched,
      peakViewers: peak,
      averageViewers: average,
    })
    .from(s)
    .$dynamic();
  const rows = await (
    window ? query.leftJoin(window, eq(s.twitchId, window.twitchId)) : query
  )
    .where(where)
    .orderBy(...order)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);
  return {
    rows: rows.map((row) => toRankingRow(row, status.fresh)),
    status,
    total,
    page,
    pageCount,
    filters: { ...filters, page },
  };
}
export async function getDetail(
  db: Database,
  twitchId: string,
  now = Date.now(),
  requestedPeriod: Period = "all",
): Promise<{ data: StreamerData; status: Status } | null> {
  if (!/^\d{1,30}$/.test(twitchId)) return null;
  const row = await db
    .select()
    .from(s)
    .where(and(eq(s.twitchId, twitchId), isNotNull(s.firstSeenAt)))
    .get();
  if (!row) return null;
  const status = await getStatus(db, now),
    at = Math.max(row.lastObservedAt, status.lastCollectedAt ?? 0);
  const period = resolvePeriod(
    requestedPeriod,
    status.measurementStartedAt,
    status.lastCollectedAt,
  );
  const from =
    period === "all" ? undefined : periodStart(period, status.lastCollectedAt!);
  const start = Math.max(dayStart(at) - 89 * DAY, row.firstSeenAt!);
  const [days, hours, recent] = await db.batch([
    db
      .select({
        days: sql<number>`sum(case when ${daily.durationSeconds} > 0 then 1 else 0 end)`,
        durationSeconds: sql<number>`coalesce(sum(${daily.durationSeconds}), 0)`,
        viewerSeconds: sql<number>`coalesce(sum(${daily.viewerSeconds}), 0)`,
        peakViewers: sql<number>`coalesce(max(${daily.peakViewers}), 0)`,
      })
      .from(daily)
      .where(
        and(
          eq(daily.twitchId, twitchId),
          from === undefined ? undefined : gte(daily.day, from),
          lte(daily.day, dayStart(at)),
        ),
      ),
    db
      .select()
      .from(hourly)
      .where(
        and(
          eq(hourly.twitchId, twitchId),
          gte(hourly.hour, Math.floor(start / HOUR) * HOUR),
          lte(hourly.hour, at),
        ),
      ),
    db
      .select()
      .from(sessions)
      .where(eq(sessions.twitchId, twitchId))
      .orderBy(desc(sessions.startedAt), asc(sessions.id))
      .limit(20),
  ]);
  const heatmap = Array.from({ length: 168 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    durationSeconds: 0,
    availableSeconds: 0,
    fraction: 0,
  }));
  for (let hour = Math.floor(start / HOUR) * HOUR; hour < at; hour += HOUR)
    heatmap[heatIndex(hour)].availableSeconds +=
      (Math.min(hour + HOUR, at) - Math.max(hour, start)) / 1000;
  for (const h of hours)
    heatmap[heatIndex(h.hour)].durationSeconds += h.durationSeconds;
  for (const cell of heatmap)
    cell.fraction = cell.availableSeconds
      ? Math.min(1, cell.durationSeconds / cell.availableSeconds)
      : 0;
  const isLive = status.fresh && row.isLive;
  return {
    status,
    data: {
      period,
      streamer: {
        twitchId,
        login: row.login,
        displayName: row.displayName,
        profileImageUrl: row.profileImageUrl,
      },
      ...gameData(row),
      isLive,
      live: isLive
        ? {
            title: row.title ?? "",
            viewerCount: row.liveViewerCount ?? 0,
            startedAt: row.liveStartedAt!,
            lastSeenAt: row.lastSeenAt!,
            thumbnailUrl: row.thumbnailUrl,
          }
        : null,
      summary: {
        ...metrics(period === "all" ? row : days[0]!),
        streamingDays: days[0]?.days ?? 0,
      },
      heatmap,
      heatmapDays: Math.max(
        1,
        Math.min(
          90,
          Math.floor(
            (dayStart(at) -
              dayStart(status.firstCollectedAt ?? row.firstSeenAt!)) /
              DAY,
          ) + 1,
        ),
      ),
      recentSessions: recent.map((session) => ({
        id: session.id,
        title: session.title,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        ...metrics(session),
      })),
      lastCollectedAt: status.lastCollectedAt,
    },
  };
}
