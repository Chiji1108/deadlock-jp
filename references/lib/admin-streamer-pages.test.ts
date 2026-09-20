import { afterEach, expect, test, vi } from "vitest";
import { AdminStreamerPages } from "./admin-streamer-pages";

function page(ids: string[], cursor = "", isDone = true) {
  return {
    page: ids.map((twitchId) => ({
      twitchId,
      login: twitchId,
      displayName: twitchId,
      profileImageUrl: null,
      deadlockRank: null,
      isLive: false,
      lastSeenAt: null,
      liveStartedAt: null,
      liveViewerCount: null,
    })),
    continueCursor: cursor,
    isDone,
  };
}
function deferred() {
  let resolve!: (value: ReturnType<typeof page>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof page>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

test("idle time does not fetch; explicit refresh starts from the first page", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockResolvedValue(page(["1"], "next", false));
  const pages = new AdminStreamerPages(fetch, 30);
  const changed = vi.fn();
  const unsubscribe = pages.subscribe(changed);
  await pages.refresh();
  await vi.advanceTimersByTimeAsync(3_600_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  await pages.loadMore();
  expect(fetch.mock.calls[1][0].paginationOpts.cursor).toBe("next");
  await pages.refresh();
  expect(fetch.mock.calls[2][0]).toEqual({
    search: "",
    paginationOpts: { numItems: 30, cursor: null },
  });
  unsubscribe();
  changed.mockClear();
  await pages.refresh();
  expect(changed).not.toHaveBeenCalled();
});

test("a late page cannot overwrite a new search, including a repeated search", async () => {
  const old = deferred();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1"], "next", false))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page(["Alice"]))
    .mockResolvedValueOnce(page(["Alice-new"]));
  const pages = new AdminStreamerPages(fetch, 20);
  await pages.refresh();
  const pending = pages.loadMore();
  await pages.searchFor("Alice");
  old.resolve(page(["wrong"]));
  await pending;
  expect(pages.getSnapshot().results.map((r) => r.twitchId)).toEqual(["Alice"]);
  await pages.searchFor("Alice");
  expect(pages.getSnapshot().results.map((r) => r.twitchId)).toEqual([
    "Alice-new",
  ]);
  expect(fetch.mock.calls[3][0].paginationOpts.cursor).toBeNull();
});

test("duplicate load clicks fetch once; moving rows are deduplicated", async () => {
  const next = deferred();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1", "2"], "next", false))
    .mockReturnValueOnce(next.promise);
  const pages = new AdminStreamerPages(fetch, 20);
  await pages.refresh();
  const pending = pages.loadMore();
  await pages.loadMore();
  expect(fetch).toHaveBeenCalledTimes(2);
  next.resolve(page(["2", "3"]));
  await pending;
  expect(pages.getSnapshot().results.map((r) => r.twitchId)).toEqual([
    "1",
    "2",
    "3",
  ]);
  await pages.loadMore();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("failed additional pages preserve rows and cursor for retry", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page(["1"], "next", false))
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(page(["2"]));
  const pages = new AdminStreamerPages(fetch, 30);
  await pages.refresh();
  await pages.loadMore();
  expect(pages.getSnapshot().error).toContain("一覧を取得できません");
  expect(pages.getSnapshot().results).toHaveLength(1);
  await pages.loadMore();
  expect(fetch.mock.calls[2][0].paginationOpts.cursor).toBe("next");
  expect(pages.getSnapshot().error).toBe("");
  expect(pages.getSnapshot().results).toHaveLength(2);
});

test("initial failure can be retried; unmounted and superseded errors are ignored", async () => {
  const old = deferred();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page(["new"]));
  const pages = new AdminStreamerPages(fetch, 30);
  await pages.refresh();
  expect(pages.getSnapshot().error).not.toBe("");
  const pending = pages.refresh();
  pages.cancel();
  await pages.refresh();
  old.reject(new Error("late failure"));
  await pending;
  expect(pages.getSnapshot().error).toBe("");
  expect(pages.getSnapshot().results[0].twitchId).toBe("new");
});

test("unlinked filter defaults on when requested, persists through search/refresh, and resets old pages", async () => {
  const old = deferred();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(page([], "next", false))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(page(["all"]));
  const pages = new AdminStreamerPages(fetch, 30, true);
  await pages.refresh();
  expect(fetch.mock.calls[0][0].unlinkedOnly).toBe(true);
  expect(pages.getSnapshot().status).toBe("CanLoadMore");
  const pending = pages.loadMore();
  await pages.setUnlinkedOnly(false);
  old.resolve(page(["stale"]));
  await pending;
  expect(pages.getSnapshot().results.map((r) => r.twitchId)).toEqual(["all"]);
  expect(fetch.mock.calls[2][0].paginationOpts.cursor).toBeNull();
  expect(fetch.mock.calls[2][0].unlinkedOnly).toBeUndefined();
  await pages.setUnlinkedOnly(true);
  await pages.searchFor("Alice");
  await pages.refresh();
  expect(fetch.mock.lastCall?.[0]).toMatchObject({
    search: "Alice",
    unlinkedOnly: true,
  });
});
