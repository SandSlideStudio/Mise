import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as crypto from '../../lib/crypto.js';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

/**
 * Sign-in by PIN alone: the tablet shows a keypad and the PIN finds the
 * person. Every PIN has to be unique and hard to guess first, and wrong PINs
 * count against the tablet, since they belong to nobody.
 */

// Counted, not changed: how many PINs a sign-in checks says whether it stops early.
vi.mock('../../lib/crypto.js', async (importOriginal) => {
  const real = await importOriginal<typeof crypto>();
  return { ...real, verifySecret: vi.fn(real.verifySecret) };
});

const ctx = useTestContext();
let admin: string;
let device: string;
let deviceId: string;
let marco: string;
let anna: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const as = (cookie: string, method: Method, url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, cookies: { mise_session: cookie } });

const onTablet = (method: Method, url: string, payload?: object) =>
  ctx.app.inject({ method, url, payload, cookies: { mise_device: device } });

const pinOnly = (pin: string) => onTablet('POST', '/api/auth/pin-only-login', { pin });

async function addStaff(payload: object): Promise<string> {
  const response = await as(admin, 'POST', '/api/users', payload);
  if (response.statusCode !== 200) throw new Error(response.body);
  return response.json().id;
}

const setPin = (id: string, pin: string, cookie = admin) =>
  as(cookie, 'PATCH', `/api/users/${id}`, { pin });

const choose = (on: boolean) => as(admin, 'PATCH', '/api/kitchen', { pinOnly: on });

async function status(cookie = admin) {
  return (await as(cookie, 'GET', '/api/kitchen/pin-only')).json();
}

async function roster() {
  return (await onTablet('GET', '/api/auth/sign-in-options')).json();
}

/** Switch it on and give both cooks a new PIN, so it is fully on. */
async function turnOn() {
  await choose(true);
  expect((await setPin(marco, '4821')).statusCode).toBe(200);
  expect((await setPin(anna, '7395')).statusCode).toBe(200);
  expect((await status()).state).toBe('on');
}

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
  const enrolled = await as(admin, 'POST', '/api/auth/devices', { name: 'Pass tablet' });
  device = cookieFrom(enrolled, 'mise_device')!;
  deviceId = enrolled.json().id;
  marco = await addStaff({ displayName: 'Marco', role: 'cook', pin: '1111' });
  anna = await addStaff({ displayName: 'Anna', role: 'cook', pin: '2222' });
});

describe('switching PIN-only sign-in on', () => {
  it('waits for everyone with a PIN to get a new one, and says who', async () => {
    expect((await status()).state).toBe('off');
    const switched = await choose(true);
    expect(switched.json().pinOnly).toBe('waiting');

    expect(await status()).toEqual({
      state: 'waiting',
      waiting: [
        { id: anna, displayName: 'Anna' },
        { id: marco, displayName: 'Marco' },
      ],
    });
    // Tablets keep showing the names until then.
    expect((await roster()).mode).toBe('names');

    await setPin(marco, '4821');
    expect((await status()).waiting).toEqual([{ id: anna, displayName: 'Anna' }]);
    await setPin(anna, '7395');
    expect(await status()).toEqual({ state: 'on', waiting: [] });
    expect((await as(admin, 'GET', '/api/kitchen')).json().pinOnly).toBe('on');
  });

  it('lets head chefs see who is waiting, and nobody below them', async () => {
    await addStaff({
      displayName: 'Head',
      role: 'head_chef',
      email: 'head@example.com',
      password: 'a-long-head-chef-password',
    });
    await addStaff({
      displayName: 'Sous',
      role: 'sous_chef',
      email: 'sous@example.com',
      password: 'a-long-sous-chef-password',
    });
    await choose(true);
    const signIn = async (email: string, password: string) =>
      cookieFrom(
        await ctx.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password },
        }),
        'mise_session',
      )!;
    const head = await signIn('head@example.com', 'a-long-head-chef-password');
    const sous = await signIn('sous@example.com', 'a-long-sous-chef-password');

    expect((await as(head, 'GET', '/api/kitchen/pin-only')).statusCode).toBe(200);
    expect((await as(sous, 'GET', '/api/kitchen/pin-only')).statusCode).toBe(403);
    // Only administrators choose it.
    expect((await as(head, 'PATCH', '/api/kitchen', { pinOnly: false })).statusCode).toBe(403);
    // And only head chefs and administrators set PINs, as before.
    const bySous = await setPin(marco, '4821', sous);
    expect(bySous.statusCode).toBe(403);
    expect(bySous.json().error.code).toBe('forbidden');
    expect((await setPin(marco, '4821', head)).statusCode).toBe(200);
  });

  it('counts someone switched back on as needing a new PIN', async () => {
    await turnOn();
    await as(admin, 'PATCH', `/api/users/${anna}`, { active: false });
    expect((await status()).state).toBe('on');
    await as(admin, 'PATCH', `/api/users/${anna}`, { active: true });
    // Someone may have been given her PIN while she was away.
    expect(await status()).toEqual({
      state: 'waiting',
      waiting: [{ id: anna, displayName: 'Anna' }],
    });
  });
});

