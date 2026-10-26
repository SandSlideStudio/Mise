import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDatabase, type Database } from './client.js';
import { rows } from './rows.js';

/**
 * Migrations run on boot, so an admin pulling a newer image never has to
 * remember a separate step.
 */

/**
 * Walk up from this file looking for the generated migration folder. Doing it
 * by search rather than by a fixed number of parent hops means the same code
 * works from src during development and from the bundled dist in the image.
 */
function findMigrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not find the drizzle migrations folder. Run: npm run db:generate');
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { db, sql } = createDatabase(databaseUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: findMigrationsFolder() });
  } finally {
    await sql.end();
  }
}

/**
 * How many migrations this version would run, and whether the database holds
 * a kitchen that would be changed by them. A fresh database has nothing to
 * lose; one with staff in it gets a backup first.
 */
export async function pendingMigrations(
  db: Database,
): Promise<{ pending: number; hasKitchen: boolean }> {
  const journal = JSON.parse(
    readFileSync(path.join(findMigrationsFolder(), 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  // Two steps: Postgres checks a table exists before running any query naming
  // it, so a fresh database can't be asked how many migrations it has had.
  const [present] = await rows<{ migrations: boolean; users: boolean }>(
    db,
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as migrations,
               to_regclass('public.app_user') is not null as users`,
  );
  let applied = 0;
  if (present?.migrations) {
    const [row] = await rows<{ count: number }>(
      db,
      sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
    );
    applied = row?.count ?? 0;
  }
  let hasKitchen = false;
  if (present?.users) {
    const [row] = await rows<{ any: boolean }>(
      db,
      sql`select exists (select 1 from app_user) as any`,
    );
    hasKitchen = row?.any === true;
  }
  return { pending: Math.max(journal.entries.length - applied, 0), hasKitchen };
}
