"use client";

import Image from "next/image";
import { useState } from "react";
import { LiveBadge } from "./dashboard-ui";
import type { StreamerData } from "./streamer-detail";

function PreviewImage({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="flex aspect-video items-center justify-center bg-muted p-4 text-sm text-muted-foreground">
      プレビューを取得できません。Twitchで見る
    </span>
  ) : (
    <Image
      src={src}
      alt={`${name}の配信プレビュー`}
      width={640}
      height={360}
      unoptimized
      className="aspect-video w-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function LivePreview({
  live,
  login,
  name,
}: {
  live: NonNullable<StreamerData["live"]>;
  login: string;
  name: string;
}) {
  // Refresh with successful observations, at most once per five-minute bucket.
  const src = live.thumbnailUrl
    ? `${live.thumbnailUrl}${live.thumbnailUrl.includes("?") ? "&" : "?"}t=${Math.floor(live.lastSeenAt / 300000)}`
    : null;
  return (
    <a
      href={`https://www.twitch.tv/${encodeURIComponent(login)}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name}の配信をTwitchで見る（新しいタブ）`}
      className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:flex-row sm:items-center"
    >
      {src && (
        <div className="w-full shrink-0 overflow-hidden rounded-md sm:w-72">
          <PreviewImage key={src} src={src} name={name} />
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2">
        <LiveBadge viewers={live.viewerCount} startedAt={live.startedAt} />
        <h2 className="break-words text-sm font-medium">
          {live.title}
        </h2>
      </div>
    </a>
  );
}
