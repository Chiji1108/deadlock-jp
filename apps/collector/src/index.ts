import { and, collector, createDb, eq, inArray, sql, streamers } from 'db';
import type { StreamerRecord } from 'db';
import { acquireRun, applyObservation, renewRun } from 'db/ingestion';
import { TwitchClient } from './twitch';
import { refreshEnrichment } from './enrichment';
export interface CollectorEnv {
	DB: D1Database;
	TWITCH_CLIENT_ID?: string;
	TWITCH_CLIENT_SECRET?: string;
	DEADLOCK_API_KEY?: string;
}
let cachedClient: { id: string; secret: string; client: TwitchClient } | undefined;
function getClient(id: string, secret: string) {
	if (!cachedClient || cachedClient.id !== id || cachedClient.secret !== secret)
		cachedClient = { id, secret, client: new TwitchClient(id, secret) };
	return cachedClient.client;
}
export async function collect(env: CollectorEnv, scheduledAt: number, client?: TwitchClient) {
	const db = createDb(env.DB),
		runId = crypto.randomUUID();
	if (!(await acquireRun(db, runId, scheduledAt, Date.now()))) return;
	const ownRun = and(eq(collector.id, 1), eq(collector.runId, runId));
	try {
		if (!client && (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET)) {
			await db.update(collector).set({ state: 'unconfigured' }).where(ownRun);
			return;
		}
		const twitch = client ?? getClient(env.TWITCH_CLIENT_ID!, env.TWITCH_CLIENT_SECRET!);
		const active = await db.select().from(streamers).where(eq(streamers.isLive, true));
		const game = await twitch.gameId();
		const streams = new Map((await twitch.discover(game)).map((s) => [s.user_id, s]));
		for (const stream of await twitch.byUsers(active.filter((r) => !streams.has(r.twitchId)).map((r) => r.twitchId)))
			streams.set(stream.user_id, stream);
		const snapshot = new Map([...streams].filter(([, s]) => s.game_id === game && s.language === 'ja'));
		const at = Date.now();
		for (const s of snapshot.values())
			if (!Number.isSafeInteger(Date.parse(s.started_at)) || Date.parse(s.started_at) <= 0 || Date.parse(s.started_at) > at)
				throw new Error('Invalid stream start time');
		await renewRun(db, runId);
		let renewedAt = Date.now();
		const keepLease = async () => {
			if (Date.now() - renewedAt >= 30_000) {
				await renewRun(db, runId);
				renewedAt = Date.now();
			}
		};
		const previous = new Map<string, StreamerRecord>(active.map((r) => [r.twitchId, r]));
		const ids = [...snapshot.keys()],
			portraits = new Map<string, string>();
		for (let i = 0; i < ids.length; i += 90) {
			await keepLease();
			const batch = ids.slice(i, i + 90);
			const unloaded = batch.filter((id) => !previous.has(id));
			if (unloaded.length)
				for (const row of await db.select().from(streamers).where(inArray(streamers.twitchId, unloaded))) previous.set(row.twitchId, row);
			const due = batch.filter((id) => !previous.get(id)?.profileUpdatedAt || at - previous.get(id)!.profileUpdatedAt! >= 86_400_000);
			try {
				for (const p of await twitch.profiles(due)) portraits.set(p.id, p.url);
			} catch {
				console.warn('Optional portrait refresh failed');
			}
		}
		// Discovery and verification must both succeed before any session is closed.
		for (const id of new Set([...active.map((r) => r.twitchId), ...snapshot.keys()])) {
			await keepLease();
			const s = snapshot.get(id);
			await applyObservation(
				db,
				runId,
				previous.get(id) ?? null,
				s
					? {
							twitchId: s.user_id,
							twitchStreamId: s.id,
							login: s.user_login,
							displayName: s.user_name,
							title: s.title,
							viewerCount: s.viewer_count,
							startedAt: Date.parse(s.started_at),
							thumbnailUrl: s.thumbnail_url ?? null,
						}
					: null,
				at,
				portraits.get(id),
			);
		}
		await db
			.update(collector)
			.set({ state: 'ready', firstCollectedAt: sql`COALESCE(${collector.firstCollectedAt}, ${at})`, lastCollectedAt: at, error: null })
			.where(ownRun);
		try {
			await refreshEnrichment(db, runId, env.DEADLOCK_API_KEY);
		} catch {
			console.error('Deadlock enrichment failed; Twitch collection retained');
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Collection failed';
		console.error(message);
		await db.update(collector).set({ state: 'error', error: message }).where(ownRun);
		throw error;
	} finally {
		await db.update(collector).set({ runId: null, leaseUntil: 0 }).where(ownRun);
	}
}
export default {
	fetch() {
		return new Response('Not found', { status: 404 });
	},
	async scheduled(event, env) {
		await collect(env, event.scheduledTime);
	},
} satisfies ExportedHandler<CollectorEnv>;
