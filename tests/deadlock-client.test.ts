import { expect, test } from "bun:test";
import { createDeadlockClient } from "deadlock";

test("typed client sends all four endpoints, credentials and query parameters", async () => {
  const requests: Request[] = [];
  const client = createDeadlockClient("test-key", async (input) => {
    const request = new Request(input);
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/rank"))
      return Response.json({ rank: 11, subrank: 6, badge: 116 });
    if (path.endsWith("/heroes"))
      return Response.json([{ id: 1, name: "インフェルナス", images: {} }]);
    if (path.endsWith("/hero-stats"))
      return Response.json([{ account_id: 123, hero_id: 1, time_played: 300 }]);
    return Response.json([]);
  });
  expect(await client.heroes()).toEqual({
    kind: "ok",
    value: [{ id: 1, name: "インフェルナス", image: null }],
  });
  expect(await client.rank(123)).toEqual({
    kind: "ok",
    value: { tier: 11, subrank: 6 },
  });
  expect(await client.history(123, [])).toEqual({ kind: "ok", value: [] });
  expect(await client.matchTime(123)).toEqual({ kind: "ok", value: 300 });
  expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
    "/v1/assets/heroes",
    "/v1/players/123/rank",
    "/v1/players/123/match-history",
    "/v1/players/hero-stats",
  ]);
  expect(new URL(requests[0].url).searchParams.get("language")).toBe(
    "japanese",
  );
  expect(Object.fromEntries(new URL(requests[3].url).searchParams)).toEqual({
    account_ids: "123",
    game_mode: "normal",
    match_mode: "ranked,unranked",
  });
  for (const request of requests) {
    expect(request.headers.get("X-API-Key")).toBe("test-key");
    expect(request.method).toBe("GET");
    expect(request.signal.aborted).toBe(false);
  }
});

test("HTTP errors preserve status and Retry-After even with non-JSON bodies", async () => {
  for (const status of [403, 404]) {
    const client = createDeadlockClient(
      undefined,
      async () => new Response("<html>unavailable</html>", { status }),
    );
    expect(await client.rank(123)).toEqual({ kind: "unavailable" });
  }
  const retryDate = new Date(Date.now() + 600000).toUTCString();
  const client = createDeadlockClient(
    undefined,
    async () =>
      new Response("busy", {
        status: 429,
        headers: { "Retry-After": retryDate },
      }),
  );
  expect(await client.rank(123)).toEqual({
    kind: "error",
    error: "HTTP 429",
    retryAt: Date.parse(retryDate),
  });
});

test("network failures, malformed JSON and invalid successful data remain errors", async () => {
  for (const response of [
    () => new Response("not json"),
    () => Response.json({ rank: -1 }),
    () => new Response(null, { status: 204 }),
  ]) {
    const client = createDeadlockClient(undefined, async () => response());
    expect((await client.rank(123)).kind).toBe("error");
  }
  const client = createDeadlockClient(undefined, async () => {
    throw new DOMException("Timed out", "TimeoutError");
  });
  expect((await client.rank(123)).kind).toBe("error");
});
