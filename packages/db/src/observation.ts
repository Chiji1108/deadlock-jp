import type { StreamerRecord } from "./schema";
import { dayStart, MAX_GAP, splitHours } from "./time";
export interface Observation {
  twitchId: string;
  twitchStreamId: string;
  login: string;
  displayName: string;
  title: string;
  viewerCount: number;
  startedAt: number;
  thumbnailUrl: string | null;
}

/** Calculate rollup deltas without performing database writes. */
export function planObservation(
  old: StreamerRecord | null,
  live: Observation | null,
  at: number,
) {
  const id = live?.twitchId ?? old?.twitchId;
  if (!id || (old && old.lastObservedAt >= at)) return null;
  const hadSession = !!old?.sessionId && old.isLive;
  const gap = at - (old?.lastSeenAt ?? at);
  const continued =
    hadSession &&
    live?.twitchStreamId === old!.twitchStreamId &&
    gap <= MAX_GAP;
  const end = hadSession && gap <= MAX_GAP ? at : (old?.lastSeenAt ?? at);
  const seconds = hadSession ? Math.max(0, end - old!.lastSeenAt!) / 1000 : 0,
    viewerSeconds = seconds * (old?.liveViewerCount ?? 0);
  const buckets = new Map<
    number,
    { durationSeconds: number; viewerSeconds: number; peakViewers: number }
  >();
  const hours = hadSession ? [...splitHours(old!.lastSeenAt!, end)] : [];
  for (const part of hours) {
    const bucket = buckets.get(part.day) ?? {
      durationSeconds: 0,
      viewerSeconds: 0,
      peakViewers: 0,
    };
    bucket.durationSeconds += part.seconds;
    bucket.viewerSeconds += part.seconds * old!.liveViewerCount!;
    bucket.peakViewers = Math.max(bucket.peakViewers, old!.liveViewerCount!);
    buckets.set(part.day, bucket);
  }
  const sessionId = live ? (continued ? old!.sessionId! : `${id}:${at}`) : null;
  if (live) {
    const day = buckets.get(dayStart(at)) ?? {
      durationSeconds: 0,
      viewerSeconds: 0,
      peakViewers: 0,
    };
    day.peakViewers = Math.max(day.peakViewers, live.viewerCount);
    buckets.set(dayStart(at), day);
  }
  return {
    id,
    hadSession,
    continued,
    end,
    seconds,
    viewerSeconds,
    buckets,
    hours,
    sessionId,
  };
}
