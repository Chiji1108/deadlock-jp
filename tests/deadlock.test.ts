import { expect, test } from "bun:test";
import {
  parseHistory,
  parseMatchTime,
  parseRank,
} from "deadlock/model";
const raw = (id: number, overrides = {}) => ({
  account_id: 123,
  match_id: id,
  start_time: id * 100,
  hero_id: 1,
  game_mode: 1,
  match_mode: 4,
  match_duration_s: 1800,
  player_match_outcome: 1,
  player_team: 0,
  match_result: 0,
  ...overrides,
});
test("normal ranked/unranked history is unique, latest first, bounded to 20", () => {
  const data = [
    ...Array.from({ length: 25 }, (_, i) => raw(i + 1)),
    raw(25),
    raw(50, { game_mode: 2 }),
    raw(51, { match_mode: 2 }),
  ];
  const result = parseHistory(data, 123, [
    { id: 1, name: "インフェルナス", image: null },
  ]);
  expect(result).toHaveLength(20);
  expect(result[0].matchId).toBe(25);
  expect(result.at(-1)?.matchId).toBe(6);
  expect(result[0].outcome).toBe("win");
  expect(() => parseHistory([raw(1, { account_id: 999 })], 123, [])).toThrow();
});
test("match-time distinguishes missing data from real zero and rejects duplicates", () => {
  expect(parseMatchTime([], 123)).toBeNull();
  expect(
    parseMatchTime([{ account_id: 123, hero_id: 1, time_played: 0 }], 123),
  ).toBe(0);
  expect(
    parseMatchTime(
      [
        { account_id: 123, hero_id: 1, time_played: 300 },
        { account_id: 123, hero_id: 2, time_played: 500 },
      ],
      123,
    ),
  ).toBe(800);
  expect(() =>
    parseMatchTime(
      [
        { account_id: 123, hero_id: 1, time_played: 300 },
        { account_id: 123, hero_id: 1, time_played: 500 },
      ],
      123,
    ),
  ).toThrow();
});
test("rank badge must match its tier and subrank", () => {
  expect(parseRank({ rank: 0, subrank: 0, badge: 0 })).toEqual({
    tier: 0,
    subrank: 0,
  });
  expect(parseRank({ rank: 11, subrank: 6, badge: 116 })).toEqual({
    tier: 11,
    subrank: 6,
  });
  expect(() => parseRank({ rank: 11, subrank: 7, badge: 117 })).toThrow();
});
