import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDatabase>['db'];

/**
 * One connection pool per process. The pool is returned alongside the Drizzle
 * handle so shutdown can close it cleanly.
 */
export function createDatabase(url: string, options: { max?: number } = {}) {
  const sql = postgres(url, { max: options.max ?? 10, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export { schema };

/** A transaction handle. It can do everything the database handle does, inside one transaction. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Either the database or a transaction, for helpers that run in both. */
export type Executor = Database | Transaction;
