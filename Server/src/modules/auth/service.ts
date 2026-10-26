import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { DEFAULT_STATIONS, type Language, type SetupRequest } from '@mise/contracts';
import { toBase, type UnitCode } from '@mise/domain';
import type { Database } from '../../db/client.js';
import { devices, kitchens, recipes, sessions, stations, users } from '../../db/schema.js';
import {
  dummyVerify,
  generateToken,
  hashSecret,
  hashToken,
  verifySecret,
} from '../../lib/crypto.js';

/**
 * Sign-in, sessions, and the lockout that stops a four-digit PIN from being
 * guessable by anyone with a spare afternoon.
 */

/** A password session lasts a fortnight; a PIN session ends with the shift. */
export const PASSWORD_SESSION_DAYS = 14;
export const PIN_SESSION_HOURS = 14;
/** A tablet stays enrolled for a year unless an admin revokes it. */
export const DEVICE_TOKEN_DAYS = 365;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export type AuthFailure =
  | { kind: 'invalid_credentials' }
  | { kind: 'locked'; until: Date }
  | { kind: 'inactive' }
  | { kind: 'device_not_enrolled' };

export interface AuthenticatedSession {
  token: string;
  expiresAt: Date;
  userId: string;
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/** How often "last seen" is written for a session or a tablet. */
const LAST_SEEN_EVERY_MS = 5 * 60_000;

function stale(lastSeen: Date | null): boolean {
  return lastSeen === null || Date.now() - lastSeen.getTime() > LAST_SEEN_EVERY_MS;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

export function createAuthService(db: Database) {
  /**
   * Count a sign-in attempt before the slow password check, in one UPDATE.
   * Guesses sent at the same moment then queue behind each other, so the sixth
   * is refused without being checked instead of all of them getting through
   * before the lock. Returns the attempt number, or when the lock lifts.
   */
  async function reserveAttempt(
    userId: string,
  ): Promise<{ attempt: number } | { lockedUntil: Date }> {
    const [row] = await db
      .update(users)
      .set({ failedAttempts: sql`${users.failedAttempts} + 1`, lockedUntil: null })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.lockedUntil), lte(users.lockedUntil, new Date())),
        ),
      )
      .returning({ failedAttempts: users.failedAttempts });

    if (!row) {
      const [locked] = await db
        .select({ lockedUntil: users.lockedUntil })
        .from(users)
        .where(eq(users.id, userId));
      return { lockedUntil: locked?.lockedUntil ?? minutesFromNow(LOCKOUT_MINUTES) };
    }
    if (row.failedAttempts > MAX_FAILED_ATTEMPTS) return { lockedUntil: await lock(userId) };
    return { attempt: row.failedAttempts };
  }

  async function lock(userId: string): Promise<Date> {
    const until = minutesFromNow(LOCKOUT_MINUTES);
    await db
      .update(users)
      .set({ lockedUntil: until, failedAttempts: 0, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return until;
  }

  async function clearFailures(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async function issueSession(
    userId: string,
    options: { deviceId?: string | null; expiresAt: Date; userAgent?: string | null },
  ): Promise<AuthenticatedSession> {
    const token = generateToken();
    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      deviceId: options.deviceId ?? null,
      expiresAt: options.expiresAt,
      userAgent: options.userAgent ?? null,
    });
    return { token, expiresAt: options.expiresAt, userId };
  }

  /** Email and password, for chefs and managers on any device. */
  async function loginWithPassword(
    email: string,
    password: string,
    userAgent?: string | null,
  ): Promise<{ ok: true; session: AuthenticatedSession } | { ok: false; error: AuthFailure }> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    if (!user) {
      // Spend the same time we would on a real account.
      await dummyVerify();
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    if (!user.active) return { ok: false, error: { kind: 'inactive' } };
    const reserved = await reserveAttempt(user.id);
    if ('lockedUntil' in reserved) {
      return { ok: false, error: { kind: 'locked', until: reserved.lockedUntil } };
    }

    if (!(await verifySecret(user.passwordHash, password))) {
      if (reserved.attempt >= MAX_FAILED_ATTEMPTS) await lock(user.id);
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }

    await clearFailures(user.id);
    const session = await issueSession(user.id, {
      expiresAt: daysFromNow(PASSWORD_SESSION_DAYS),
      userAgent,
    });
    return { ok: true, session };
  }

  /**
   * Name and PIN, but only on a tablet an admin enrolled. Four digits alone
   * would be trivially guessable over a network; bound to a known device and
   * rate limited, it is a reasonable trade for wet hands on a busy line.
   */
  async function loginWithPin(
    userId: string,
    pin: string,
    deviceId: string,
    userAgent?: string | null,
  ): Promise<{ ok: true; session: AuthenticatedSession } | { ok: false; error: AuthFailure }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      await dummyVerify();
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    if (!user.active) return { ok: false, error: { kind: 'inactive' } };
    const reserved = await reserveAttempt(user.id);
    if ('lockedUntil' in reserved) {
      return { ok: false, error: { kind: 'locked', until: reserved.lockedUntil } };
    }

    if (!(await verifySecret(user.pinHash, pin))) {
      if (reserved.attempt >= MAX_FAILED_ATTEMPTS) await lock(user.id);
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }

    await clearFailures(user.id);
    const session = await issueSession(user.id, {
      deviceId,
      expiresAt: new Date(Date.now() + PIN_SESSION_HOURS * 3_600_000),
      userAgent,
    });
    return { ok: true, session };
  }

  // Run on every request, so prepared once instead of rebuilt each time.
  const sessionByToken = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      deviceId: sessions.deviceId,
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      defaultStationId: users.defaultStationId,
      language: users.language,
      tourSeenAt: users.tourSeenAt,
      active: users.active,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sql.placeholder('tokenHash')))
    .limit(1)
    .prepare('session_by_token');
  const deviceByToken = db
    .select()
    .from(devices)
    .where(and(eq(devices.tokenHash, sql.placeholder('tokenHash')), isNull(devices.revokedAt)))
    .limit(1)
    .prepare('device_by_token');

  /** Resolve a session cookie to the person holding it. */
  async function resolveSession(token: string) {
    const [row] = await sessionByToken.execute({ tokenHash: hashToken(token) });

    if (!row) return null;
    if (row.expiresAt <= new Date()) {
      await db.delete(sessions).where(eq(sessions.id, row.sessionId));
      return null;
    }
    if (!row.active) return null;

    // Every request would otherwise write to disk, photos included, which
    // wears out the SD card of a Raspberry Pi. Five minutes is precise enough.
    if (stale(row.lastSeenAt)) {
      await db
        .update(sessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(sessions.id, row.sessionId));
    }

    return row;
  }

  async function revokeSession(token: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }

  /** Sign someone out everywhere. Used when a role changes or staff leave. */
  async function revokeAllForUser(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async function purgeExpiredSessions(): Promise<void> {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }

  /**
   * A person's own interface language. Deliberately does not end their
   * sessions: nothing about who they are or how they prove it has changed.
   */
  async function setLanguage(userId: string, language: Language | null): Promise<void> {
    await db.update(users).set({ language, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  /**
   * Record that someone has been offered the tour, whether they took it or
   * not. Kept against the person rather than the device, so a cook signing in
   * on a second tablet is not asked again, and the first moment stays put.
   */
  async function markTourSeen(userId: string): Promise<void> {
    await db
      .update(users)
      .set({ tourSeenAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.tourSeenAt)));
  }

  // --- devices ------------------------------------------------------------

  async function enrollDevice(name: string): Promise<{ id: string; token: string }> {
    const token = generateToken();
    const [device] = await db
      .insert(devices)
      .values({ name, tokenHash: hashToken(token) })
      .returning({ id: devices.id });
    if (!device) throw new Error('Failed to enroll device');
    return { id: device.id, token };
  }

  /** A device token is only good while the device has not been revoked. */
  async function resolveDevice(token: string) {
    const [device] = await deviceByToken.execute({ tokenHash: hashToken(token) });
    if (!device) return null;
    if (stale(device.lastSeenAt)) {
      await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, device.id));
    }
    return device;
  }

  async function listDevices() {
    return db.select().from(devices).orderBy(devices.enrolledAt);
  }

  async function revokeDevice(deviceId: string): Promise<void> {
    await db.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, deviceId));
    // Anyone signed in on that tablet is signed out immediately.
    await db.delete(sessions).where(eq(sessions.deviceId, deviceId));
  }

  /** The names a shared tablet offers before anyone has signed in. */
  async function roster() {
    return db
      .select({
        id: users.id,
        displayName: users.displayName,
        role: users.role,
        defaultStationId: users.defaultStationId,
        stationName: stations.name,
        pinLength: users.pinLength,
      })
      .from(users)
      .leftJoin(stations, eq(stations.id, users.defaultStationId))
      .where(and(eq(users.active, true), sql`${users.pinHash} is not null`))
      .orderBy(users.displayName);
  }

  // --- first run ----------------------------------------------------------

  /** True only while the server has no users at all. */
  async function needsSetup(): Promise<boolean> {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    return (row?.count ?? 0) === 0;
  }

  /**
   * Create the kitchen, its first admin, and whatever the setup screens
   * collected on the way: stations, staff, recipes and settings.
   *
   * All of it happens in one transaction, so setup either finishes or leaves
   * the server exactly as empty as it was. The insert is conditional on the
   * user table still being empty so two simultaneous requests cannot both
   * create an admin.
   */
  async function runSetup(
    input: SetupRequest,
  ): Promise<{ ok: true; userId: string } | { ok: false; error: 'already_set_up' }> {
    // Hashing is slow on purpose, so it happens before a transaction is open.
    const passwordHash = await hashSecret(input.password);
    const staff = await Promise.all(
      (input.staff ?? []).map(async (person) => ({
        ...person,
        pinHash: await hashSecret(person.pin),
      })),
    );

    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mise-setup'))`);
      const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
      if ((existing?.count ?? 0) > 0)
        return { ok: false as const, error: 'already_set_up' as const };

      await tx.insert(kitchens).values({
        name: input.kitchenName,
        language: input.language ?? 'en',
        ...(input.unitSystem ? { unitSystem: input.unitSystem } : {}),
        ...(input.tickedRetention ? { tickedRetention: input.tickedRetention } : {}),
      });

      // A kitchen with no stations cannot group a prep list. The setup screens
      // always send some; an older client gets the ones almost every brigade has.
      const stationNames = input.stations ?? DEFAULT_STATIONS;
      const createdStations = await tx
        .insert(stations)
        .values(stationNames.map((name, sortOrder) => ({ name: name.trim(), sortOrder })))
        .returning({ id: stations.id, name: stations.name });

      const stationId = (name: string | null | undefined) => {
        if (!name) return null;
        const wanted = name.trim().toLowerCase();
        return createdStations.find((s) => s.name.toLowerCase() === wanted)?.id ?? null;
      };

      const [user] = await tx
        .insert(users)
        .values({
          displayName: input.displayName,
          email: input.email,
          passwordHash,
          role: 'admin',
        })
        .returning({ id: users.id });

      if (!user) throw new Error('Failed to create the first administrator');

      if (staff.length > 0) {
        await tx.insert(users).values(
          staff.map((person) => ({
            displayName: person.displayName,
            role: person.role,
            pinHash: person.pinHash,
            pinLength: person.pin.length,
            defaultStationId: stationId(person.station),
          })),
        );
      }

      if (input.recipes && input.recipes.length > 0) {
        await tx.insert(recipes).values(
          input.recipes.map((recipe) => ({
            name: recipe.name,
            type: recipe.type,
            // Only a name and a yield so far, so they start as drafts.
            status: 'draft' as const,
            stationId: stationId(recipe.station),
            yieldBase: toBase({ value: recipe.yield.value, unit: recipe.yield.unit as UnitCode }),
            yieldEntered: recipe.yield.value,
            yieldUnit: recipe.yield.unit,
            portions: recipe.portions ?? null,
            createdBy: user.id,
          })),
        );
      }

      return { ok: true as const, userId: user.id };
    });
  }

  async function kitchen() {
    const [row] = await db.select().from(kitchens).limit(1);
    return row ?? null;
  }

  return {
    loginWithPassword,
    loginWithPin,
    markTourSeen,
    resolveSession,
    revokeSession,
    revokeAllForUser,
    purgeExpiredSessions,
    setLanguage,
    enrollDevice,
    resolveDevice,
    listDevices,
    revokeDevice,
    roster,
    needsSetup,
    runSetup,
    kitchen,
    issueSession,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
