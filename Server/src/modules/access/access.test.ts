import { describe, expect, it } from 'vitest';
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
import { MAX_PENDING, describeAgent } from './service.js';

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
    expect(without.json().error.code).toBe('wrong_password');
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

  it(`lets at most ${MAX_PENDING} requests wait at once`, async () => {
    await setUpKitchen(ctx.app);
    for (let i = 0; i < MAX_PENDING; i += 1) await ask(`Phone ${i}`, `198.51.100.${i + 1}`);
    const one = await from('198.51.100.200', {
      method: 'POST',
      url: '/api/access/request',
      payload: { name: 'One too many' },
    });
    expect(one.statusCode).toBe(429);
    expect(one.json().error.code).toBe('too_many_requests');
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
    expect(insideKitchen(request('172.18.0.2', { 'x-forwarded-for': INSIDE }, INSIDE), 1)).toBe(
      true,
    );
    expect(insideKitchen(request('172.18.0.2', { 'x-forwarded-for': OUTSIDE }, OUTSIDE), 1)).toBe(
      false,
    );
  });

  it('never believes a proxy on a public address', () => {
    expect(insideKitchen(request(OUTSIDE, { 'x-forwarded-for': INSIDE }, INSIDE), 1)).toBe(false);
  });

  it('takes a tunnel at its word about the visitor being outside', () => {
    const tunnel = request(
      '172.18.0.2',
      { 'x-forwarded-for': INSIDE, 'cf-connecting-ip': OUTSIDE },
      INSIDE,
    );
    expect(insideKitchen(tunnel, 1)).toBe(false);
  });

  it('counts a proxy that only says Forwarded as outside', () => {
    expect(insideKitchen(request('172.18.0.2', { forwarded: `for=${INSIDE}` }), 1)).toBe(false);
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
