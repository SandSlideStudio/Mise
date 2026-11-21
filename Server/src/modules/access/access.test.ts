import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest, InjectOptions } from 'fastify';
import { eq } from 'drizzle-orm';
import { remoteDevices } from '../../db/schema.js';
import { insideKitchen } from '../../lib/network.js';
import { buildApp } from '../../app.js';
import {
  ADMIN,
  TEST_CONFIG,
  approvedOutside,
  cookieFrom,
  setUpKitchen,
  useTestContext,
} from '../../test/harness.js';
import {
  MAX_NEW_PER_HOUR,
  MAX_PENDING,
  MAX_PENDING_PER_ADDRESS,
  describeAgent,
} from './service.js';

const ctx = useTestContext();

/** A phone on mobile data. */
const OUTSIDE = '203.0.113.9';
/** The office laptop on the kitchen wifi. */
const INSIDE = '192.168.1.20';

function from(remoteAddress: string, options: InjectOptions & { cookie?: string }) {
  const { cookie, ...rest } = options;
  return ctx.app.inject({
    ...rest,
    remoteAddress,
    headers: { ...rest.headers, ...(cookie ? { cookie } : {}) },
  });
}

/** Ask for access from outside. Returns the device's cookie and its code. */
async function ask(name = 'Sam’s phone', address = OUTSIDE) {
  const response = await from(address, {
    method: 'POST',
    url: '/api/access/request',
    payload: { name },
    headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1' },
  });
  expect(response.statusCode).toBe(200);
  const token = cookieFrom(response, 'mise_access');
  expect(token).toBeTruthy();
  return { cookie: `mise_access=${token}`, code: response.json().code as string };
}

