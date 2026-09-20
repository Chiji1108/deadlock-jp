import { Database } from "bun:sqlite";
import { Glob } from "bun";
import { createDb } from "../packages/db/src/index";
// Execute the production Drizzle-generated SQL against SQLite with D1's batch
// transaction semantics, rather than mocking query results or counters.
export async function testDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrations = Array.from(
    new Glob("*/migration.sql").scanSync({
      cwd: new URL("../packages/db/migrations", import.meta.url).pathname,
    }),
  ).sort();
  for (const path of migrations)
    sqlite.exec(
      await Bun.file(
        new URL(`../packages/db/migrations/${path}`, import.meta.url),
      ).text(),
    );
  class Statement {
    constructor(
      readonly query: string,
      readonly args: unknown[] = [],
    ) {}
    bind(...args: unknown[]) {
      return new Statement(this.query, args);
    }
    async raw() {
      return sqlite.query(this.query).values(...(this.args as never[]));
    }
    async first() {
      return sqlite.query(this.query).get(...(this.args as never[]));
    }
    execute() {
      const results = sqlite.query(this.query).all(...(this.args as never[]));
      const meta = sqlite.query("SELECT changes() AS changes").get() as {
        changes: number;
      };
      return { results, success: true, meta };
    }
    async all() {
      return this.execute();
    }
    async run() {
      return this.execute();
    }
  }
  const binding = {
    prepare: (query: string) => new Statement(query),
    batch: async (statements: Statement[]) =>
      sqlite.transaction(() => statements.map((s) => s.execute()))(),
  } as unknown as D1Database;
  return { db: createDb(binding), binding, sqlite };
}
