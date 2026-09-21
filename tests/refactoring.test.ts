import { expect, test } from "bun:test";
import { testDatabase } from "./d1";
import { collector, streamers } from "../packages/db/src/index";
import { getDetail, getRanking } from "../packages/db/src/queries";
import { parseFilters } from "../packages/db/src/types";
import {
  initialSteamLinkState,
  steamLinkReducer,
} from "../apps/web/src/hooks/steam-link-state";
import type { Preview } from "../apps/web/src/hooks/steam-link-state";

test("ranking excludes history while detail preserves it", async () => {
  const { db, sqlite } = await testDatabase();
  const at = Date.now();
  const matches = [
    {
      matchId: 1,
      heroId: 2,
      heroName: "Hero",
      heroImage: null,
      startedAt: at,
      outcome: "win" as const,
    },
  ];
  await db.insert(collector).values({ id: 1, lastCollectedAt: at });
  await db
    .insert(streamers)
    .values({
      twitchId: "1",
      firstSeenAt: at,
      lastObservedAt: at,
      steamAccountId: 42,
      recentMatches: matches,
      matchTimeSeconds: 3600,
      matchTimeUpdatedAt: at,
    });
  const board = await getRanking(db, parseFilters({}), at);
  expect(board.rows[0].deadlockActivity).toEqual({
    matchTimeSeconds: 3600,
    matchTimeUpdatedAt: at,
  });
  expect(
    (await getDetail(db, "1", at))?.data.deadlockActivity?.recentMatches,
  ).toEqual(matches);
  // Invalid stored JSON proves that ranking does not even select/decode history.
  sqlite.exec("UPDATE streamers SET recent_matches = 'invalid json'");
  expect((await getRanking(db, parseFilters({}), at)).rows.length).toBe(1);
});

const preview: Preview = {
  kind: "unlink-preview",
  token: "token",
  accountId: 42,
  streamerName: "Streamer",
};
test("confirmation survives save failure and returns to editing only when idle", () => {
  let state = steamLinkReducer(initialSteamLinkState, {
    type: "open",
    open: true,
  });
  state = steamLinkReducer(state, { type: "preview", preview, selected: null });
  state = steamLinkReducer(state, {
    type: "start",
    operation: "save",
    clearCandidates: false,
  });
  expect(steamLinkReducer(state, { type: "back" })).toBe(state);
  expect(steamLinkReducer(state, { type: "open", open: true })).toBe(state);
  state = steamLinkReducer(state, { type: "error", error: "retry" });
  state = steamLinkReducer(state, { type: "finish" });
  expect(state.screen).toEqual({ kind: "confirming", preview, selected: null });
  expect(state.error).toBe("retry");
  state = steamLinkReducer(state, { type: "back" });
  expect(state.screen.kind).toBe("editing");
  expect(state.error).toBe("");
});

test("successful save clears confirmation", () => {
  let state = steamLinkReducer(initialSteamLinkState, {
    type: "preview",
    preview,
    selected: null,
  });
  state = steamLinkReducer(state, {
    type: "start",
    operation: "save",
    clearCandidates: false,
  });
  state = steamLinkReducer(state, { type: "saved" });
  state = steamLinkReducer(state, { type: "finish" });
  expect(state.screen).toEqual({ kind: "closed" });
  expect(state.pending).toBeNull();
});