async function list(session: string, address = INSIDE, device?: string) {
  const response = await from(address, {
    method: 'GET',
    url: '/api/access/devices',
    cookie: [`mise_session=${session}`, device].filter(Boolean).join('; '),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    inside: boolean;
    devices: {
      id: string;
      name: string;
      status: string;
      code: string | null;
      approvedBy: string | null;
      approvedFrom: string | null;
      thisDevice: boolean;
    }[];
  };
}

async function approve(
  session: string,
  id: string,
  address = INSIDE,
  extra?: object,
  device?: string,
) {
  return from(address, {
    method: 'POST',
    url: `/api/access/devices/${id}/approve`,
    payload: extra ?? {},
    cookie: [`mise_session=${session}`, device].filter(Boolean).join('; '),
  });
}

describe('from outside the kitchen', () => {
  it('answers nothing but the request page until the device is approved', async () => {
    await setUpKitchen(ctx.app);
    for (const url of ['/api/auth/me', '/api/setup/status', '/api/recipes', '/api/events']) {
      const response = await from(OUTSIDE, { method: 'GET', url });
      expect(response.statusCode, url).toBe(403);
      expect(response.json().error.code, url).toBe('access_required');
    }
    const login = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.json().error.code).toBe('access_required');
    expect(cookieFrom(login, 'mise_session')).toBeUndefined();

    expect((await from(OUTSIDE, { method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const status = await from(OUTSIDE, { method: 'GET', url: '/api/access/status' });
    expect(status.json()).toEqual({ status: 'none', name: null, code: null });
  });

  it("can't be got round with an oddly written address", async () => {
    await setUpKitchen(ctx.app);
    for (const url of ['/%61pi/auth/me', '/api/%61uth/me', '/api//auth/me', '/API/auth/me']) {
      const response = await from(OUTSIDE, { method: 'GET', url });
      expect(response.statusCode, url).not.toBe(200);
      expect(response.statusCode, url).not.toBe(401);
    }
  });

  it('treats a proxy or tunnel as outside unless told a proxy is trusted', async () => {
    await setUpKitchen(ctx.app);
    const tunnelled = await from('127.0.0.1', {
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });
    expect(tunnelled.json().error.code).toBe('access_required');
    // Even one that claims to be passing on a kitchen address.
    const claimed = await from('127.0.0.1', {
      method: 'GET',
      url: '/api/auth/me',
      headers: { 'x-forwarded-for': INSIDE },
    });
    expect(claimed.json().error.code).toBe('access_required');
  });

  it('lets the kitchen and its VPN straight in', async () => {
    await setUpKitchen(ctx.app);
    for (const address of [INSIDE, '10.0.0.7', '100.101.102.103', '127.0.0.1', 'fd7a:115c::5']) {
      const response = await from(address, { method: 'GET', url: '/api/auth/me' });
      expect(response.statusCode, address).toBe(401);
    }
    const status = await from(INSIDE, { method: 'GET', url: '/api/access/status' });
    expect(status.json().status).toBe('inside');
  });

  it('leaves setup reachable before the kitchen exists, and nothing else', async () => {
    const status = await from(OUTSIDE, { method: 'GET', url: '/api/setup/status' });
    expect(status.statusCode).toBe(200);
    expect((await from(OUTSIDE, { method: 'GET', url: '/api/auth/me' })).statusCode).toBe(403);
    const asked = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/access/request',
      payload: { name: 'Too early' },
    });
    expect(asked.statusCode).toBe(404);
  });
});

describe('asking and approving', () => {
  it('shows the request with its code, and lets the device in once approved', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    expect(phone.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);

    const waiting = await from(OUTSIDE, {
      method: 'GET',
      url: '/api/access/status',
      cookie: phone.cookie,
    });
    expect(waiting.json()).toEqual({ status: 'pending', name: 'Sam’s phone', code: phone.code });
    // Waiting is not in.
    const early = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(early.json().error.code).toBe('access_required');

    const { devices } = await list(admin);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      name: 'Sam’s phone',
      status: 'pending',
      code: phone.code,
      browser: 'Safari on iPhone',
      address: OUTSIDE,
    });

    expect((await approve(admin, devices[0]!.id)).statusCode).toBe(204);

    const status = await from(OUTSIDE, {
      method: 'GET',
      url: '/api/access/status',
      cookie: phone.cookie,
    });
    expect(status.json()).toEqual({ status: 'approved', name: 'Sam’s phone', code: null });
    const me = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(me.statusCode).toBe(401);
    const login = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
      cookie: phone.cookie,
    });
    expect(login.statusCode).toBe(200);

    const after = await list(admin);
    expect(after.devices[0]).toMatchObject({
      status: 'approved',
      code: null,
      approvedBy: ADMIN.displayName,
      approvedFrom: null,
    });
  });

  it('asking again while waiting keeps the same request', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    const again = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/access/request',
      payload: { name: 'Another name' },
      cookie: phone.cookie,
    });
    expect(again.json()).toMatchObject({ status: 'pending', code: phone.code });
    expect((await list(admin)).devices).toHaveLength(1);
  });

  it('is not for devices already inside', async () => {
    await setUpKitchen(ctx.app);
    const response = await from(INSIDE, {
      method: 'POST',
      url: '/api/access/request',
      payload: { name: 'Office laptop' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('keeps cooks out of approving', async () => {
    const admin = await setUpKitchen(ctx.app);
    await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Marco',
        role: 'cook',
        email: 'marco@example.com',
        password: 'a-long-cook-password',
      },
      cookie: `mise_session=${admin}`,
    });
    const signedIn = await from(INSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'marco@example.com', password: 'a-long-cook-password' },
    });
    const cook = cookieFrom(signedIn, 'mise_session')!;
    await ask();
    const { devices } = await list(admin);
    expect((await approve(cook, devices[0]!.id)).statusCode).toBe(403);
    const listed = await from(INSIDE, {
      method: 'GET',
      url: '/api/access/devices',
      cookie: `mise_session=${cook}`,
    });
    expect(listed.statusCode).toBe(403);
  });

  it('from an approved device outside, asks for the password again', async () => {
    const admin = await setUpKitchen(ctx.app);
    const laptop = await approvedOutside(ctx.app);
    const signedIn = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
      cookie: laptop,
    });
    const away = cookieFrom(signedIn, 'mise_session')!;
    await ask('New phone', '198.51.100.20');

    const seen = await list(away, OUTSIDE, laptop);
    expect(seen.inside).toBe(false);
    const request = seen.devices.find((d) => d.status === 'pending')!;
    expect(seen.devices.find((d) => d.thisDevice)?.name).toBe('Test phone');

    const without = await approve(away, request.id, OUTSIDE, {}, laptop);
    expect(without.json().error.code).toBe('password_missing');
    const wrong = await approve(away, request.id, OUTSIDE, { password: 'not-it' }, laptop);
    expect(wrong.json().error.code).toBe('wrong_password');
    const right = await approve(away, request.id, OUTSIDE, { password: ADMIN.password }, laptop);
    expect(right.statusCode).toBe(204);

    const after = await list(admin);
    expect(after.devices.find((d) => d.id === request.id)).toMatchObject({
      status: 'approved',
      approvedFrom: 'Test phone',
    });
  });

  it('takes an approval back', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    const { devices } = await list(admin);
    await approve(admin, devices[0]!.id);

    const revoked = await from(INSIDE, {
      method: 'DELETE',
      url: `/api/access/devices/${devices[0]!.id}`,
      cookie: `mise_session=${admin}`,
    });
    expect(revoked.statusCode).toBe(204);
    const me = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(me.json().error.code).toBe('access_required');
    const status = await from(OUTSIDE, {
      method: 'GET',
      url: '/api/access/status',
      cookie: phone.cookie,
    });
    expect(status.json().status).toBe('none');
  });

  it('a request that was turned down can no longer be approved', async () => {
    const admin = await setUpKitchen(ctx.app);
    await ask();
    const { devices } = await list(admin);
    await from(INSIDE, {
      method: 'DELETE',
      url: `/api/access/devices/${devices[0]!.id}`,
      cookie: `mise_session=${admin}`,
    });
    expect((await approve(admin, devices[0]!.id)).statusCode).toBe(404);
  });
});

