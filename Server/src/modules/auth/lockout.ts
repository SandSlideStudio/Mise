/**
 * Who has been guessing at which account, and from where.
 *
 * Wrong passwords and PINs count against the account and the address they come
 * from together, so five wrong guesses lock that pair, not the account: a
 * stranger who knows the head chef's email can't keep her out by guessing
 * from somewhere else. For a PIN the "address" is the enrolled tablet.
 *
 * Guessing from many addresses at once still runs into the account-wide brake:
 * that many failures within the window lock the account itself, which is
 * stored, shown in Settings and lifted by an administrator.
 *
 * Kept in memory: one Mise is one process, and a restart forgetting a few
 * minutes of failed guesses costs nothing. Checking and counting happen with
 * no await between them, so guesses sent at the same moment are counted one
 * after another and the sixth is refused unchecked.
 */

export const MAX_FAILED_ATTEMPTS = 5;
/**
 * Wrong PINs on one tablet within the window that lock it however many right
 * ones came in between: a cook could otherwise try four, sign in as
 * themselves, and try four more, all day long, until a chef's PIN came up.
 */
export const TABLET_WRONG_IN_WINDOW = 10;
export const ACCOUNT_BRAKE = 30;
export const LOCKOUT_MINUTES = 15;
const WINDOW_MS = LOCKOUT_MINUTES * 60_000;
/** The longest a PIN lock lasts, however often it has been earned. */
export const PIN_LOCK_CAP_MS = 24 * 60 * 60_000;
/** Far more addresses than a kitchen has; past it the oldest are dropped. */
const MAX_ENTRIES = 10_000;

interface PairState {
  attempts: number;
  lockedUntil: number | null;
  touchedAt: number;
}

