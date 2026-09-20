type Profile = { accountId: number; name: string };
type Entry = { name?: string; expiresAt: number };
// Scoped to one mounted admin workspace; no cross-account or persistent cache.
export class SteamNameCache {
  private entries = new Map<number, Entry>();
  private pending = new Map<number, Promise<void>>();
  async load(
    ids: number[],
    fetchNames: (ids: number[]) => Promise<Profile[]>,
    now = Date.now,
  ) {
    const missing = [...new Set(ids)].filter(
      (id) =>
        !this.pending.has(id) &&
        (this.entries.get(id)?.expiresAt ?? 0) <= now(),
    );
    for (let i = 0; i < missing.length; i += 50) {
      const batch = missing.slice(i, i + 50);
      const request = Promise.resolve().then(async () => {
        try {
          const profiles = new Map(
            (await fetchNames(batch)).map((p) => [p.accountId, p.name]),
          );
          for (const id of batch) {
            const name = profiles.get(id);
            this.entries.set(id, {
              name: name ?? this.entries.get(id)?.name,
              expiresAt: now() + (name ? 600_000 : 120_000),
            });
          }
        } catch {
          for (const id of batch)
            this.entries.set(id, {
              name: this.entries.get(id)?.name,
              expiresAt: now() + 60_000,
            });
        } finally {
          for (const id of batch) this.pending.delete(id);
        }
      });
      for (const id of batch) this.pending.set(id, request);
    }
    await Promise.all(ids.map((id) => this.pending.get(id)));
    return Object.fromEntries(
      ids.flatMap((id) => {
        const name = this.entries.get(id)?.name;
        return name ? [[id, name]] : [];
      }),
    ) as Record<number, string>;
  }
}
