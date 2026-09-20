"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { heatmapCellClass, heatmapLevels } from "./heatmap-styles";
import { number } from "./dashboard-ui";
import { heatmapDays } from "@/lib/period-availability";
import type { StreamerData } from "./streamer-detail";

const weekdays = ["月", "火", "水", "木", "金", "土", "日"];

export function StreamingHoursHeatmap({
  cells,
  observedAt,
}: {
  cells: StreamerData["heatmap"];
  observedAt: number | null;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = cells.find(
    (cell) => `${cell.weekday}-${cell.hour}` === selectedKey,
  );
  const label = (cell: StreamerData["heatmap"][number]) =>
    `${weekdays[cell.weekday]}曜 ${cell.hour}〜${cell.hour + 1}時：${cell.availableSeconds > 0 ? `観測割合 ${number(cell.fraction * 100, 1)}%` : "観測データなし"}`;
  return (
    <section
      className="flex min-w-0 flex-col gap-3"
      aria-labelledby="streaming-hours-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="streaming-hours-title" className="text-base font-semibold">
          配信している時間帯
        </h2>
        <span className="text-xs text-muted-foreground">
          直近{heatmapDays(observedAt)}日間
        </span>
      </div>
      <Card className="min-w-0">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-start">
          <div
            className="min-w-0 overflow-x-auto pt-1"
            tabIndex={0}
            role="region"
            aria-label="曜日と時間帯のヒートマップ（横にスクロールできます）"
          >
            <div className="w-max">
              <div
                className="ml-8 grid h-[18px] grid-cols-[repeat(24,16px)] gap-1"
                aria-hidden="true"
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <span
                    key={hour}
                    className="whitespace-nowrap text-xs text-muted-foreground"
                  >
                    {hour % 3 === 0 ? `${hour}時` : ""}
                  </span>
                ))}
              </div>
              <div
                className="flex flex-col gap-1"
                role="group"
                aria-label="曜日別の配信時間帯"
              >
                {weekdays.map((day, weekday) => (
                  <div key={day} className="flex items-center gap-2">
                    <span
                      className="w-6 shrink-0 text-right text-xs text-muted-foreground"
                      aria-hidden="true"
                    >
                      {day}
                    </span>
                    <div className="grid grid-cols-[repeat(24,16px)] gap-1">
                      {cells
                        .filter((cell) => cell.weekday === weekday)
                        .map((cell) => {
                          const level =
                            cell.fraction <= 0
                              ? 0
                              : cell.fraction <= 0.25
                                ? 1
                                : cell.fraction <= 0.5
                                  ? 2
                                  : cell.fraction <= 0.75
                                    ? 3
                                    : 4;
                          return (
                            <Tooltip key={cell.hour}>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className={cn(
                                    "size-4",
                                    heatmapCellClass,
                                    heatmapLevels[level],
                                  )}
                                  aria-label={label(cell)}
                                  onClick={() =>
                                    setSelectedKey(
                                      `${cell.weekday}-${cell.hour}`,
                                    )
                                  }
                                />
                              </TooltipTrigger>
                              <TooltipContent>{label(cell)}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 md:pt-1">
            <p className="text-xs text-muted-foreground">
              少ない <span aria-hidden="true">→</span> 多い
            </p>
            <div className="flex gap-1" aria-hidden="true">
              {heatmapLevels.map((level) => (
                <span
                  key={level}
                  className={cn("size-4 rounded-[3px]", level)}
                />
              ))}
            </div>
          </div>
        </CardContent>
        {selected && (
          <CardFooter className="mt-auto">
            <div aria-live="polite" className="text-sm">
              {label(selected)}
            </div>
          </CardFooter>
        )}
      </Card>
    </section>
  );
}