export function createLockout(now: () => number = Date.now) {
  const pairs = new Map<string, PairState>();
  /** Failure times per account, for the account-wide brake. */
  const failures = new Map<string, number[]>();

  /**
   * PINs, per person across every tablet. A four-digit PIN has 10,000
   * possibilities, so the brake can't reset itself: each set of five wrong
   * PINs locks the person's PIN for twice as long as the last (15 minutes,
   * 30, an hour, up to a day), until they get it right or an administrator
   * sets a new one.
   */
  const pins = new Map<string, { failures: number; strikes: number; lockedUntil: number | null }>();

  /**
   * Tablets that sign in by PIN alone. A wrong PIN there belongs to nobody,
   * so it counts against the tablet: five wrong and it waits 15 minutes, then
   * twice as long each time (30, an hour, up to a day). The right PIN starts
   * the count of five in a row again, but not the doubling, and ten wrong in
   * 15 minutes lock it whatever came in between, or someone could try four,
   * sign in as themselves, and try four more all day long. The doubling goes
   * once a day has passed without a lock, so a few honest slips a month don't
   * add up to day-long waits.
   */
  const tablets = new Map<
    string,
    { attempts: number; strikes: number; lockedUntil: number | null; wrong: number[] }
  >();

  function lockTablet(state: { strikes: number; lockedUntil: number | null }): number {
    if (state.lockedUntil !== null && now() - state.lockedUntil > PIN_LOCK_CAP_MS) {
      state.strikes = 0;
    }
    state.strikes += 1;
    state.lockedUntil = now() + Math.min(WINDOW_MS * 2 ** (state.strikes - 1), PIN_LOCK_CAP_MS);
    return state.lockedUntil;
  }

  const key = (userId: string, address: string) => `${userId}\u0000${address}`;

  function prune(): void {
    const cutoff = now() - WINDOW_MS;
    for (const [k, state] of pairs) {
      const expired = state.lockedUntil === null || state.lockedUntil <= now();
      if (expired && state.touchedAt < cutoff) pairs.delete(k);
    }
    for (const [userId, times] of failures) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) failures.delete(userId);
      else failures.set(userId, recent);
    }
    // Still full: a flood of addresses. Drop the oldest first, leaving room for one.
    while (pairs.size >= MAX_ENTRIES) pairs.delete(pairs.keys().next().value!);
  }

  return {
    /**
     * Count an attempt before the slow check. Returns its number, or when the
     * pair's lock lifts.
     */
    reserve(userId: string, address: string): { attempt: number } | { lockedUntil: Date } {
      const k = key(userId, address);
      let state = pairs.get(k);
      if (state?.lockedUntil && state.lockedUntil > now()) {
        return { lockedUntil: new Date(state.lockedUntil) };
      }
      if (!state || state.lockedUntil !== null) {
        if (pairs.size >= MAX_ENTRIES) prune();
        state = { attempts: 0, lockedUntil: null, touchedAt: now() };
        pairs.set(k, state);
      }
      state.attempts += 1;
      state.touchedAt = now();
      if (state.attempts > MAX_FAILED_ATTEMPTS) {
        state.lockedUntil = now() + WINDOW_MS;
        return { lockedUntil: new Date(state.lockedUntil) };
      }
      return { attempt: state.attempts };
    },

    /**
     * A wrong guess. Locks the pair on its last allowed attempt, and says
     * whether the account as a whole has now had too many.
     */
    failed(userId: string, address: string, attempt: number): { lockAccount: boolean } {
      const state = pairs.get(key(userId, address));
      if (state && attempt >= MAX_FAILED_ATTEMPTS) state.lockedUntil = now() + WINDOW_MS;
      const cutoff = now() - WINDOW_MS;
      const times = (failures.get(userId) ?? []).filter((t) => t > cutoff);
      times.push(now());
      failures.set(userId, times);
      return { lockAccount: times.length >= ACCOUNT_BRAKE };
    },

    /** The right password or PIN from this address. */
    succeeded(userId: string, address: string): void {
      pairs.delete(key(userId, address));
    },

    /** An administrator reset the credential or lifted the lock: start clean everywhere. */
    forget(userId: string): void {
      const prefix = `${userId}\u0000`;
      for (const k of pairs.keys()) if (k.startsWith(prefix)) pairs.delete(k);
      failures.delete(userId);
      pins.delete(userId);
    },

    /** Whether this person's PIN is locked, across all tablets, and until when. */
    pinLocked(userId: string): Date | null {
      const state = pins.get(userId);
      return state?.lockedUntil && state.lockedUntil > now() ? new Date(state.lockedUntil) : null;
    },

    /** A wrong PIN on any tablet. Returns when the PIN is now locked until, if it is. */
    pinFailed(userId: string): Date | null {
      const state = pins.get(userId) ?? { failures: 0, strikes: 0, lockedUntil: null };
      state.failures += 1;
      if (state.failures >= MAX_FAILED_ATTEMPTS) {
        state.failures = 0;
        state.strikes += 1;
        state.lockedUntil = now() + Math.min(WINDOW_MS * 2 ** (state.strikes - 1), PIN_LOCK_CAP_MS);
      }
      pins.set(userId, state);
      return state.lockedUntil && state.lockedUntil > now() ? new Date(state.lockedUntil) : null;
    },

    /** The right PIN: the count starts again. */
    pinSucceeded(userId: string): void {
      pins.delete(userId);
    },

    /** Whether this tablet is locked for PIN-only sign-in, and until when. */
    tabletLocked(deviceId: string): Date | null {
      const state = tablets.get(deviceId);
      return state?.lockedUntil && state.lockedUntil > now() ? new Date(state.lockedUntil) : null;
    },

    /**
     * Count a PIN-only attempt before the slow check, the way `reserve` does,
     * so PINs sent at the same moment can't all slip past the fifth.
     */
    tabletReserve(deviceId: string): { attempt: number } | { lockedUntil: Date } {
      let state = tablets.get(deviceId);
      if (state?.lockedUntil && state.lockedUntil > now()) {
        return { lockedUntil: new Date(state.lockedUntil) };
      }
      if (!state) {
        state = { attempts: 0, strikes: 0, lockedUntil: null, wrong: [] };
        tablets.set(deviceId, state);
      }
      // A lock that has run out: a fresh five, but the strikes stay.
      if (state.lockedUntil !== null && state.attempts >= MAX_FAILED_ATTEMPTS) state.attempts = 0;
      state.attempts += 1;
      if (state.attempts > MAX_FAILED_ATTEMPTS) {
        return { lockedUntil: new Date(lockTablet(state)) };
      }
      return { attempt: state.attempts };
    },

    /** A wrong PIN on this tablet. Returns when it is now locked until, if it is. */
    tabletFailed(deviceId: string, attempt: number): Date | null {
      const state = tablets.get(deviceId);
      if (!state) return null;
      const locked = state.lockedUntil !== null && state.lockedUntil > now();
      // Every wrong PIN in the window counts, right ones in between or not.
      state.wrong = [...state.wrong.filter((at) => at > now() - WINDOW_MS), now()];
      if (
        !locked &&
        (attempt >= MAX_FAILED_ATTEMPTS || state.wrong.length >= TABLET_WRONG_IN_WINDOW)
      ) {
        lockTablet(state);
        state.wrong = [];
      }
      return state.lockedUntil && state.lockedUntil > now() ? new Date(state.lockedUntil) : null;
    },

    /**
     * The right PIN on this tablet: a slip before it no longer counts towards
     * five in a row. It still counts towards TABLET_WRONG_IN_WINDOW.
     */
    tabletSucceeded(deviceId: string): void {
      const state = tablets.get(deviceId);
      if (state) state.attempts = 0;
    },

    /** A manager lifted the tablet's lock, or took the tablet away: start clean. */
    forgetTablet(deviceId: string): void {
      tablets.delete(deviceId);
    },

    /** For tests: how many pairs are being tracked. */
    size: () => pairs.size,
  };
}

export type Lockout = ReturnType<typeof createLockout>;
