import { randomInt } from 'node:crypto';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { remoteDevices, users } from '../../db/schema.js';
import { generateToken, hashToken } from '../../lib/crypto.js';
import { ApiError } from '../../lib/errors.js';
import { isPrivateAddress } from '../../lib/network.js';

/**
 * Outside access, one device at a time.
 *
 * A device outside the kitchen asks with a name and gets a short code and a
 * cookie. Someone who can approve sees the name and the code in Settings →
 * Devices, checks the code with the person asking, and approves it. From then
 * on the cookie lets that device through, until someone revokes it or it goes
 * unused for 90 days.
 */

export const ACCESS_COOKIE = 'mise_access';
/** An approval nobody uses for this long runs out. */
export const IDLE_DAYS = 90;
/** A request nobody answers within this long is dropped. */
export const PENDING_HOURS = 24;
/** At most this many requests wait at once, so nobody can flood the list. */
export const MAX_PENDING = 20;
/** Browsers keep a cookie at most about this long; it is renewed as the device is used. */
export const COOKIE_DAYS = 400;
/** How often a device's last use is written down. Once an hour is plenty for a 90-day limit. */
const SEEN_EVERY_MS = 60 * 60 * 1000;

/** No 0/O, 1/I/L: the code is read out over the phone. */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const pick = () => CODE_LETTERS[randomInt(CODE_LETTERS.length)];
  return `${Array.from({ length: 3 }, pick).join('')}-${Array.from({ length: 3 }, pick).join('')}`;
}

/**
 * The address worth showing an approver. Behind a tunnel or proxy that isn't
 * trusted, the address is the proxy's own private one, which says nothing.
 */
function shownAddress(address: string): string | null {
  return isPrivateAddress(address) ? null : address;
}

const ago = (ms: number) => new Date(Date.now() - ms);
const idleSince = () => ago(IDLE_DAYS * 86_400_000);
const pendingSince = () => ago(PENDING_HOURS * 3_600_000);

/** A readable name for a browser, from its user agent: "Safari on iPhone". */
export function describeAgent(agent: string | null | undefined): string {
  const ua = agent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  const system = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? 'Browser';
}

export interface ApprovedDevice {
  id: string;
  name: string;
  /** Whether its cookie should be renewed on this response. */
  renew: boolean;
}

export function createAccessService(db: Database) {
  /** Drop requests nobody answered and approvals nobody used. */
  async function sweep(): Promise<void> {
    const idle = idleSince();
    await db
      .delete(remoteDevices)
      .where(
        or(
          and(eq(remoteDevices.status, 'pending'), lt(remoteDevices.requestedAt, pendingSince())),
          and(
            eq(remoteDevices.status, 'approved'),
            or(
              lt(remoteDevices.lastSeenAt, idle),
              and(isNull(remoteDevices.lastSeenAt), lt(remoteDevices.approvedAt, idle)),
            ),
          ),
        ),
      );
  }

  async function byToken(token: string) {
    await sweep();
    const [row] = await db
      .select()
      .from(remoteDevices)
      .where(eq(remoteDevices.tokenHash, hashToken(token)))
      .limit(1);
    return row ?? null;
  }

  return {
    /** A new request. Returns the cookie's token and the code to read out. */
    async ask(input: { name: string; userAgent: string | null; address: string }) {
      await sweep();
      const [{ waiting } = { waiting: 0 }] = await db
        .select({ waiting: sql<number>`count(*)::int` })
        .from(remoteDevices)
        .where(eq(remoteDevices.status, 'pending'));
      if (waiting >= MAX_PENDING) {
        throw new ApiError(
          429,
          'too_many_requests',
          'Too many devices are waiting to be approved. Try again later.',
        );
      }
      const token = generateToken();
      const code = newCode();
      await db.insert(remoteDevices).values({
        name: input.name,
        code,
        tokenHash: hashToken(token),
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        address: shownAddress(input.address),
      });
      return { token, code };
    },

    /** Approved straight away: the device that set this server up, or restored it, from outside. */
    async approveNew(input: {
      name: string;
      userAgent: string | null;
      address: string;
      userId: string | null;
    }) {
      const token = generateToken();
      await db.insert(remoteDevices).values({
        name: input.name,
        code: newCode(),
        tokenHash: hashToken(token),
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: input.userId,
        lastSeenAt: new Date(),
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        address: shownAddress(input.address),
      });
      return { token };
    },

    /** The device behind a cookie, when it is approved and still in use. */
    async approved(token: string): Promise<ApprovedDevice | null> {
      const row = await byToken(token);
      if (!row || row.status !== 'approved') return null;
      const renew = !row.lastSeenAt || row.lastSeenAt < ago(SEEN_EVERY_MS);
      if (renew) {
        await db
          .update(remoteDevices)
          .set({ lastSeenAt: new Date() })
          .where(eq(remoteDevices.id, row.id));
      }
      return { id: row.id, name: row.name, renew };
    },

    /** Where the device behind a cookie stands. */
    async status(token: string | undefined) {
      const row = token ? await byToken(token) : null;
      if (!row) return { status: 'none' as const, name: null, code: null };
      return {
        status: row.status,
        name: row.name,
        code: row.status === 'pending' ? row.code : null,
      };
    },

    async list() {
      await sweep();
      return db
        .select({
          id: remoteDevices.id,
          name: remoteDevices.name,
          status: remoteDevices.status,
          code: remoteDevices.code,
          requestedAt: remoteDevices.requestedAt,
          approvedAt: remoteDevices.approvedAt,
          approvedBy: users.displayName,
          approvedFrom: remoteDevices.approvedFrom,
          lastSeenAt: remoteDevices.lastSeenAt,
          userAgent: remoteDevices.userAgent,
          address: remoteDevices.address,
        })
        .from(remoteDevices)
        .leftJoin(users, eq(users.id, remoteDevices.approvedBy))
        .orderBy(asc(remoteDevices.status), asc(remoteDevices.requestedAt));
    },

    /** Returns false when there was no such request waiting. */
    async approve(id: string, by: { userId: string; from: string | null }): Promise<boolean> {
      await sweep();
      const rows = await db
        .update(remoteDevices)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: by.userId,
          approvedFrom: by.from,
          lastSeenAt: new Date(),
        })
        .where(and(eq(remoteDevices.id, id), eq(remoteDevices.status, 'pending')))
        .returning({ id: remoteDevices.id });
      return rows.length > 0;
    },

    /** Turn down a request, or take back an approval. */
    async remove(id: string): Promise<void> {
      await db.delete(remoteDevices).where(eq(remoteDevices.id, id));
    },
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
