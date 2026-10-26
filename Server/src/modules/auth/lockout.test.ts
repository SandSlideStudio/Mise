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
