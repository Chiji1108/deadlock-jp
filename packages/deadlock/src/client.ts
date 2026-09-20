import { createDeadlockApi } from './api-client';
export { createDeadlockApi } from './api-client';
import { parseHeroes, parseHistory, parseMatchTime, parseRank } from './model';
import type { HeroAsset } from './model';

export type Result<T> = { kind: 'ok'; value: T } | { kind: 'unavailable' } | { kind: 'error'; error: string; retryAt: number };

async function fetchValue<T, U>(request: () => Promise<{ data?: T; response: Response }>, parse: (value: T) => U): Promise<Result<U>> {
	try {
		const { data, response } = await request();
		if (response.status === 403 || response.status === 404) return { kind: 'unavailable' };
		if (!response.ok) {
			const after = response.headers.get('Retry-After');
			const retryAt = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after)) : 0;
			return {
				kind: 'error',
				error: `HTTP ${response.status}`,
				retryAt: Number.isFinite(retryAt) ? retryAt : 0,
			};
		}
		if (data === undefined) throw new Error('Empty response');
		// Generated types check callers; parsers still validate external JSON at runtime.
		return { kind: 'ok', value: parse(data) };
	} catch {
		return { kind: 'error', error: 'Network or invalid response', retryAt: 0 };
	}
}

export function createDeadlockClient(apiKey?: string, request: typeof fetch = fetch) {
	const client = createDeadlockApi(apiKey, request);
	return {
		heroes: () => fetchValue(client.heroes, parseHeroes),
		rank: (accountId: number) => fetchValue(() => client.rank(accountId), parseRank),
		history: (accountId: number, heroes: HeroAsset[]) =>
			fetchValue(
				() => client.history(accountId),
				(value) => parseHistory(value, accountId, heroes),
			),
		matchTime: (accountId: number) =>
			fetchValue(
				() => client.matchTime(accountId),
				(value) => parseMatchTime(value, accountId),
			),
	};
}
