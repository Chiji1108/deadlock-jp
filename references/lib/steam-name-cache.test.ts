import { expect, test, vi } from "vitest";
import { SteamNameCache } from "./steam-name-cache";
test("additional pages fetch only uncached names; expiry refreshes names", async () => {
  const cache = new SteamNameCache();
  let now = 1000;
  const fetch = vi.fn(async (ids: number[]) =>
    ids.map((accountId) => ({ accountId, name: `name${accountId}` })),
  );
  await cache.load([1], fetch, () => now);
  expect(await cache.load([1, 2], fetch, () => now)).toEqual({
    1: "name1",
    2: "name2",
  });
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([[1], [2]]);
  now += 600_000;
  await cache.load([1, 2], fetch, () => now);
  expect(fetch.mock.calls[2][0]).toEqual([1, 2]);
});
test("overlapping requests share in-flight lookups and failed refresh retains names", async () => {
  const cache = new SteamNameCache();
  let now = 1000;
  const fetch = vi.fn(async (ids: number[]) =>
    ids.map((accountId) => ({ accountId, name: "name" })),
  );
  await Promise.all([
    cache.load([1], fetch, () => now),
    cache.load([1, 2], fetch, () => now),
  ]);
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([[1], [2]]);
  now += 600_000;
  const fail = vi.fn(async () => {
    throw new Error("429");
  });
  expect(await cache.load([1], fail, () => now)).toEqual({ 1: "name" });
  await cache.load([1], fail, () => now);
  expect(fail).toHaveBeenCalledTimes(1);
  now += 60_000;
  await cache.load([1], fetch, () => now);
  expect(fetch).toHaveBeenCalledTimes(3);
});
test("batches at fifty and caches missing profiles briefly", async () => {
  const cache = new SteamNameCache();
  const ids = Array.from({ length: 101 }, (_, i) => i + 1);
  const fetch = vi.fn(async () => []);
  await cache.load(ids, fetch, () => 1000);
  await cache.load(ids, fetch, () => 1000);
  expect(fetch).toHaveBeenCalledTimes(3);
});