describe('PINs while it is chosen', () => {
  it('refuses a PIN somebody else was given since, without saying whose', async () => {
    await choose(true);
    expect((await setPin(marco, '4821')).statusCode).toBe(200);

    const taken = await setPin(anna, '4821');
    expect(taken.statusCode).toBe(409);
    expect(taken.json()).toEqual({ error: { code: 'pin_taken', message: 'Choose another PIN.' } });
    expect(taken.body).not.toContain('Marco');
    expect(taken.body).not.toContain(marco);

    const added = await as(admin, 'POST', '/api/users', {
      displayName: 'Luca',
      role: 'cook',
      pin: '4821',
    });
    expect(added.json().error.code).toBe('pin_taken');
  });

  it('only compares with PINs set since, and lets someone keep their own', async () => {
    await choose(true);
    // Marco's old 1111 doesn't count: it has to be replaced anyway.
    expect((await setPin(anna, '4821')).statusCode).toBe(200);
    expect((await setPin(anna, '4821')).statusCode).toBe(200);
  });

  it('gives two people the same PIN at the same moment to only one of them', async () => {
    await choose(true);
    const answers = await Promise.all([setPin(marco, '4821'), setPin(anna, '4821')]);
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 409]);
  });

  it('refuses the obvious ones', async () => {
    await choose(true);
    for (const pin of ['0000', '1234', '9876', '1212', '1122', '2580', '1004', '123456']) {
      const response = await setPin(marco, pin);
      expect(response.statusCode, pin).toBe(400);
      expect(response.json().error).toEqual({
        code: 'pin_too_common',
        message: 'Pick a less obvious PIN.',
      });
    }
  });

  it('stops anyone trying PINs until one is taken, so nobody can find out everyone else’s', async () => {
    await choose(true);
    // The administrator's own PIN, which signs in as them on any tablet.
    const me = (await as(admin, 'GET', '/api/auth/me')).json().user.id;
    expect((await setPin(me, '4821')).statusCode).toBe(200);
    admin = cookieFrom(
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: ADMIN.password },
      }),
      'mise_session',
    )!;
    await addStaff({
      displayName: 'Head',
      role: 'head_chef',
      email: 'head@example.com',
      password: 'a-long-head-chef-password',
    });
    const head = cookieFrom(
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'head@example.com', password: 'a-long-head-chef-password' },
      }),
      'mise_session',
    )!;
    // Five refusals is a run of bad luck handing PINs out; more is a search.
    for (let i = 0; i < 5; i += 1) {
      expect((await setPin(marco, '4821', head)).json().error.code).toBe('pin_taken');
    }
    const stopped = await setPin(marco, '4821', head);
    expect(stopped.statusCode).toBe(429);
    expect(stopped.json().error.code).toBe('pin_tries');
    // Sent all at once, they wait just the same.
    const burst = await Promise.all(['5937', '6048', '7159'].map((pin) => setPin(anna, pin, head)));
    expect(burst.map((answer) => answer.statusCode)).toEqual([429, 429, 429]);
    // Someone else handing out PINs is not held up by it.
    expect((await setPin(anna, '7395')).statusCode).toBe(200);
  });

  it('leaves PINs alone while it is off', async () => {
    expect((await setPin(marco, '1234')).statusCode).toBe(200);
    expect((await setPin(anna, '1234')).statusCode).toBe(200);
  });
});

