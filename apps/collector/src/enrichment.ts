import { and, asc, cache, collector, eq, exists, isNotNull, lte, sql, streamers } from 'db';
import type { Database, StreamerRecord } from 'db';
import { renewRun } from 'db/ingestion';
import type { parseHistory, parseRank } from 'deadlock/model';
import type { HeroAsset } from 'deadlock/model';
import { createDeadlockClient } from 'deadlock';
import type { Result } from 'deadlock';
async function heroes(db: Database, runId: string, client: ReturnType<typeof createDeadlockClient>): Promise<HeroAsset[]> {
	const saved = await db.select().from(cache).where(eq(cache.key, 'heroes')).get();
	if (saved && saved.expiresAt > Date.now()) return JSON.parse(saved.value);
	const startedAt = Date.now();
	const result = await client.heroes();
	if (result.kind === 'ok') {
		const data = { value: JSON.stringify(result.value), expiresAt: Date.now() + 86_400_000 };
		await db
			.insert(cache)
			.select(
				db
					.select({
						key: sql<string>`'heroes'`.as('key'),
						value: sql<string>`${data.value}`.as('value'),
						expiresAt: sql<number>`${data.expiresAt}`.as('expiresAt'),
					})
					.from(collector)
					.where(and(eq(collector.id, 1), eq(collector.runId, runId))),
			)
			.onConflictDoUpdate({ target: cache.key, set: data });
		return result.value;
	}
	if (result.kind === 'error')
		console.warn('collector.heroes.failed', {
			runId,
			durationMs: Date.now() - startedAt,
			error: result.error,
			retryAt: result.retryAt,
			cachedFallback: !!saved,
		});
	return saved ? JSON.parse(saved.value) : [];
}
export async function refreshEnrichment(db: Database, runId: string, apiKey?: string) {
	const rows = await db
		.select()
		.from(streamers)
		// Twitch collection has already updated isLive for this run. Offline
		// identities retain their last enrichment and become eligible on resuming.
		.where(and(eq(streamers.isLive, true), isNotNull(streamers.steamAccountId), lte(streamers.enrichmentDueAt, Date.now())))
		.orderBy(asc(streamers.enrichmentDueAt))
		.limit(5);
	if (!rows.length) return;
	const client = createDeadlockClient(apiKey);
	const assets = await heroes(db, runId, client);
	for (const row of rows) {
		await renewRun(db, runId);
		const account = row.steamAccountId!;
		const startedAt = Date.now();
		const [rank, history, time] = await Promise.all([client.rank(account), client.history(account, assets), client.matchTime(account)]);
		for (const [operation, result] of [
			['rank', rank],
			['history', history],
			['matchTime', time],
		] as const) {
			if (result.kind === 'error')
				console.warn('collector.enrichment.request-failed', {
					runId,
					twitchId: row.twitchId,
					accountId: account,
					operation,
					durationMs: Date.now() - startedAt,
					error: result.error,
					retryAt: result.retryAt,
				});
		}
		await saveEnrichment(db, runId, row, rank, history, time, Date.now());
	}
}
export async function saveEnrichment(
	db: Database,
	runId: string,
	row: StreamerRecord,
	rank: Result<ReturnType<typeof parseRank>>,
	history: Result<ReturnType<typeof parseHistory>>,
	time: Result<number | null>,
	at: number,
) {
	const errors = [rank, history, time].filter((r) => r.kind === 'error');
	const retryAt = Math.max(at + Math.min(3_600_000, 300_000 * 2 ** Math.min(row.enrichmentFailures, 4)), ...errors.map((r) => r.retryAt));
	await db
		.update(streamers)
		.set({
			rankTier: rank.kind === 'ok' ? rank.value.tier : rank.kind === 'unavailable' ? null : row.rankTier,
			rankSubrank: rank.kind === 'ok' ? rank.value.subrank : rank.kind === 'unavailable' ? null : row.rankSubrank,
			rankUpdatedAt: rank.kind === 'ok' ? at : rank.kind === 'unavailable' ? null : row.rankUpdatedAt,
			rankUnavailable: rank.kind === 'unavailable' ? true : rank.kind === 'ok' ? false : row.rankUnavailable,
			recentMatches: history.kind === 'ok' ? history.value : history.kind === 'unavailable' ? [] : row.recentMatches,
			historyUpdatedAt: history.kind === 'ok' ? at : history.kind === 'unavailable' ? null : row.historyUpdatedAt,
			matchTimeSeconds: time.kind === 'ok' ? time.value : time.kind === 'unavailable' ? null : row.matchTimeSeconds,
			matchTimeUpdatedAt: time.kind === 'ok' ? at : time.kind === 'unavailable' ? null : row.matchTimeUpdatedAt,
			enrichmentDueAt: errors.length ? retryAt : at + 3_600_000,
			enrichmentFailures: errors.length ? row.enrichmentFailures + 1 : 0,
			enrichmentError: errors.length
				? errors.map((r) => r.error).join(', ')
				: [rank, history, time].some((r) => r.kind === 'unavailable')
					? 'Unavailable'
					: null,
		})
		.where(
			and(
				eq(streamers.twitchId, row.twitchId),
				eq(streamers.steamAccountId, row.steamAccountId!),
				eq(streamers.steamLinkVersion, row.steamLinkVersion),
				exists(
					db
						.select({ id: collector.id })
						.from(collector)
						.where(and(eq(collector.id, 1), eq(collector.runId, runId))),
				),
			),
		);
}
