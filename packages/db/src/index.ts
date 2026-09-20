import { drizzle } from "drizzle-orm/d1";
export function createDb(binding: D1Database) {
  return drizzle(binding);
}
export type Database = ReturnType<typeof createDb>;
export * from "./schema";
// Re-export query helpers so apps depend only on this workspace package.
export {
  and,
  or,
  eq,
  lt,
  lte,
  gt,
  gte,
  isNull,
  isNotNull,
  inArray,
  asc,
  desc,
  sql,
  count,
  exists,
} from "drizzle-orm";
export type { BatchItem } from "drizzle-orm/batch";
