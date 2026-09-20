import { TableAggregate } from "@convex-dev/aggregate";
import { components } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
type DailyAggregate = {
  Namespace: string;
  Key: number;
  DataModel: DataModel;
  TableName: "daily";
};
export const duration = new TableAggregate<DailyAggregate>(
  components.duration,
  {
    namespace: (d) => d.twitchId,
    sortKey: (d) => d.day,
    sumValue: (d) => d.durationSeconds,
  },
);
export const watched = new TableAggregate<DailyAggregate>(components.watched, {
  namespace: (d) => d.twitchId,
  sortKey: (d) => d.day,
  sumValue: (d) => d.viewerSeconds,
});
export const activeDays = new TableAggregate<DailyAggregate>(
  components.activeDays,
  {
    namespace: (d) => d.twitchId,
    sortKey: (d) => d.day,
    sumValue: (d) => (d.durationSeconds > 0 ? 1 : 0),
  },
);
export async function syncDaily(
  ctx: MutationCtx,
  before: Doc<"daily"> | null,
  after: Doc<"daily">,
) {
  for (const aggregate of [duration, watched, activeDays]) {
    if (before) await aggregate.replace(ctx, before, after);
    else await aggregate.insert(ctx, after);
  }
}