describe('a signed-in phone that went missing, outside the kitchen', () => {
  /** Signed in with the password on a device approved from outside. */
  async function phone() {
    const admin = await setUpKitchen(ctx.app);
    const laptop = await approvedOutside(ctx.app);
    const signedIn = await from(OUTSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
      cookie: laptop,
    });
    expect(signedIn.statusCode).toBe(200);
    const session = cookieFrom(signedIn, 'mise_session')!;
    return { admin, laptop, session, cookie: `mise_session=${session}; ${laptop}` };
  }

  const outside = (cookie: string, options: InjectOptions) => from(OUTSIDE, { ...options, cookie });

  it('cannot get round the password check by adding a manager it knows the password of', async () => {
    const { laptop, session, cookie } = await phone();
    await ask('Thief laptop', '198.51.100.20');
    const { devices } = await list(session, OUTSIDE, laptop);
    const requestId = devices.find((d) => d.status === 'pending')!.id;

    // Approving asks for the password, which the thief does not know.
    const refused = await approve(session, requestId, OUTSIDE, {}, laptop);
    expect(refused.json().error.code).toBe('password_missing');

    // Adding an administrator with a password of the thief's choosing asks for it too...
    const accomplice = await outside(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Helper',
        role: 'admin',
        email: 'helper@evil.example',
        password: 'thief-chosen-password',
      },
    });
    expect(accomplice.statusCode).toBe(403);
    expect(accomplice.json().error.code).toBe('password_missing');

    // ...so there is nobody to sign in as and approve with.
    const helper = await outside(laptop, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'helper@evil.example', password: 'thief-chosen-password' },
    });
    expect(helper.statusCode).toBe(401);
  });

  it('adds someone once the password is given again, and counts a wrong one', async () => {
    const { cookie } = await phone();
    const person = {
      displayName: 'Rosa',
      role: 'sous_chef',
      email: 'rosa@example.com',
      password: 'rosas-own-password',
    };
    const wrong = await outside(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: { ...person, currentPassword: 'not-it' },
    });
    expect(wrong.json().error.code).toBe('wrong_password');
    const right = await outside(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: { ...person, currentPassword: ADMIN.password },
    });
    expect(right.statusCode).toBe(200);

    // Wrong guesses lock the account the same way wrong sign-ins do.
    for (let i = 0; i < 10; i++) {
      await outside(cookie, {
        method: 'POST',
        url: '/api/users',
        payload: { ...person, email: `x${i}@example.com`, currentPassword: 'still-not-it' },
      });
    }
    const locked = await outside(cookie, {
      method: 'POST',
      url: '/api/users',
      payload: { ...person, email: 'late@example.com', currentPassword: ADMIN.password },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('account_locked');
  });

  it('asks before changing how someone signs in or what they may do, not before a name', async () => {
    const { admin, cookie } = await phone();
    const created = await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'cook', pin: '4821' },
      cookie: `mise_session=${admin}`,
    });
    const id = created.json().id as string;
    const edit = (payload: object) =>
      outside(cookie, { method: 'PATCH', url: `/api/users/${id}`, payload });

    // A new name, or the same role and email sent back unchanged, is fine.
    expect((await edit({ displayName: 'Marco R.', role: 'cook', email: null })).statusCode).toBe(
      200,
    );
    for (const change of [
      { pin: '7356' },
      { pin: null },
      { role: 'head_chef' },
      { email: 'marco@example.com' },
      { password: 'a-new-long-password', email: 'marco@example.com' },
      { active: false },
    ]) {
      const refused = await edit(change);
      expect(refused.json().error?.code, JSON.stringify(change)).toBe('password_missing');
    }
    const allowed = await edit({ role: 'sous_chef', currentPassword: ADMIN.password });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().role).toBe('sous_chef');
  });

  it('asks before enrolling a tablet', async () => {
    const { cookie } = await phone();
    const refused = await outside(cookie, {
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Thief tablet' },
    });
    expect(refused.json().error.code).toBe('password_missing');
    expect(cookieFrom(refused, 'mise_device')).toBeFalsy();
    const enrolled = await outside(cookie, {
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Bar tablet', currentPassword: ADMIN.password },
    });
    expect(enrolled.statusCode).toBe(200);
    expect(cookieFrom(enrolled, 'mise_device')).toBeTruthy();
  });

  it('cannot change the account password without the current one', async () => {
    const { cookie } = await phone();
    const me = await outside(cookie, { method: 'GET', url: '/api/auth/me' });
    const changed = await outside(cookie, {
      method: 'PATCH',
      url: `/api/users/${me.json().user.id}`,
      payload: { password: 'thief-chosen-password' },
    });
    expect(changed.json().error.code).toBe('password_missing');
    // The owner still signs in with their own.
    const owner = await from(INSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(owner.statusCode).toBe(200);
  });

  it('cannot lift its own lock to keep guessing the password', async () => {
    const { cookie } = await phone();
    const me = await outside(cookie, { method: 'GET', url: '/api/auth/me' });
    const myId = me.json().user.id as string;
    const guess = (currentPassword: string) =>
      outside(cookie, {
        method: 'POST',
        url: '/api/users',
        payload: {
          displayName: 'X',
          role: 'admin',
          email: 'x@evil.example',
          password: 'thief-chosen-password',
          currentPassword,
        },
      });
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) await guess(`wrong-${round}-${i}`);
      expect((await guess(ADMIN.password)).statusCode).toBe(429);
      for (const payload of [undefined, { currentPassword: ADMIN.password }]) {
        const lift = await outside(cookie, {
          method: 'POST',
          url: `/api/users/${myId}/unlock`,
          payload,
        });
        expect(lift.statusCode).toBe(403);
        expect(lift.json().error.code).toBe('own_lock');
      }
    }
    // Nor by giving yourself a new PIN.
    await outside(cookie, { method: 'PATCH', url: `/api/users/${myId}`, payload: { pin: '7356' } });
    expect((await guess(ADMIN.password)).statusCode).toBe(429);
  });

  it('lifts someone else’s lock, from outside only with the password', async () => {
    const { admin, cookie } = await phone();
    const created = await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Rosa',
        role: 'head_chef',
        email: 'r@example.com',
        password: 'a'.repeat(12),
      },
      cookie: `mise_session=${admin}`,
    });
    const id = created.json().id as string;
    for (let i = 0; i < 5; i++) {
      await from(INSIDE, {
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'r@example.com', password: `wrong-${i}` },
      });
    }
    const lift = (payload?: object) =>
      outside(cookie, { method: 'POST', url: `/api/users/${id}/unlock`, payload });
    expect((await lift()).json().error.code).toBe('password_missing');
    expect((await lift({ currentPassword: 'not-it' })).json().error.code).toBe('wrong_password');
    expect((await lift({ currentPassword: ADMIN.password })).statusCode).toBe(200);
  });

  it('cannot remove the other managers, or their devices and tablets, without the password', async () => {
    const { admin, laptop, session, cookie } = await phone();
    const owner = await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Owner',
        role: 'admin',
        email: 'owner@example.com',
        password: 'owners-own-password',
      },
      cookie: `mise_session=${admin}`,
    });
    const ownerId = owner.json().id as string;
    const removeOwner = (payload?: object) =>
      outside(cookie, { method: 'DELETE', url: `/api/users/${ownerId}`, payload });
    const refused = await removeOwner();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('password_missing');

    // The owner's own laptop, approved from inside, and someone still waiting.
    await ask('Owner laptop', '198.51.100.30');
    const ownersLaptop = (await list(admin)).devices.find((d) => d.name === 'Owner laptop')!;
    await approve(admin, ownersLaptop.id);
    await ask('Owner tablet at home', '198.51.100.31');
    await ask('Owner phone', '198.51.100.32');
    const devicesNow = async () => (await list(session, OUTSIDE, laptop)).devices;
    const waiting = (await devicesNow()).find((d) => d.name === 'Owner tablet at home')!;
    for (const id of [ownersLaptop.id, waiting.id]) {
      const kept = await outside(cookie, { method: 'DELETE', url: `/api/access/devices/${id}` });
      expect(kept.json().error.code).toBe('password_missing');
    }
    const turnDown = await outside(cookie, {
      method: 'POST',
      url: '/api/access/devices/turn-down-waiting',
      payload: {},
    });
    expect(turnDown.json().error.code).toBe('password_missing');
    expect((await devicesNow()).length).toBe(4);

    // The kitchen's tablets: shutting them out, or lifting their lock.
    const tablet = await from(INSIDE, {
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookie: `mise_session=${admin}`,
    });
    const tabletId = tablet.json().id as string;
    for (const [method, url] of [
      ['DELETE', `/api/auth/devices/${tabletId}`],
      ['POST', `/api/auth/devices/${tabletId}/unlock`],
    ] as const) {
      const kept = await outside(cookie, { method, url });
      expect(kept.json().error.code, `${method} ${url}`).toBe('password_missing');
    }

    // With the password, each goes ahead.
    const withPassword = { currentPassword: ADMIN.password };
    expect((await removeOwner(withPassword)).statusCode).toBe(204);
    const removed = await outside(cookie, {
      method: 'DELETE',
      url: `/api/access/devices/${ownersLaptop.id}`,
      payload: withPassword,
    });
    expect(removed.statusCode).toBe(204);
    const turnedDown = await outside(cookie, {
      method: 'POST',
      url: '/api/access/devices/turn-down-waiting',
      payload: withPassword,
    });
    expect(turnedDown.json().removed).toBe(2);
    for (const [method, url] of [
      ['POST', `/api/auth/devices/${tabletId}/unlock`],
      ['DELETE', `/api/auth/devices/${tabletId}`],
    ] as const) {
      const done = await outside(cookie, { method, url, payload: withPassword });
      expect(done.statusCode, `${method} ${url}`).toBe(204);
    }
  });

  it('cannot switch PIN-only sign-in or the idle sign-out from outside without the password', async () => {
    const { admin, cookie } = await phone();
    await from(INSIDE, {
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { idleSignOutMinutes: 5 },
      cookie: `mise_session=${admin}`,
    });
    const edit = (payload: object) =>
      outside(cookie, { method: 'PATCH', url: '/api/kitchen', payload });
    for (const change of [{ idleSignOutMinutes: null }, { pinOnly: true }]) {
      const refused = await edit(change);
      expect(refused.json().error?.code, JSON.stringify(change)).toBe('password_missing');
    }
    // The rest of the form, with the same idle time sent back, asks nothing.
    expect((await edit({ name: 'Chez nous', idleSignOutMinutes: 5 })).statusCode).toBe(200);
    const off = await edit({ idleSignOutMinutes: null, currentPassword: ADMIN.password });
    expect(off.statusCode).toBe(200);
    expect(off.json().idleSignOutMinutes).toBeNull();
  });

  it('inside the kitchen, adding staff and enrolling a tablet ask for nothing more', async () => {
    const admin = await setUpKitchen(ctx.app);
    const added = await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Rosa',
        role: 'head_chef',
        email: 'r@example.com',
        password: 'a'.repeat(12),
      },
      cookie: `mise_session=${admin}`,
    });
    expect(added.statusCode).toBe(200);
    const enrolled = await from(INSIDE, {
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookie: `mise_session=${admin}`,
    });
    expect(enrolled.statusCode).toBe(200);
  });
});

