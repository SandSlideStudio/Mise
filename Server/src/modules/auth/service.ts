import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import {
  ACTIVITY_PING_MS,
  DEFAULT_STATIONS,
  type Language,
  type SetupRequest,
} from '@mise/contracts';
import { toBase, type UnitCode } from '@mise/domain';
import type { Database, Executor, Transaction } from '../../db/client.js';
import {
  devices,
  kitchens,
  prepChecklistItems,
  recipes,
  sessions,
  stations,
  users,
} from '../../db/schema.js';
import {
  dummyVerify,
  generateToken,
  hashSecret,
  hashToken,
  verifySecret,
} from '../../lib/crypto.js';
import { createKitchenService } from '../kitchen/service.js';
import { recordAllergenChanges } from '../recipes/allergenHistory.js';
import { createLockout, LOCKOUT_MINUTES, type Lockout } from './lockout.js';

/**
 * Sign-in, sessions, and the lockout that stops a four-digit PIN from being
 * guessable by anyone with a spare afternoon.
 */

/** A password session lasts a fortnight; a PIN session ends with the shift. */
export const PASSWORD_SESSION_DAYS = 14;
export const PIN_SESSION_HOURS = 14;
/** A tablet stays enrolled for a year unless an admin revokes it. */
export const DEVICE_TOKEN_DAYS = 365;

export type AuthFailure =
  | { kind: 'invalid_credentials' }
  | { kind: 'locked'; until: Date }
  | { kind: 'inactive' }
  | { kind: 'device_not_enrolled' }
  | { kind: 'tablet_locked'; until: Date }
  | { kind: 'pin_only_off' }
  | { kind: 'pin_only_on' };

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

/**
 * How far past its idle limit a tablet session may go unheard before the
 * server ends it. "Last seen" can be up to LAST_SEEN_EVERY_MS behind the last
 * request, and a tablet in use tells the server so at most every
 * ACTIVITY_PING_MS, so someone at work is never signed out by this.
 */
export const IDLE_SLACK_MS = LAST_SEEN_EVERY_MS + ACTIVITY_PING_MS;

