import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { connectionSettings } from '../../db/schema.js';
import { plainAddress } from '../../lib/network.js';

/** The one row's id. */
export const CONNECTION_ID = '00000000-0000-4000-8000-000000000002';

/**
 * What every request is checked against, kept in memory: the proxy check runs
 * inside Fastify before any hook, where there is no time to ask the database.
 * Loaded when the server starts and changed only through this service.
 */
export interface ConnectionState {
  outsideDomain: string | null;
  trustedProxy: string | null;
}

export function emptyConnectionState(): ConnectionState {
  return { outsideDomain: null, trustedProxy: null };
}

/** A host name as compared: lower case, no trailing dot. */
export function plainHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

/** The last web server seen passing requests on, offered for trusting. */
export interface SeenProxy {
  address: string;
  host: string;
  at: Date;
}

export function createConnectionService(db: Database, state: ConnectionState) {
  let seen: SeenProxy | null = null;

  return {
    async load(): Promise<void> {
      const [row] = await db
        .select()
        .from(connectionSettings)
        .where(eq(connectionSettings.id, CONNECTION_ID))
        .limit(1);
      state.outsideDomain = row?.outsideDomain ?? null;
      state.trustedProxy = row?.trustedProxy ?? null;
    },

    /** The address that leads to Mise from outside, or null for any. */
    outsideDomain: () => state.outsideDomain,
    /** The web server in front of Mise, or null. */
    trustedProxy: () => state.trustedProxy,

    async update(changes: Partial<ConnectionState>): Promise<void> {
      const next: ConnectionState = {
        outsideDomain:
          changes.outsideDomain === undefined
            ? state.outsideDomain
            : changes.outsideDomain && plainHost(changes.outsideDomain),
        trustedProxy:
          changes.trustedProxy === undefined
            ? state.trustedProxy
            : changes.trustedProxy && plainAddress(changes.trustedProxy),
      };
      await db
        .insert(connectionSettings)
        .values({ id: CONNECTION_ID, ...next })
        .onConflictDoUpdate({
          target: connectionSettings.id,
          set: { ...next, updatedAt: new Date() },
        });
      Object.assign(state, next);
    },

    sawProxy(address: string, host: string): void {
      seen = { address: plainAddress(address), host: plainHost(host), at: new Date() };
    },
    seenProxy: () => seen,
  };
}

export type ConnectionService = ReturnType<typeof createConnectionService>;
