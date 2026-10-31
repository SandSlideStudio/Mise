import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import * as schema from '../db/schema.js';

/**
 * Every test file gets its own real Postgres, running in-process.
 *
 * PGlite is the actual Postgres engine compiled to WebAssembly, so check
 * constraints, enums and transactions all behave exactly as they will in
 * production. Nobody needs Docker installed to run the suite, which matters
 * for a project whose whole premise is that other people will self-host it.
 *
 * Booting that engine and running the migrations is by far the slowest thing
 * in the suite, so it happens once per file. Between tests the tables are
 * truncated instead, which is quick. The Fastify app *is* rebuilt per test,
 * because the rate limiter keeps its counters in memory and tests that sign in
 * repeatedly would otherwise start tripping over each other's limits.
 */

function migrationsFolder(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(dir, 'drizzle');
    if (existsSync(path.join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find migrations. Run: npm run db:generate');
}

export const TEST_CONFIG: Config = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://unused',
  SESSION_SECRET: 'a-test-secret-that-is-at-least-32-characters-long',
  COOKIE_SECURE: false,
  UPLOAD_DIR: './data/test-uploads',
  BACKUP_DIR: './data/test-backups',
  CLIENT_DIR: '../Client/dist',
  TRUST_PROXY: false,
  OUTSIDE_ACCESS: 'approved',
  ONEDRIVE_CLIENT_ID: 'test-client',
};

/**
 * Empty every application table. The migration bookkeeping lives in its own
 * schema, so restricting this to `public` leaves it alone and the database
 * stays migrated.
 */
export async function resetDatabase(db: Database): Promise<void> {
  const result = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  // postgres-js returns the rows directly; PGlite wraps them.
  const rows: { tablename: string }[] = Array.isArray(result)
    ? result
    : ((result as unknown as { rows: { tablename: string }[] }).rows ?? []);

  if (rows.length === 0) return;
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
  await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`));
}

/** A new, migrated, in-process Postgres. */
export async function createTestDatabase(): Promise<{ client: PGlite; db: Database }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Database;
  await migrate(db as never, { migrationsFolder: migrationsFolder() });
  return { client, db };
}

export interface TestContext {
  readonly app: FastifyInstance;
  readonly db: Database;
}

/**
 * Wire a test file up to its own database. Call once at the top of the file:
 * the returned object exposes a fresh app and an empty database for each test.
 */
export function useTestContext(): TestContext {
  let client: PGlite | null = null;
  let db: Database | null = null;
  let app: FastifyInstance | null = null;

  beforeAll(async () => {
    ({ client, db } = await createTestDatabase());
  });

  afterAll(async () => {
    await client?.close();
    client = null;
    db = null;
  });

  beforeEach(async () => {
    await resetDatabase(db!);
    app = await buildApp(TEST_CONFIG, { db: db!, serveClient: false });
    await app.ready();
  });

  afterEach(async () => {
    await app?.close();
    app = null;
  });

  return {
    get app(): FastifyInstance {
      if (!app) throw new Error('No app yet. Call useTestContext() at the top of the file.');
      return app;
    },
    get db(): Database {
      if (!db) throw new Error('No database yet. Call useTestContext() at the top of the file.');
      return db;
    },
  };
}

/** Pull a named cookie out of a response, so tests can act as a signed-in user. */
export function cookieFrom(
  response: { cookies: { name: string; value: string }[] },
  name: string,
): string | undefined {
  return response.cookies.find((c) => c.name === name)?.value;
}

/** The details used whenever a test needs to get past first-run setup. */
export const ADMIN = {
  kitchenName: 'The Test Kitchen',
  displayName: 'Escoffier',
  email: 'chef@example.com',
  password: 'correct-horse-battery',
};

/** Complete first-run setup and return the session cookie it hands back. */
export async function setUpKitchen(app: FastifyInstance): Promise<string> {
  const response = await app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
  if (response.statusCode !== 200) {
    throw new Error(`Setup failed: ${response.statusCode} ${response.body}`);
  }
  const cookie = cookieFrom(response, 'mise_session');
  if (!cookie) throw new Error('Setup did not return a session cookie');
  return cookie;
}

/**
 * A cookie for a device approved for outside access, so a test can send
 * requests from a public address and still reach past the door.
 */
export async function approvedOutside(app: FastifyInstance): Promise<string> {
  const { token } = await app.access.approveNew({
    name: 'Test phone',
    userAgent: null,
    address: '203.0.113.50',
    userId: null,
  });
  return `mise_access=${token}`;
}