describe('turning down everyone waiting', () => {
  const turnDownAll = (token: string) =>
    from(INSIDE, {
      method: 'POST',
      url: '/api/access/devices/turn-down-waiting',
      cookie: `mise_session=${token}`,
    });

  it('clears every waiting request and leaves an approved device alone', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask('Phone 1', '198.51.100.1');
    await ask('Phone 2', '198.51.100.2');
    await ask('Phone 3', '198.51.100.3');
    const { devices } = await list(admin);
    const first = devices.find((device) => device.name === 'Phone 1')!;
    await approve(admin, first.id);

    const result = await turnDownAll(admin);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ removed: 2 });
    const left = (await list(admin)).devices;
    expect(left).toHaveLength(1);
    expect(left[0]?.status).toBe('approved');
    const me = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(me.json().error?.code).not.toBe('access_required');
  });

  it('says zero when nobody is waiting', async () => {
    const admin = await setUpKitchen(ctx.app);
    expect((await turnDownAll(admin)).json()).toEqual({ removed: 0 });
  });

  it('is for chefs and administrators, not cooks', async () => {
    const admin = await setUpKitchen(ctx.app);
    await ask();
    await from(INSIDE, {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Marco',
        role: 'cook',
        email: 'marco@example.com',
        password: 'a-long-cook-password',
      },
      cookie: `mise_session=${admin}`,
    });
    const signedIn = await from(INSIDE, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'marco@example.com', password: 'a-long-cook-password' },
    });
    const cook = cookieFrom(signedIn, 'mise_session')!;
    expect((await turnDownAll(cook)).statusCode).toBe(403);
    expect((await list(admin)).devices).toHaveLength(1);
  });
});

