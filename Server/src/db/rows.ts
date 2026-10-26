import type { SQL } from 'drizzle-orm';
import type { Database } from './client.js';

/**
 * Run raw SQL and get its rows. postgres-js returns the rows directly; PGlite,
 * which the tests use, wraps them. Code that must run against both, such as
 * what runs before migrations, reads them through here.
 */
export async function rows<T>(db: Database, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}
