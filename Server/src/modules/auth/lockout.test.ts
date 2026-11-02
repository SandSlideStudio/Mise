import { describe, expect, it } from 'vitest';
import { ACCOUNT_BRAKE, createLockout, LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS } from './lockout.js';

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