describe('running out', () => {
  it('ends an approval after 90 days unused', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    const { devices } = await list(admin);
    await approve(admin, devices[0]!.id);

    await ctx.db
      .update(remoteDevices)
      .set({ lastSeenAt: new Date(Date.now() - 91 * 86_400_000) })
      .where(eq(remoteDevices.id, devices[0]!.id));

    const me = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(me.json().error.code).toBe('access_required');
    expect((await list(admin)).devices).toHaveLength(0);
  });

  it('keeps an approval that is used', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    const { devices } = await list(admin);
    await approve(admin, devices[0]!.id);
    await ctx.db
      .update(remoteDevices)
      .set({ lastSeenAt: new Date(Date.now() - 89 * 86_400_000) })
      .where(eq(remoteDevices.id, devices[0]!.id));

    const used = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(used.statusCode).toBe(401);
    // Its cookie is renewed, and the 90 days start again.
    expect(cookieFrom(used, 'mise_access')).toBeTruthy();
    const [row] = await ctx.db
      .select()
      .from(remoteDevices)
      .where(eq(remoteDevices.id, devices[0]!.id));
    expect(Date.now() - row!.lastSeenAt!.getTime()).toBeLessThan(60_000);
  });

  it('drops a request nobody answered within a day', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await ask();
    await ctx.db.update(remoteDevices).set({ requestedAt: new Date(Date.now() - 25 * 3_600_000) });
    expect((await list(admin)).devices).toHaveLength(0);
    const status = await from(OUTSIDE, {
      method: 'GET',
      url: '/api/access/status',
      cookie: phone.cookie,
    });
    expect(status.json().status).toBe('none');
  });

  /** Ask without the helper's success check. */
  const askRaw = (name: string, address: string) =>
    from(address, { method: 'POST', url: '/api/access/request', payload: { name } });

  /** Fill the waiting list straight in the database, as a flood would. */
  async function fillWaiting(count: number, prefix = 'Flood') {
    await ctx.db.insert(remoteDevices).values(
      Array.from({ length: count }, (_, i) => ({
        name: `${prefix} ${i}`,
        code: `AAA-${String(i).padStart(3, '0')}`,
        tokenHash: `${prefix}-${i}`,
        requestedAt: new Date(Date.now() - (count - i) * 1000),
      })),
    );
  }

  it(`keeps at most ${MAX_PENDING} requests waiting, and turns new ones away rather than dropping one`, async () => {
    const admin = await setUpKitchen(ctx.app);
    const first = await ask('Phone 0', '198.51.100.1');
    await fillWaiting(MAX_PENDING - 1);

    const more = await askRaw('One more', '198.51.100.200');
    expect(more.statusCode).toBe(429);
    expect(more.json().error.code).toBe('access_list_full');

    // Everyone already waiting keeps their place, and the list stays readable.
    const status = await from('198.51.100.1', {
      method: 'GET',
      url: '/api/access/status',
      cookie: first.cookie,
    });
    expect(status.json().status).toBe('pending');
    expect((await list(admin)).devices).toHaveLength(MAX_PENDING);
  });

  it('keeps a real request in the list through a flood behind an untrusted tunnel', async () => {
    const admin = await setUpKitchen(ctx.app);
    // Every visitor arrives from the tunnel's own private address, so the
    // list shows no address for any of them and no per-address limit applies.
    const viaTunnel = (name: string) =>
      from('172.18.0.1', {
        method: 'POST',
        url: '/api/access/request',
        payload: { name },
        headers: { 'x-forwarded-for': '198.51.100.4' },
      });
    const realResponse = await viaTunnel('Real phone');
    expect(realResponse.statusCode).toBe(200);
    const real = `mise_access=${cookieFrom(realResponse, 'mise_access')}`;
    for (let i = 0; i < MAX_PENDING * 3; i += 1) await viaTunnel(`Bot ${i}`);

    const devices = (await list(admin)).devices;
    expect(devices.length).toBeLessThanOrEqual(MAX_PENDING);
    expect(devices.map((d) => d.name)).toContain('Real phone');
    const status = await from('172.18.0.1', {
      method: 'GET',
      url: '/api/access/status',
      cookie: real,
      headers: { 'x-forwarded-for': '198.51.100.4' },
    });
    expect(status.json().status).toBe('pending');
  });

  describe('after a flood', () => {
    afterEach(() => vi.useRealTimers());

    it(`takes at most ${MAX_NEW_PER_HOUR} new requests an hour from everyone together`, async () => {
      await setUpKitchen(ctx.app);
      for (let i = 0; i < MAX_NEW_PER_HOUR; i += 1) await ask(`Phone ${i}`, `198.51.100.${i + 1}`);
      const blocked = await askRaw('Too soon', '198.51.100.100');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().error.code).toBe('too_many_requests');

      // Turned-away tries don't keep the door shut: an hour on, it opens again.
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 61 * 60_000 });
      expect((await askRaw('Later', '198.51.100.101')).statusCode).toBe(200);
    });

    it('lets a device ask again once the flood is answered or has run out', async () => {
      const admin = await setUpKitchen(ctx.app);
      await fillWaiting(MAX_PENDING);
      expect((await askRaw('Blocked', '198.51.100.7')).statusCode).toBe(429);

      // A manager turns one down: there is room again.
      const [first] = (await list(admin)).devices;
      const removed = await from(INSIDE, {
        method: 'DELETE',
        url: `/api/access/devices/${first!.id}`,
        cookie: `mise_session=${admin}`,
      });
      expect(removed.statusCode).toBe(204);
      expect((await askRaw('Room now', '198.51.100.8')).statusCode).toBe(200);

      // The rest run out on their own after a day.
      await ctx.db
        .update(remoteDevices)
        .set({ requestedAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(eq(remoteDevices.tokenHash, 'Flood-3'));
      const names = (await list(admin)).devices.map((d) => d.name);
      expect(names).not.toContain('Flood 3');
    });
  });

  it(`lets one address keep only ${MAX_PENDING_PER_ADDRESS} requests waiting`, async () => {
    await setUpKitchen(ctx.app);
    for (let i = 0; i < MAX_PENDING_PER_ADDRESS; i += 1) await ask(`Try ${i}`, '198.51.100.9');
    const more = await from('198.51.100.9', {
      method: 'POST',
      url: '/api/access/request',
      payload: { name: 'One too many' },
    });
    expect(more.statusCode).toBe(429);
    expect(more.json().error.code).toBe('too_many_requests');
  });

  it('limits how often one address can ask', async () => {
    await setUpKitchen(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const response = await from(OUTSIDE, {
        method: 'POST',
        url: '/api/access/request',
        payload: { name: `Try ${i}` },
      });
      codes.push(response.statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });
});

