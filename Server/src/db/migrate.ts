import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './client.js';

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
