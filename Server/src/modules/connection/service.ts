import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { connectionSettings } from '../../db/schema.js';

/** The one row's id. */
export const CONNECTION_ID = '00000000-0000-4000-8000-000000000002';

/**
 * How long the outside address is remembered between looks at the database.
 * Every request from outside is checked against it, so it is not read each
 * time; a change made here takes effect at once, one made by a restore within
 * this long.
 */
const REMEMBER_MS = 5_000;

/** A host name as compared: lower case, no trailing dot. */
export function plainHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

export function createConnectionService(db: Database) {
  let cached: { domain: string | null; at: number } | null = null;

  async function read() {
    const [row] = await db
      .select()
      .from(connectionSettings)
      .where(eq(connectionSettings.id, CONNECTION_ID))
      .limit(1);
    return row ?? null;
  }

  return {
    /** The address that leads to Mise from outside, or null for any. */
    async outsideDomain(): Promise<string | null> {
      if (cached && Date.now() - cached.at < REMEMBER_MS) return cached.domain;
      const domain = (await read())?.outsideDomain ?? null;
      cached = { domain, at: Date.now() };
      return domain;
    },

    async setOutsideDomain(domain: string | null): Promise<void> {
      const value = domain ? plainHost(domain) : null;
      await db
        .insert(connectionSettings)
        .values({ id: CONNECTION_ID, outsideDomain: value })
        .onConflictDoUpdate({
          target: connectionSettings.id,
          set: { outsideDomain: value, updatedAt: new Date() },
        });
      cached = { domain: value, at: Date.now() };
    },
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;
