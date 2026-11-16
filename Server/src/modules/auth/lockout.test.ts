import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_BRAKE,
  createLockout,
  LOCKOUT_MINUTES,
  MAX_FAILED_ATTEMPTS,
  PIN_LOCK_CAP_MS,
} from './lockout.js';

function clock() {
  let now = 1_000_000;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

/** Guess wrong once from an address, the way sign-in does. */
function guess(lockout: ReturnType<typeof createLockout>, user: string, address: string) {
  const reserved = lockout.reserve(user, address);
  if ('lockedUntil' in reserved) return reserved;
  return { ...reserved, ...lockout.failed(user, address, reserved.attempt) };
}

describe('the lockout', () => {
  it('locks one pair after the allowed tries and lifts it after the wait', () => {
    const time = clock();
    const lockout = createLockout(time.now);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) guess(lockout, 'chef', 'a');
    expect(lockout.reserve('chef', 'a')).toHaveProperty('lockedUntil');
    expect(lockout.reserve('chef', 'b')).toEqual({ attempt: 1 });

    time.advance(LOCKOUT_MINUTES * 60_000 + 1);
    expect(lockout.reserve('chef', 'a')).toEqual({ attempt: 1 });
  });

  it('starts a pair over after a good sign-in', () => {
    const lockout = createLockout();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) guess(lockout, 'chef', 'a');
    lockout.succeeded('chef', 'a');
    expect(lockout.reserve('chef', 'a')).toEqual({ attempt: 1 });
  });

  it('pulls the account-wide brake after enough failures from anywhere', () => {
    const lockout = createLockout();
    let last: ReturnType<typeof guess> | null = null;
    for (let i = 0; i < ACCOUNT_BRAKE; i += 1) last = guess(lockout, 'chef', `address-${i}`);
    expect(last).toHaveProperty('lockAccount', true);
  });

  it('forgets everything about a person when told to', () => {
    const lockout = createLockout();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) guess(lockout, 'cook', 'tablet');
    lockout.forget('cook');
    expect(lockout.reserve('cook', 'tablet')).toEqual({ attempt: 1 });
  });

  it('does not grow without end when guesses come from countless addresses', () => {
    const time = clock();
    const lockout = createLockout(time.now);
    for (let i = 0; i < 12_000; i += 1) {
      lockout.reserve(`user-${i % 50}`, `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`);
    }
    expect(lockout.size()).toBeLessThanOrEqual(10_000);
  });
});

describe('PINs, across every tablet', () => {
  it('locks after five wrong PINs, for twice as long each time, up to a day', () => {
    let clock = 0;
    const lockout = createLockout(() => clock);
    const lockFor = () => {
      for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) lockout.pinFailed('cook');
      return lockout.pinLocked('cook')!.getTime() - clock;
    };
    const minutes = (ms: number) => ms / 60_000;
    const locks: number[] = [];
    for (let round = 0; round < 9; round += 1) {
      const ms = lockFor();
      locks.push(minutes(ms));
      clock += ms; // wait it out
      expect(lockout.pinLocked('cook')).toBeNull();
    }
    expect(locks).toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440]);
  });

  it('counts wrong PINs from different tablets together', () => {
    const lockout = createLockout(() => 0);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) lockout.pinFailed('cook');
    expect(lockout.pinLocked('cook')).toBeNull();
    lockout.pinFailed('cook');
    expect(lockout.pinLocked('cook')).not.toBeNull();
  });

  it('starts again after the right PIN, or a new one from an administrator', () => {
    const lockout = createLockout(() => 0);
    for (let i = 0; i < 4; i += 1) lockout.pinFailed('cook');
    lockout.pinSucceeded('cook');
    for (let i = 0; i < 4; i += 1) lockout.pinFailed('cook');
    expect(lockout.pinLocked('cook')).toBeNull();
    lockout.pinFailed('cook');
    lockout.forget('cook');
    expect(lockout.pinLocked('cook')).toBeNull();
  });
});

describe('the tablet lock for PIN-only sign-in', () => {
  /** Five wrong PINs on one tablet, the way PIN-only sign-in counts them. */
  function fiveWrong(lockout: ReturnType<typeof createLockout>, tablet: string) {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      const reserved = lockout.tabletReserve(tablet);
      if ('attempt' in reserved) lockout.tabletFailed(tablet, reserved.attempt);
    }
  }

  it('waits 15 minutes, then twice as long each time, up to a day', () => {
    let clock = 0;
    const lockout = createLockout(() => clock);
    const locks: number[] = [];
    for (let round = 0; round < 9; round += 1) {
      fiveWrong(lockout, 'pass');
      const until = lockout.tabletLocked('pass')!.getTime();
      locks.push((until - clock) / 60_000);
      clock = until; // wait it out
      expect(lockout.tabletLocked('pass')).toBeNull();
    }
    expect(locks).toEqual([15, 30, 60, 120, 240, 480, 960, 1440, 1440]);
    expect(PIN_LOCK_CAP_MS).toBe(1440 * 60_000);
  });

  it('starts the count again after the right PIN, but keeps the doubling for a day', () => {
    let clock = 0;
    const lockout = createLockout(() => clock);
    fiveWrong(lockout, 'pass');
    clock = lockout.tabletLocked('pass')!.getTime();
    lockout.tabletSucceeded('pass');
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i += 1) {
      const reserved = lockout.tabletReserve('pass');
      if ('attempt' in reserved) lockout.tabletFailed('pass', reserved.attempt);
    }
    expect(lockout.tabletLocked('pass')).toBeNull();
    lockout.tabletSucceeded('pass');
    fiveWrong(lockout, 'pass');
    expect((lockout.tabletLocked('pass')!.getTime() - clock) / 60_000).toBe(30);

    // A day after that lock ran out, a slip counts as a first one again.
    clock = lockout.tabletLocked('pass')!.getTime() + PIN_LOCK_CAP_MS + 1;
    fiveWrong(lockout, 'pass');
    expect((lockout.tabletLocked('pass')!.getTime() - clock) / 60_000).toBe(15);
  });

  it('refuses a sixth PIN sent while five are still being checked', () => {
    const lockout = createLockout(() => 0);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i += 1) {
      expect(lockout.tabletReserve('pass')).toEqual({ attempt: i + 1 });
    }
    expect(lockout.tabletReserve('pass')).toHaveProperty('lockedUntil');
  });

  it('keeps each tablet to itself, and forgets one when told', () => {
    const lockout = createLockout(() => 0);
    fiveWrong(lockout, 'pass');
    expect(lockout.tabletLocked('pass')).not.toBeNull();
    expect(lockout.tabletLocked('pastry')).toBeNull();
    lockout.forgetTablet('pass');
    expect(lockout.tabletLocked('pass')).toBeNull();
  });
});
