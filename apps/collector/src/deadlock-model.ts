import type { RecentMatch } from 'db/types';
export interface HeroAsset {
	id: number;
	name: string;
	image: string | null;
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response');
	return value as Record<string, unknown>;
}
function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid_response');
	return value;
}

export function parseHeroes(value: unknown): HeroAsset[] {
	if (!Array.isArray(value) || !value.length || value.length > 256) throw new Error('invalid_response');
	return value.map((item) => {
		const row = object(item);
		if (typeof row.name !== 'string' || !row.name || row.name.length > 100) throw new Error('invalid_response');
		const images = object(row.images);
		const candidate = images.icon_hero_card_webp ?? images.icon_hero_card ?? images.icon_image_small_webp ?? images.icon_image_small;
		let image: string | null = null;
		if (typeof candidate === 'string') {
			const url = new URL(candidate);
			if (url.protocol === 'https:' && url.hostname === 'assets-bucket.deadlock-api.com') image = url.href;
		}
		return { id: integer(row.id), name: row.name, image };
	});
}

/** Normal ranked/unranked games only, newest first, with a hard storage bound. */
export function parseHistory(value: unknown, accountId: number, heroes: HeroAsset[]): RecentMatch[] {
	if (!Array.isArray(value)) throw new Error('invalid_response');
	const catalog = new Map(heroes.map((hero) => [hero.id, hero]));
	const matches = new Map<number, RecentMatch>();
	for (const item of value) {
		const row = object(item);
		if (integer(row.account_id) !== accountId) throw new Error('invalid_response');
		const gameMode = integer(row.game_mode),
			matchMode = integer(row.match_mode);
		if (gameMode !== 1 || (matchMode !== 1 && matchMode !== 4)) continue;
		if (integer(row.match_duration_s) === 0) continue;
		const matchId = integer(row.match_id),
			heroId = integer(row.hero_id);
		const startedAt = integer(row.start_time) * 1000;
		if (!Number.isSafeInteger(startedAt)) throw new Error('invalid_response');
		const scored = integer(row.player_match_outcome);
		const team = integer(row.player_team),
			winner = integer(row.match_result);
		const outcome =
			scored === 1
				? 'win'
				: scored === 2
					? 'loss'
					: scored === 0 && team <= 1 && winner <= 1
						? team === winner
							? 'win'
							: 'loss'
						: 'unknown';
		const hero = catalog.get(heroId);
		matches.set(matchId, {
			matchId,
			heroId,
			heroName: hero?.name ?? `Hero ${heroId}`,
			heroImage: hero?.image ?? null,
			startedAt,
			outcome,
		});
	}
	return [...matches.values()].sort((a, b) => b.startedAt - a.startedAt || b.matchId - a.matchId).slice(0, 20);
}

export function parseMatchTime(value: unknown, accountId: number): number | null {
	if (!Array.isArray(value)) throw new Error('invalid_response');
	// No recorded matches is missing coverage, not proof of zero lifetime hours.
	if (!value.length) return null;
	const seen = new Set<number>();
	let seconds = 0;
	for (const item of value) {
		const row = object(item);
		if (integer(row.account_id) !== accountId) throw new Error('invalid_response');
		const hero = integer(row.hero_id);
		if (seen.has(hero)) throw new Error('invalid_response');
		seen.add(hero);
		seconds += integer(row.time_played);
		if (!Number.isSafeInteger(seconds)) throw new Error('invalid_response');
	}
	return seconds;
}

export function parseRank(value: unknown): { tier: number; subrank: number } {
	if (!value || typeof value !== 'object') throw new Error('Invalid rank response');
	const r = value as Record<string, unknown>;
	const tier = r.rank,
		subrank = r.subrank;
	if (
		typeof tier !== 'number' ||
		typeof subrank !== 'number' ||
		!Number.isInteger(tier) ||
		!Number.isInteger(subrank) ||
		tier < 0 ||
		tier > 11 ||
		(tier === 0 ? subrank !== 0 : subrank < 1 || subrank > 6) ||
		r.badge !== tier * 10 + subrank
	)
		throw new Error('Invalid rank response');
	return { tier, subrank };
}