describe('a server with no kitchen network', () => {
  it('approves the device that set it up from outside', async () => {
    const response = await from(OUTSIDE, { method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(response.statusCode).toBe(200);
    const access = cookieFrom(response, 'mise_access');
    const session = cookieFrom(response, 'mise_session');
    expect(access).toBeTruthy();
    const me = await from(OUTSIDE, {
      method: 'GET',
      url: '/api/auth/me',
      cookie: `mise_access=${access}; mise_session=${session}`,
    });
    expect(me.statusCode).toBe(200);
  });

  it('does not hand out outside access to a device set up from inside', async () => {
    const response = await from(INSIDE, { method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(cookieFrom(response, 'mise_access')).toBeUndefined();
  });

  it('can be opened up with OUTSIDE_ACCESS=open, as a way back in', async () => {
    await setUpKitchen(ctx.app);
    const open = await buildApp(
      { ...TEST_CONFIG, OUTSIDE_ACCESS: 'open' },
      { db: ctx.db, serveClient: false },
    );
    try {
      const me = await open.inject({ method: 'GET', url: '/api/auth/me', remoteAddress: OUTSIDE });
      expect(me.statusCode).toBe(401);
    } finally {
      await open.close();
    }
  });
});

describe('who counts as inside', () => {
  function request(peer: string, headers: Record<string, string> = {}, ip = peer) {
    return { socket: { remoteAddress: peer }, headers, ip } as unknown as FastifyRequest;
  }

  it('believes a trusted proxy on the kitchen network about who it passes on', () => {
    // Fastify has already read X-Forwarded-For into ip.
    expect(
      insideKitchen(request('172.18.0.2', { 'x-forwarded-for': INSIDE }, INSIDE), () => true),
    ).toBe(true);
    expect(
      insideKitchen(request('172.18.0.2', { 'x-forwarded-for': OUTSIDE }, OUTSIDE), () => true),
    ).toBe(false);
  });

  it('never believes a proxy on a public address', () => {
    expect(insideKitchen(request(OUTSIDE, { 'x-forwarded-for': INSIDE }, INSIDE), () => true)).toBe(
      false,
    );
  });

  it('takes a tunnel at its word about the visitor being outside', () => {
    const tunnel = request(
      '172.18.0.2',
      { 'x-forwarded-for': INSIDE, 'cf-connecting-ip': OUTSIDE },
      INSIDE,
    );
    expect(insideKitchen(tunnel, () => true)).toBe(false);
  });

  it('counts a proxy that only says Forwarded as outside', () => {
    expect(insideKitchen(request('172.18.0.2', { forwarded: `for=${INSIDE}` }), () => true)).toBe(
      false,
    );
  });
});

describe('device names', () => {
  it('reads a browser and a system from the user agent', () => {
    expect(
      describeAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(
      describeAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0',
      ),
    ).toBe('Edge on Windows');
    expect(describeAgent(undefined)).toBe('Browser');
  });
});

describe('approving from the server itself', () => {
  it('approves a waiting device by the code on its screen, however it is typed', async () => {
    await setUpKitchen(ctx.app);
    const phone = await ask('Rosa’s phone');
    const typed = phone.code.toLowerCase().replace('-', ' ');
    expect(await ctx.app.access.approveByCode(typed)).toBe('Rosa’s phone');
    const me = await from(OUTSIDE, { method: 'GET', url: '/api/auth/me', cookie: phone.cookie });
    expect(me.statusCode).toBe(401);
  });

  it('approves nothing for a wrong code', async () => {
    await setUpKitchen(ctx.app);
    await ask();
    expect(await ctx.app.access.approveByCode('AAA-AAA')).toBeNull();
    expect(await ctx.app.access.approveByCode('nonsense')).toBeNull();
  });
});
