import createClient from 'openapi-fetch';
import type { paths } from './generated/deadlock-api';
import { parseHeroes, parseHistory, parseMatchTime, parseRank } from './deadlock-model';
import type { HeroAsset } from './deadlock-model';

export type Result<T> = { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'error'; error: string; retryAt: number };

async function fetchValue<T, U>(
	request: (signal: AbortSignal) => Promise<{ data?: T; response: Response }>,
	parse: (value: T) => U,
): Promise<Result<U>> {
	try {
		const { data, response } = await request(AbortSignal.timeout(10_000));
		if (response.status === 403 || response.status === 404) return { kind: 'unavailable' };
		if (!response.ok) {
			const after = response.headers.get('Retry-After');
			const retryAt = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after)) : 0;
			return { kind: 'error', error: `HTTP ${response.status}`, retryAt: Number.isFinite(retryAt) ? retryAt : 0 };
		}
		if (data === undefined) throw new Error('Empty response');
		// Generated types check callers; parsers still validate external JSON at runtime.
		return { kind: 'ok', value: parse(data) };
	} catch {
		return { kind: 'error', error: 'Network or invalid response', retryAt: 0 };
	}
}

export function createDeadlockClient(apiKey?: string, request: typeof fetch = fetch) {
	const client = createClient<paths>({
		baseUrl: 'https://api.deadlock-api.com',
		headers: apiKey ? { 'X-API-Key': apiKey } : {},
		fetch: request,
		// Deadlock's list parameters use comma-separated values.
		querySerializer: { array: { style: 'form', explode: false } },
	});
	return {
		heroes: () =>
			fetchValue((signal) => client.GET('/v1/assets/heroes', { params: { query: { language: 'japanese' } }, signal }), parseHeroes),
		rank: (accountId: number) =>
			fetchValue(
				(signal) => client.GET('/v1/players/{account_id}/rank', { params: { path: { account_id: accountId } }, signal }),
				parseRank,
			),
		history: (accountId: number, heroes: HeroAsset[]) =>
			fetchValue(
				(signal) => client.GET('/v1/players/{account_id}/match-history', { params: { path: { account_id: accountId } }, signal }),
				(value) => parseHistory(value, accountId, heroes),
			),
		matchTime: (accountId: number) =>
			fetchValue(
				(signal) =>
					client.GET('/v1/players/hero-stats', {
						params: { query: { account_ids: [accountId], game_mode: 'normal', match_mode: 'ranked,unranked' } },
						signal,
					}),
				(value) => parseMatchTime(value, accountId),
			),
	};
}
