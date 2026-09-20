// External response validation stays at the boundary. Never interpret a failed or
// truncated request as an empty snapshot: doing so would close healthy streams.
import createClient from 'openapi-fetch';
import type { Client } from 'openapi-fetch';
import type { paths, components } from './generated/twitch-api';

export type TwitchStream = Pick<
	components['schemas']['Stream'],
	'id' | 'user_id' | 'user_login' | 'user_name' | 'game_id' | 'language' | 'title' | 'viewer_count' | 'started_at'
> &
	Partial<Pick<components['schemas']['Stream'], 'thumbnail_url'>>;
type StreamQuery = NonNullable<paths['/streams']['get']['parameters']['query']>;
type AuthOptions = { headers: Record<string, string>; signal: AbortSignal };
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Malformed Twitch response');
	return value as Record<string, unknown>;
}
function string(value: unknown) {
	if (typeof value !== 'string') throw new Error('Malformed Twitch field');
	return value;
}
function rows(value: unknown) {
	const data = object(value).data;
	if (!Array.isArray(data)) throw new Error('Malformed Twitch data');
	return data;
}
export function thumbnailUrl(value: unknown): string | null {
	if (typeof value !== 'string' || !value) return null;
	try {
		const url = new URL(value.replaceAll('{width}', '640').replaceAll('{height}', '360'));
		if (url.protocol !== 'https:' || url.hostname !== 'static-cdn.jtvnw.net' || url.username || url.password) return null;
		return url.toString();
	} catch {
		return null;
	}
}
function parseStream(value: unknown): TwitchStream {
	const row = object(value);
	const result = {
		id: string(row.id),
		user_id: string(row.user_id),
		user_login: string(row.user_login),
		user_name: string(row.user_name),
		game_id: string(row.game_id),
		language: string(row.language),
		title: string(row.title),
		viewer_count: row.viewer_count,
		started_at: string(row.started_at),
		...(thumbnailUrl(row.thumbnail_url) ? { thumbnail_url: thumbnailUrl(row.thumbnail_url)! } : {}),
	};
	if (
		!result.id ||
		!result.user_id ||
		!result.user_login ||
		typeof result.viewer_count !== 'number' ||
		!Number.isSafeInteger(result.viewer_count) ||
		result.viewer_count < 0 ||
		!Number.isFinite(Date.parse(result.started_at))
	)
		throw new Error('Malformed Twitch stream');
	return { ...result, viewer_count: result.viewer_count };
}
export class TwitchClient {
	private api: Client<paths>;
	private token: string | undefined;
	private tokenExpiresAt = 0;
	private cachedGameId: string | undefined;
	constructor(
		private clientId: string,
		private secret: string,
		private request: typeof fetch = fetch,
	) {
		this.request = request.bind(globalThis);
		this.api = createClient<paths>({
			baseUrl: 'https://api.twitch.tv/helix',
			fetch: this.request,
			querySerializer: { array: { style: 'form', explode: true } },
		});
	}
	private async accessToken() {
		if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
		const response = await this.request('https://id.twitch.tv/oauth2/token', {
			method: 'POST',
			body: new URLSearchParams({
				client_id: this.clientId,
				client_secret: this.secret,
				grant_type: 'client_credentials',
			}),
			signal: AbortSignal.timeout(12_000),
		});
		if (!response.ok) throw new Error(`Twitch authentication failed (${response.status})`);
		const payload = object(await response.json());
		this.token = string(payload.access_token);
		this.tokenExpiresAt = Date.now() + Math.max(0, Number(payload.expires_in ?? 0) - 60) * 1000;
		if (!this.token) throw new Error('Missing Twitch token');
		return this.token;
	}
	private async get<T>(request: (options: AuthOptions) => Promise<{ data?: T; response: Response }>, retry = true): Promise<T> {
		const token = await this.accessToken();
		const { data, response } = await request({
			headers: { 'Client-Id': this.clientId, Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(12_000),
		});
		if (response.status === 401 && retry) {
			this.token = undefined;
			return this.get(request, false);
		}
		if (!response.ok) throw new Error(`Twitch request failed (${response.status})`);
		if (data === undefined) throw new Error('Malformed Twitch response');
		return data;
	}
	async gameId() {
		if (this.cachedGameId) return this.cachedGameId;
		const games = rows(await this.get((options) => this.api.GET('/games', { ...options, params: { query: { name: ['Deadlock'] } } })));
		for (const raw of games) {
			const game = object(raw);
			if (string(game.name).toLowerCase() === 'deadlock') {
				const id = string(game.id);
				if (id) {
					this.cachedGameId = id;
					return id;
				}
			}
		}
		throw new Error('Deadlock category missing');
	}
	private async streams(params: StreamQuery) {
		const result = new Map<string, TwitchStream>();
		const cursors = new Set<string>();
		for (let page = 0; page < 30; page++) {
			const value = await this.get((options) => this.api.GET('/streams', { ...options, params: { query: params } }));
			const data = rows(value).map(parseStream);
			for (const stream of data) result.set(stream.user_id, stream);
			const pagination = object(value).pagination;
			const cursor = pagination === undefined ? undefined : object(pagination).cursor;
			if (cursor === undefined || cursor === '') return [...result.values()];
			const next = string(cursor);
			if (cursors.has(next)) throw new Error('Repeated Twitch pagination cursor');
			cursors.add(next);
			params = { ...params, after: next };
		}
		throw new Error('Twitch pagination limit reached');
	}
	async discover(gameId: string) {
		return this.streams({ game_id: [gameId], language: ['ja'], first: 100 });
	}
	async byUsers(ids: string[]) {
		const result: TwitchStream[] = [];
		for (let i = 0; i < ids.length; i += 100) {
			const params: StreamQuery = { first: 100, user_id: ids.slice(i, i + 100) };
			result.push(...(await this.streams(params)));
		}
		return result;
	}
	async profiles(ids: string[]) {
		if (!ids.length) return [];
		return rows(await this.get((options) => this.api.GET('/users', { ...options, params: { query: { id: ids } } }))).map((value) => {
			const row = object(value);
			const id = string(row.id),
				url = string(row.profile_image_url);
			if (url && !url.startsWith('https://')) throw new Error('Invalid Twitch portrait URL');
			return { id, url };
		});
	}
}