describe('signing in with a PIN alone', () => {
  it('is only there once it is on', async () => {
    expect((await pinOnly('4821')).json().error.code).toBe('pin_only_off');
    await choose(true);
    await setPin(marco, '4821');
    // Waiting for Anna.
    expect((await pinOnly('4821')).json().error.code).toBe('pin_only_off');
  });

  it('only works on an enrolled tablet', async () => {
    await turnOn();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-only-login',
      payload: { pin: '4821' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('device_not_enrolled');
  });

  it('finds the person by their PIN and signs them in on the tablet', async () => {
    await turnOn();
    const response = await pinOnly('7395');
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ displayName: 'Anna', onTablet: true });
    expect(cookieFrom(response, 'mise_session')).toBeTruthy();
  });

  it('tells the tablet to show the keypad and no names', async () => {
    expect(await roster()).toMatchObject({ mode: 'names', pinLength: null });
    await turnOn();
    expect(await roster()).toEqual({ mode: 'pin', people: [], pinLength: 4 });
    // PINs of different lengths: the pad waits for OK.
    await setPin(anna, '739518');
    expect(await roster()).toEqual({ mode: 'pin', people: [], pinLength: null });
  });

  it('closes tapping a name while it is on', async () => {
    await turnOn();
    const response = await onTablet('POST', '/api/auth/pin-login', { userId: marco, pin: '4821' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('pin_only_on');
  });

  it('checks every PIN every time, right or wrong', async () => {
    await turnOn();
    await addStaff({ displayName: 'Luca', role: 'cook', pin: '3906' });
    const verify = vi.mocked(crypto.verifySecret);

    verify.mockClear();
    expect((await pinOnly('3906')).statusCode).toBe(200);
    expect(verify).toHaveBeenCalledTimes(3);

    verify.mockClear();
    expect((await pinOnly('5050')).statusCode).toBe(401);
    expect(verify).toHaveBeenCalledTimes(3);
  });

  it('keeps a person’s locked PIN locked', async () => {
    await choose(true);
    await setPin(marco, '4821');
    // Still waiting for Anna, so names: five wrong at Marco lock his PIN.
    for (let i = 0; i < 5; i += 1) {
      await onTablet('POST', '/api/auth/pin-login', { userId: marco, pin: '9999' });
    }
    await as(admin, 'PATCH', `/api/users/${anna}`, { active: false });
    expect((await status()).state).toBe('on');

    const response = await pinOnly('4821');
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('account_locked');
  });

  it('goes back to the names when switched off, and PINs keep working', async () => {
    await turnOn();
    const off = await choose(false);
    expect(off.json().pinOnly).toBe('off');
    expect((await roster()).mode).toBe('names');
    expect((await pinOnly('4821')).json().error.code).toBe('pin_only_off');
    const byName = await onTablet('POST', '/api/auth/pin-login', { userId: marco, pin: '4821' });
    expect(byName.statusCode).toBe(200);

    // Chosen again later, it starts over: everyone needs a new PIN once more.
    await choose(true);
    expect((await status()).state).toBe('waiting');
  });
});

describe('the tablet lock', () => {
  it('locks the tablet after five wrong PINs, until a head chef lifts it', async () => {
    await turnOn();
    for (let i = 0; i < 4; i += 1) expect((await pinOnly('5050')).statusCode).toBe(401);
    const fifth = await pinOnly('5050');
    expect(fifth.statusCode).toBe(429);
    expect(fifth.json().error.code).toBe('tablet_locked');
    const until = new Date(fifth.json().error.details.until).getTime();
    expect(until - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(until - Date.now()).toBeLessThanOrEqual(15 * 60_000);

    // Even the right PIN waits.
    expect((await pinOnly('4821')).json().error.code).toBe('tablet_locked');

    const devices = await as(admin, 'GET', '/api/auth/devices');
    expect(devices.json()[0].lockedUntil).toBe(fifth.json().error.details.until);

    const lifted = await as(admin, 'POST', `/api/auth/devices/${deviceId}/unlock`);
    expect(lifted.statusCode).toBe(204);
    expect((await as(admin, 'GET', '/api/auth/devices')).json()[0].lockedUntil).toBeNull();
    expect((await pinOnly('4821')).statusCode).toBe(200);
  });

  it('lets only head chefs and administrators lift it, with a password', async () => {
    await turnOn();
    const cook = cookieFrom(await pinOnly('4821'), 'mise_session')!;
    expect((await as(cook, 'POST', `/api/auth/devices/${deviceId}/unlock`)).statusCode).toBe(403);
  });

  it('starts the count again after the right PIN', async () => {
    await turnOn();
    for (let i = 0; i < 4; i += 1) await pinOnly('5050');
    expect((await pinOnly('4821')).statusCode).toBe(200);
    for (let i = 0; i < 4; i += 1) expect((await pinOnly('5050')).statusCode).toBe(401);
  });

  it('locks after ten wrong PINs in a while, even with right ones in between', async () => {
    await turnOn();
    // Four, then their own PIN to reset the five in a row, again and again.
    const answers: number[] = [];
    for (let round = 0; round < 3; round += 1) {
      for (let i = 0; i < 4; i += 1) answers.push((await pinOnly('5050')).statusCode);
      if (round < 2) expect((await pinOnly('4821')).statusCode).toBe(200);
    }
    // The tenth wrong one locks the tablet; the eleventh guess isn't checked.
    expect(answers.slice(0, 9).every((status) => status === 401)).toBe(true);
    expect(answers[9]).toBe(429);
    expect((await pinOnly('4821')).json().error.code).toBe('tablet_locked');
  });

  it('counts per tablet, not for the whole kitchen', async () => {
    await turnOn();
    for (let i = 0; i < 5; i += 1) await pinOnly('5050');
    const other = await as(admin, 'POST', '/api/auth/devices', { name: 'Pastry tablet' });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-only-login',
      payload: { pin: '4821' },
      cookies: { mise_device: cookieFrom(other, 'mise_device')! },
    });
    expect(response.statusCode).toBe(200);
  });
});

it('keeps the admin who set up the kitchen out of the PIN list when they have none', async () => {
  // They sign in with a password, so they never hold the mode up.
  await choose(true);
  const waiting = (await status()).waiting.map((p: { displayName: string }) => p.displayName);
  expect(waiting).not.toContain(ADMIN.displayName);
});
