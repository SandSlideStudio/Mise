import { describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { buildApp } from '../../app.js';
import {
  ADMIN,
  TEST_CONFIG,
  approvedOutside,
  cookieFrom,
  setUpKitchen,
  useTestContext,
} from '../../test/harness.js';

const ctx = useTestContext();

const OUTSIDE = '203.0.113.9';
const INSIDE = '192.168.1.20';
const DOMAIN = 'mise.example.com';

function from(address: string, host: string, options: InjectOptions & { cookie?: string }) {
  const { cookie, ...rest } = options;
  return ctx.app.inject({
    ...rest,
    remoteAddress: address,
    headers: { ...rest.headers, host, ...(cookie ? { cookie } : {}) },
  });
}

function setDomain(
  session: string,
  outsideDomain: string | null,
  address = INSIDE,
  host = '192.168.1.5:3000',
  device?: string,
) {
  return from(address, host, {
    method: 'PUT',
    url: '/api/connection',
    payload: { outsideDomain },
    cookie: [`mise_session=${session}`, device].filter(Boolean).join('; '),
  });
}

describe('the address that leads to Mise from outside', () => {
  it('starts empty: any address works from outside, as before', async () => {
    const admin = await setUpKitchen(ctx.app);
    const response = await from(INSIDE, '192.168.1.5:3000', {
      method: 'GET',
      url: '/api/connection',
      cookie: `mise_session=${admin}`,
    });
    expect(response.json()).toEqual({
      outsideDomain: null,
      currentHost: '192.168.1.5',
      inside: true,
    });
    const outside = await from(OUTSIDE, '198.51.100.1', {
      method: 'GET',
      url: '/api/access/status',
    });
    expect(outside.statusCode).toBe(200);
  });

  it('once set, answers outside only on that address, with nothing to show otherwise', async () => {
    const admin = await setUpKitchen(ctx.app);
    expect((await setDomain(admin, 'Mise.Example.com')).json().outsideDomain).toBe(DOMAIN);

    for (const host of ['198.51.100.1', '198.51.100.1:3000', 'blog.example.com', 'example.com']) {
      for (const url of ['/api/access/status', '/api/health', '/', '/assets/app.js']) {
        const response = await from(OUTSIDE, host, { method: 'GET', url });
        expect(response.statusCode, `${host}${url}`).toBe(404);
        expect(response.body, `${host}${url}`).toBe('Not found');
      }
    }
    for (const host of [DOMAIN, 'MISE.example.com', `${DOMAIN}:443`, `${DOMAIN}.`]) {
      const response = await from(OUTSIDE, host, { method: 'GET', url: '/api/access/status' });
      expect(response.statusCode, host).toBe(200);
    }
  });

  it('leaves the kitchen network on any address', async () => {
    const admin = await setUpKitchen(ctx.app);
    await setDomain(admin, DOMAIN);
    for (const host of ['192.168.1.5:3000', 'mise.local', 'localhost:3000']) {
      const response = await from(INSIDE, host, { method: 'GET', url: '/api/auth/me' });
      expect(response.statusCode, host).toBe(401);
    }
  });

  it('also holds for approved devices', async () => {
    const admin = await setUpKitchen(ctx.app);
    const phone = await approvedOutside(ctx.app);
    await setDomain(admin, DOMAIN);
    const wrong = await from(OUTSIDE, '198.51.100.1', {
      method: 'GET',
      url: '/api/auth/me',
      cookie: phone,
    });
    expect(wrong.statusCode).toBe(404);
    const right = await from(OUTSIDE, DOMAIN, {
      method: 'GET',
      url: '/api/auth/me',
      cookie: phone,
    });
    expect(right.statusCode).toBe(401);
  });

  it("won't be set from outside to an address that would shut you out", async () => {
    await setUpKitchen(ctx.app);
    const phone = await approvedOutside(ctx.app);
    const signedIn = await from(OUTSIDE, '198.51.100.1', {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
      cookie: phone,
    });
    const away = cookieFrom(signedIn, 'mise_session')!;

    const locked = await setDomain(away, DOMAIN, OUTSIDE, '198.51.100.1', phone);
    expect(locked.statusCode).toBe(400);
    expect(locked.json().error.code).toBe('domain_locks_you_out');

    // Through the address itself, it's fine.
    const fine = await setDomain(away, DOMAIN, OUTSIDE, DOMAIN, phone);
    expect(fine.statusCode).toBe(200);
  });

  it('can be cleared again', async () => {
    const admin = await setUpKitchen(ctx.app);
    await setDomain(admin, DOMAIN);
    expect((await setDomain(admin, null)).json().outsideDomain).toBeNull();
    const outside = await from(OUTSIDE, '198.51.100.1', {
      method: 'GET',
      url: '/api/access/status',
    });
    expect(outside.statusCode).toBe(200);
  });

  it('takes only a bare domain name', async () => {
    const admin = await setUpKitchen(ctx.app);
    for (const bad of [
      'https://mise.example.com',
      'mise.example.com/path',
      'mise',
      '203.0.113.9',
      'a b.com',
      'mise.example.com:8443',
    ]) {
      expect((await setDomain(admin, bad)).statusCode, bad).toBe(400);
    }
  });

  it('is for administrators only', async () => {
    const admin = await setUpKitchen(ctx.app);
    await from(INSIDE, 'mise.local', {
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Sous',
        role: 'sous_chef',
        email: 'sous@example.com',
        password: 'a-long-sous-password',
      },
      cookie: `mise_session=${admin}`,
    });
    const signedIn = await from(INSIDE, 'mise.local', {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sous@example.com', password: 'a-long-sous-password' },
    });
    const sous = cookieFrom(signedIn, 'mise_session')!;
    expect((await setDomain(sous, DOMAIN)).statusCode).toBe(403);
  });

  it('is switched off with OUTSIDE_ACCESS=open, as a way back in', async () => {
    const admin = await setUpKitchen(ctx.app);
    await setDomain(admin, DOMAIN);
    const open = await buildApp(
      { ...TEST_CONFIG, OUTSIDE_ACCESS: 'open' },
      { db: ctx.db, serveClient: false },
    );
    try {
      const response = await open.inject({
        method: 'GET',
        url: '/api/auth/me',
        remoteAddress: OUTSIDE,
        headers: { host: '198.51.100.1' },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await open.close();
    }
  });
});
