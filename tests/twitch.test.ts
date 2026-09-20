import { expect, test, mock } from "bun:test";
import { TwitchClient, thumbnailUrl } from "../apps/collector/src/twitch";
const stream = {
  id: "stream",
  user_id: "user",
  user_login: "login",
  user_name: "name",
  game_id: "deadlock",
  language: "ja",
  title: "title",
  viewer_count: 12,
  started_at: "2026-09-18T01:00:00Z",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("a failed later discovery page rejects the entire snapshot", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "page-2" } }),
    )
    .mockResolvedValueOnce(json({ error: "rate limited" }, 429));
  const twitch = new TwitchClient("client", "secret", request);
  await expect(twitch.discover("deadlock")).rejects.toThrow("429");
  expect(request).toHaveBeenCalledTimes(3);
});

test("repeated discovery cursors fail instead of returning a partial list", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "repeat" } }),
    )
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "repeat" } }),
    );
  await expect(
    new TwitchClient("client", "secret", request).discover("deadlock"),
  ).rejects.toThrow("Repeated");
});

test("malformed viewer data fails validation rather than contaminating metrics", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
    .mockResolvedValueOnce(json({ data: [{ ...stream, viewer_count: -1 }] }));
  await expect(
    new TwitchClient("client", "secret", request).discover("deadlock"),
  ).rejects.toThrow("Malformed");
});

test("missing-user verification keeps the user filter across pagination", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "next" } }),
    )
    .mockResolvedValueOnce(json({ data: [] }));
  const result = await new TwitchClient("client", "secret", request).byUsers([
    "user",
  ]);
  expect(result).toEqual([stream]);
  const followup = new URL(new Request(request.mock.calls[2][0]).url);
  expect(followup.searchParams.get("user_id")).toBe("user");
  expect(followup.searchParams.get("after")).toBe("next");
});

test("expired Twitch tokens refresh once and preserve the request", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "old", expires_in: 3600 }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 }))
    .mockResolvedValueOnce(json({ data: [stream] }));
  expect(
    await new TwitchClient("client", "secret", request).discover("deadlock"),
  ).toEqual([stream]);
  expect(request).toHaveBeenCalledTimes(4);
});

test("stream thumbnails use the Twitch CDN and requested dimensions; missing previews are harmless", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token", expires_in: 3600 }))
    .mockResolvedValueOnce(
      json({
        data: [
          {
            ...stream,
            thumbnail_url:
              "https://static-cdn.jtvnw.net/previews-ttv/live_user_login-{width}x{height}.jpg",
          },
        ],
      }),
    );
  const result = await new TwitchClient("client", "secret", request).discover(
    "deadlock",
  );
  expect(result[0].thumbnail_url).toBe(
    "https://static-cdn.jtvnw.net/previews-ttv/live_user_login-640x360.jpg",
  );
});

test.each([
  undefined,
  null,
  "",
  "bad url",
  "http://static-cdn.jtvnw.net/a.jpg",
  "https://example.com/a.jpg",
  "https://static-cdn.jtvnw.net.example.com/a.jpg",
])("unusable thumbnail %s is ignored", (value) => {
  expect(thumbnailUrl(value)).toBeNull();
});

test("typed Helix queries preserve repeated IDs, discovery filters and auth headers", async () => {
  const requests: Request[] = [];
  const request: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    requests.push(req);
    const url = new URL(req.url);
    if (url.hostname === "id.twitch.tv")
      return json({ access_token: "token", expires_in: 3600 });
    if (url.pathname.endsWith("/games"))
      return json({ data: [{ id: "deadlock", name: "Deadlock" }] });
    if (url.pathname.endsWith("/users"))
      return json({
        data: [
          { id: "1", profile_image_url: "https://example.com/avatar.png" },
        ],
      });
    return json({ data: [], pagination: {} });
  };
  const twitch = new TwitchClient("client", "secret", request);
  expect(await twitch.gameId()).toBe("deadlock");
  expect(await twitch.gameId()).toBe("deadlock");
  await twitch.discover("deadlock");
  const ids = Array.from({ length: 101 }, (_, i) => String(i + 1));
  await twitch.byUsers(ids);
  expect(await twitch.profiles(["1", "2"])).toEqual([
    { id: "1", url: "https://example.com/avatar.png" },
  ]);
  expect(requests).toHaveLength(6);
  const urls = requests.map((r) => new URL(r.url));
  expect(urls[1].searchParams.getAll("name")).toEqual(["Deadlock"]);
  expect(Object.fromEntries(urls[2].searchParams)).toEqual({
    game_id: "deadlock",
    language: "ja",
    first: "100",
  });
  expect(urls[3].searchParams.getAll("user_id")).toEqual(ids.slice(0, 100));
  expect(urls[4].searchParams.getAll("user_id")).toEqual(["101"]);
  expect(urls[5].searchParams.getAll("id")).toEqual(["1", "2"]);
  for (const req of requests.slice(1)) {
    expect(req.headers.get("Client-Id")).toBe("client");
    expect(req.headers.get("Authorization")).toBe("Bearer token");
  }
});

test("401 retries once with the new token and stops if authentication still fails", async () => {
  const request = mock<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "old", expires_in: 3600 }))
    .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
    .mockResolvedValueOnce(json({ access_token: "new", expires_in: 3600 }))
    .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
  await expect(
    new TwitchClient("client", "secret", request).byUsers(["1", "2"]),
  ).rejects.toThrow("401");
  expect(request).toHaveBeenCalledTimes(4);
  const initial = new Request(request.mock.calls[1][0]);
  const retried = new Request(request.mock.calls[3][0]);
  expect(retried.url).toBe(initial.url);
  expect(initial.headers.get("Authorization")).toBe("Bearer old");
  expect(retried.headers.get("Authorization")).toBe("Bearer new");
});
