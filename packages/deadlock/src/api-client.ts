import createClient from 'openapi-fetch';
import type { paths } from './api';

export const USER_AGENT = 'deadlock-jp (+https://streamers.deadlock.jp)';

/** Shared requests; callers retain their own error and retry policies. */
export function createDeadlockApi(apiKey?: string, request: typeof fetch = fetch, timeoutMs = 10_000) {
	const client = createClient<paths>({
		baseUrl: 'https://api.deadlock-api.com',
		// Workers の fetch は User-Agent を付けない。deadlock-api の Cloudflare は、User-Agent のない
		// データセンターからの要求をプレイヤーの API で 403（Attention Required）にする（2026-10 から）
		headers: { 'User-Agent': USER_AGENT, ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
		fetch: request,
		querySerializer: { array: { style: 'form', explode: false } },
	});
	const signal = () => AbortSignal.timeout(timeoutMs);
	return {
		heroes: () =>
			client.GET('/v1/assets/heroes', {
				params: { query: { language: 'japanese' } },
				signal: signal(),
			}),
		rank: (accountId: number) =>
			client.GET('/v1/players/{account_id}/rank', {
				params: { path: { account_id: accountId } },
				signal: signal(),
			}),
		history: (accountId: number) =>
			client.GET('/v1/players/{account_id}/match-history', {
				params: { path: { account_id: accountId } },
				signal: signal(),
			}),
		matchTime: (accountId: number) =>
			client.GET('/v1/players/hero-stats', {
				params: {
					query: {
						account_ids: [accountId],
						game_mode: 'normal',
						match_mode: 'ranked,unranked',
					},
				},
				signal: signal(),
			}),
		search: (query: string) =>
			client.GET('/v1/players/steam-search', {
				params: {
					query: {
						search_query: query,
						limit: 20,
						min_matches_played_last_30d: 0,
					},
				},
				signal: signal(),
			}),
		profiles: (ids: number[]) =>
			client.GET('/v1/players/steam', {
				params: { query: { account_ids: ids } },
				signal: signal(),
			}),
		match: (id: number) =>
			client.GET('/v1/matches/{match_id}/metadata', {
				params: { path: { match_id: id } },
				signal: signal(),
			}),
	};
}
