import { expect, test, vi } from "vitest";
import { TwitchClient, thumbnailUrl } from "./twitch";
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
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token" }))
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "page-2" } }),
    )
    .mockResolvedValueOnce(json({ error: "rate limited" }, 429));
  const twitch = new TwitchClient("client", "secret", request);
  await expect(twitch.discover("deadlock")).rejects.toThrow("429");
  expect(request).toHaveBeenCalledTimes(3);
});

test("repeated discovery cursors fail instead of returning a partial list", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token" }))
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
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token" }))
    .mockResolvedValueOnce(json({ data: [{ ...stream, viewer_count: -1 }] }));
  await expect(
    new TwitchClient("client", "secret", request).discover("deadlock"),
  ).rejects.toThrow("Malformed");
});

test("missing-user verification keeps the user filter across pagination", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token" }))
    .mockResolvedValueOnce(
      json({ data: [stream], pagination: { cursor: "next" } }),
    )
    .mockResolvedValueOnce(json({ data: [] }));
  const result = await new TwitchClient("client", "secret", request).byUsers([
    "user",
  ]);
  expect(result).toEqual([stream]);
  const followup = new URL(String(request.mock.calls[2][0]));
  expect(followup.searchParams.get("user_id")).toBe("user");
  expect(followup.searchParams.get("after")).toBe("next");
});

test("expired Twitch tokens refresh once and preserve the request", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "old" }))
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ access_token: "new" }))
    .mockResolvedValueOnce(json({ data: [stream] }));
  expect(
    await new TwitchClient("client", "secret", request).discover("deadlock"),
  ).toEqual([stream]);
  expect(request).toHaveBeenCalledTimes(4);
});

test("stream thumbnails use the Twitch CDN and requested dimensions; missing previews are harmless", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(json({ access_token: "token" }))
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