function stale(lastSeen: Date | null): boolean {
  return lastSeen === null || Date.now() - lastSeen.getTime() > LAST_SEEN_EVERY_MS;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

export function createAuthService(db: Database) {
  /** Wrong guesses per account and address; see lockout.ts. */
  const lockout: Lockout = createLockout();
  /** Only to read where PIN-only sign-in stands and whose PINs it goes by. */
  const kitchenService = createKitchenService(db);

  /** When PIN-only sign-in is on (not only chosen), since when; otherwise null. */
  async function pinOnlySince(): Promise<Date | null> {
    const row = await kitchenService.getKitchen();
    if (!row?.pinOnlySince) return null;
    return (await kitchenService.pinOnlyState(row)) === 'on' ? row.pinOnlySince : null;
  }

  /**
   * Before the slow check: is the account locked as a whole (the brake, or an
   * older lock), or this address for this account? Otherwise the attempt is
   * counted now, so guesses sent at once can't all slip through.
   */
  /**
   * The account-wide lock of addresses that have no account, kept in memory
   * the way a real account's is kept in the database, so both answer alike.
   */
  const unknownLocked = new Map<string, number>();

  async function reserveAttempt(
    user: { id: string; lockedUntil: Date | null },
    address: string,
  ): Promise<{ attempt: number } | { lockedUntil: Date }> {
    if (user.lockedUntil && user.lockedUntil > new Date()) return { lockedUntil: user.lockedUntil };
    return lockout.reserve(user.id, address);
  }

  async function failedAttempt(userId: string, address: string, attempt: number): Promise<void> {
    if (lockout.failed(userId, address, attempt).lockAccount) {
      await db
        .update(users)
        .set({ lockedUntil: minutesFromNow(LOCKOUT_MINUTES), updatedAt: new Date() })
        .where(eq(users.id, userId));
    }
  }

  async function issueSession(
    userId: string,
    options: { deviceId?: string | null; expiresAt: Date; userAgent?: string | null },
    exec: Executor = db,
  ): Promise<AuthenticatedSession> {
    const token = generateToken();
    await exec.insert(sessions).values({
      tokenHash: hashToken(token),
      userId,
      deviceId: options.deviceId ?? null,
      expiresAt: options.expiresAt,
      userAgent: options.userAgent ?? null,
    });
    return { token, expiresAt: options.expiresAt, userId };
  }

  /**
   * Someone already signed in proves it is still them, with the same lockout
   * as signing in. Asked before anything from outside the kitchen that would
   * let a signed-in phone that went missing in further (approving a device,
   * enrolling a tablet, adding staff or changing how they sign in), and
   * before anyone changes their own password or email.
   */
  async function confirmPassword(
    userId: string,
    password: string,
    address: string,
  ): Promise<'ok' | 'wrong' | 'no_password' | { lockedUntil: Date }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.passwordHash) return 'no_password';
    const reserved = await reserveAttempt(user, address);
    if ('lockedUntil' in reserved) return { lockedUntil: reserved.lockedUntil };
    if (!(await verifySecret(user.passwordHash, password))) {
      await failedAttempt(user.id, address, reserved.attempt);
      return 'wrong';
    }
    lockout.succeeded(user.id, address);
    return 'ok';
  }

  /** Whether someone can sign in with a password at all. */
  async function hasPassword(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return Boolean(user?.passwordHash);
  }

  /** Email and password, for chefs and managers on any device. */
  async function loginWithPassword(
    email: string,
    password: string,
    address: string,
    userAgent?: string | null,
  ): Promise<{ ok: true; session: AuthenticatedSession } | { ok: false; error: AuthFailure }> {
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);

    // No such account, or one that signs in with a PIN only: the same answer,
    // in the same time, as a wrong password, so sign-in never tells a
    // stranger which emails are real.
    // It is counted and locked like a real one, too: otherwise the sixth
    // wrong guess (a lock for a real account, a plain refusal for a made-up
    // one) would tell the two apart after all.
    if (!user?.passwordHash) {
      const standIn = `email:${email.trim().toLowerCase()}`;
      const lockedUntil = unknownLocked.get(standIn);
      if (lockedUntil && lockedUntil > Date.now()) {
        return { ok: false, error: { kind: 'locked', until: new Date(lockedUntil) } };
      }
      const reserved = lockout.reserve(standIn, address);
      if ('lockedUntil' in reserved) {
        return { ok: false, error: { kind: 'locked', until: reserved.lockedUntil } };
      }
      await dummyVerify();
      if (lockout.failed(standIn, address, reserved.attempt).lockAccount) {
        if (unknownLocked.size >= 10_000) unknownLocked.clear();
        unknownLocked.set(standIn, Date.now() + LOCKOUT_MINUTES * 60_000);
      }
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    const reserved = await reserveAttempt(user, address);
    if ('lockedUntil' in reserved) {
      return { ok: false, error: { kind: 'locked', until: reserved.lockedUntil } };
    }

    if (!(await verifySecret(user.passwordHash, password))) {
      await failedAttempt(user.id, address, reserved.attempt);
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    // Only someone who knows the password learns the account was switched off.
    if (!user.active) return { ok: false, error: { kind: 'inactive' } };

    lockout.succeeded(user.id, address);
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
    // Once tablets sign in by PIN alone they show no names, so this way in is
    // closed: it would be a second door, with its own count of wrong guesses.
    if (await pinOnlySince()) return { ok: false, error: { kind: 'pin_only_on' } };
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.pinHash) {
      await dummyVerify();
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    // Locked across every tablet once enough wrong PINs have been tried anywhere.
    const pinLock = lockout.pinLocked(user.id);
    if (pinLock) return { ok: false, error: { kind: 'locked', until: pinLock } };
    // The tablet is the address: a PIN only works on an enrolled one anyway.
    const reserved = await reserveAttempt(user, deviceId);
    if ('lockedUntil' in reserved) {
      return { ok: false, error: { kind: 'locked', until: reserved.lockedUntil } };
    }

    if (!(await verifySecret(user.pinHash, pin))) {
      await failedAttempt(user.id, deviceId, reserved.attempt);
      // Counted across tablets; a lock it earns applies from the next try.
      lockout.pinFailed(user.id);
      return { ok: false, error: { kind: 'invalid_credentials' } };
    }
    if (!user.active) return { ok: false, error: { kind: 'inactive' } };

    lockout.succeeded(user.id, deviceId);
    lockout.pinSucceeded(user.id);
    const session = await issueSession(user.id, {
      deviceId,
      expiresAt: new Date(Date.now() + PIN_SESSION_HOURS * 3_600_000),
      userAgent,
    });
    return { ok: true, session };
  }

  /**
   * A PIN alone, on an enrolled tablet, once every PIN in the kitchen has
   * been set since PIN-only sign-in was chosen (each one unique, and none of
   * the obvious ones).
   *
   * Nobody is named, so a wrong PIN counts against the tablet. The PIN is
   * checked against every PIN there is, all of them, every time, and only
   * then is the answer looked at: stopping at the first match would make a
   * PIN near the front of the list answer sooner than one near the end.
   */
  async function loginWithPinOnly(
    pin: string,
    deviceId: string,
    userAgent?: string | null,
  ): Promise<{ ok: true; session: AuthenticatedSession } | { ok: false; error: AuthFailure }> {
    const since = await pinOnlySince();
    if (!since) return { ok: false, error: { kind: 'pin_only_off' } };

    const reserved = lockout.tabletReserve(deviceId);
    if ('lockedUntil' in reserved) {
      return { ok: false, error: { kind: 'tablet_locked', until: reserved.lockedUntil } };
    }

    const candidates = await kitchenService.pinsSetSince(since);
    const [matches] = await Promise.all([
      Promise.all(candidates.map((person) => verifySecret(person.pinHash, pin))),
      // A kitchen with nobody to check against still takes as long as one check.
      candidates.length === 0 ? dummyVerify() : Promise.resolve(),
    ]);
    const found = candidates.filter((_, index) => matches[index]);

    // Exactly one, or it isn't a sign-in. Two can't happen while PINs are
    // checked as they are set; if it ever does, nobody gets in as the other.
    if (found.length !== 1) {
      const until = lockout.tabletFailed(deviceId, reserved.attempt);
      return {
        ok: false,
        error: until ? { kind: 'tablet_locked', until } : { kind: 'invalid_credentials' },
      };
    }
    const person = found[0]!;
    // Their PIN was locked by wrong guesses at their name before: it stays locked.
    const pinLock = lockout.pinLocked(person.id);
    if (pinLock) return { ok: false, error: { kind: 'locked', until: pinLock } };

    lockout.tabletSucceeded(deviceId);
    lockout.pinSucceeded(person.id);
    const session = await issueSession(person.id, {
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
      idleSignOutMinutes: kitchens.idleSignOutMinutes,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    // There is one kitchen; its idle limit comes along rather than costing a query.
    .leftJoin(kitchens, sql`true`)
    .where(eq(sessions.tokenHash, sql.placeholder('tokenHash')))
    .limit(1)
    .prepare('session_by_token');
  const deviceByToken = db
    .select()
    .from(devices)
    .where(and(eq(devices.tokenHash, sql.placeholder('tokenHash')), isNull(devices.revokedAt)))
    .limit(1)
    .prepare('device_by_token');

  /**
   * Resolve a session cookie to the person holding it.
   *
   * `touch: false` looks without counting as use, for the live stream's own
   * check every few seconds: an open screen nobody touches is not someone at
   * the tablet.
   */
  async function resolveSession(token: string, { touch = true }: { touch?: boolean } = {}) {
    const [row] = await sessionByToken.execute({ tokenHash: hashToken(token) });

    if (!row) return null;
    if (row.expiresAt <= new Date()) {
      await db.delete(sessions).where(eq(sessions.id, row.sessionId));
      return null;
    }
    if (!row.active) return null;

    // A shared tablet left alone signs out by itself, in the browser. A
    // browser that was closed, sent to the background or switched off never
    // gets to, so the server ends it too once it has heard nothing for the
    // limit, with room for how seldom "last seen" is written.
    if (row.deviceId !== null && row.idleSignOutMinutes !== null) {
      const silentMs = Date.now() - row.lastSeenAt.getTime();
      if (silentMs > row.idleSignOutMinutes * 60_000 + IDLE_SLACK_MS) {
        await db.delete(sessions).where(eq(sessions.id, row.sessionId));
        return null;
      }
    }

    // Every request would otherwise write to disk, photos included, which
    // wears out the SD card of a Raspberry Pi. Five minutes is precise enough.
    if (touch && stale(row.lastSeenAt)) {
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
    lockout.forgetTablet(deviceId);
    // Anyone signed in on that tablet is signed out immediately.
    await db.delete(sessions).where(eq(sessions.deviceId, deviceId));
  }

  /** Whether tablets sign in by PIN alone right now. */
  async function pinOnly(): Promise<boolean> {
    return (await pinOnlySince()) !== null;
  }

  /**
   * What a shared tablet offers before anyone has signed in: the names, or
   * once the kitchen signs in by PIN alone, only the keypad.
   */
  async function roster() {
    const since = await pinOnlySince();
    if (since) {
      const lengths = new Set((await kitchenService.pinsSetSince(since)).map((p) => p.pinLength));
      const [only] = lengths;
      return {
        mode: 'pin' as const,
        people: [],
        pinLength: lengths.size === 1 && only != null ? only : null,
      };
    }
    return { mode: 'names' as const, people: await names(), pinLength: null };
  }

  async function names() {
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
  /**
   * The kitchen, its people and stations, and whatever `finish` adds (backup
   * settings, the first sign-in), all at once or not at all: a setup that
   * fails halfway leaves nothing behind, so it can simply be tried again.
   */
  async function runSetup<T = undefined>(
    input: SetupRequest,
    finish?: (tx: Transaction, userId: string) => Promise<T>,
  ): Promise<
    { ok: true; userId: string; finished: T | undefined } | { ok: false; error: 'already_set_up' }
  > {
    // Hashing is slow on purpose, so it happens before a transaction is open.
    const passwordHash = await hashSecret(input.password);
    const pinHash = input.pin ? await hashSecret(input.pin) : null;
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

      // One moment for everything chosen here: PIN-only is on from it, so
      // every PIN set below counts as new (it is chosen when the PINs are set).
      const now = new Date();
      await tx.insert(kitchens).values({
        name: input.kitchenName,
        language: input.language ?? 'en',
        ...(input.tickedRetention ? { tickedRetention: input.tickedRetention } : {}),
        prepChecklist: input.prepChecklist ?? false,
        prepChecklistUpdatedAt: now,
        pinOnlySince: input.pinOnly ? now : null,
        idleSignOutMinutes: input.idleSignOutMinutes ?? null,
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
          pinHash,
          pinLength: input.pin?.length ?? null,
          pinSetAt: pinHash ? now : null,
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
            pinSetAt: now,
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
        // Each dish starts its allergen record, empty as it is so far.
        await recordAllergenChanges(tx, { userId: user.id });
      }

      if (input.prepChecklist && input.checklist && input.checklist.length > 0) {
        const next = new Map<string | null, number>();
        await tx.insert(prepChecklistItems).values(
          input.checklist.map((item) => {
            // Kept in the order given, within each station.
            const at = stationId(item.station);
            const sortOrder = next.get(at) ?? 0;
            next.set(at, sortOrder + 1);
            return { stationId: at, name: item.name, sortOrder };
          }),
        );
      }

      const finished = finish ? await finish(tx, user.id) : undefined;
      return { ok: true as const, userId: user.id, finished };
    });
  }

  async function kitchen() {
    const [row] = await db.select().from(kitchens).limit(1);
    return row ?? null;
  }

  return {
    loginWithPassword,
    loginWithPin,
    loginWithPinOnly,
    /** When this tablet is locked for PIN-only sign-in until; kept in memory. */
    tabletLockedUntil: (deviceId: string) => lockout.tabletLocked(deviceId),
    /** A manager lifted the tablet's lock. */
    forgetTabletFailures: (deviceId: string) => lockout.forgetTablet(deviceId),
    /** Start a person's count over everywhere, after an administrator resets them. */
    forgetFailures: (userId: string) => lockout.forget(userId),
    /** When this person's PIN is locked until, across all tablets: kept in memory, not the database. */
    pinLockedUntil: (userId: string) => lockout.pinLocked(userId),
    confirmPassword,
    hasPassword,
    markTourSeen,
    resolveSession,
    revokeSession,
    purgeExpiredSessions,
    setLanguage,
    enrollDevice,
    resolveDevice,
    listDevices,
    revokeDevice,
    roster,
    needsSetup,
    pinOnly,
    runSetup,
    kitchen,
    issueSession,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
