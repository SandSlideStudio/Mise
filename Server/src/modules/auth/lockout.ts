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
export const ACCOUNT_BRAKE = 30;
export const LOCKOUT_MINUTES = 15;
const WINDOW_MS = LOCKOUT_MINUTES * 60_000;
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
    },

    /** For tests: how many pairs are being tracked. */
    size: () => pairs.size,
  };
}

export type Lockout = ReturnType<typeof createLockout>;
