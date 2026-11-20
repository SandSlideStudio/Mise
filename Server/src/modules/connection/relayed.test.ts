import { describe, expect, it, vi } from 'vitest';
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

// As in a rootless container, whose relay is 10.0.2.2.
vi.mock('../../lib/containerGateway.js', () => ({
  containerGateways: () => new Set(['10.0.2.2']),
}));

const ctx = useTestContext();

const INSIDE = '192.168.1.20';
const RELAY = '10.0.2.2';

function connection(admin: string) {
  return ctx.app.inject({
    method: 'GET',
    url: '/api/connection',
    remoteAddress: INSIDE,
    headers: { host: '192.168.1.5:3000', cookie: `mise_session=${admin}` },
  });
}

async function statusFrom(address: string, headers: Record<string, string> = {}) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/access/status',
    remoteAddress: address,
    headers: { host: '192.168.1.5:3000', ...headers },
  });
  return response.json().status as string;
}

describe('visitors relayed by the container', () => {
  it('count as outside by default, and Settings → Connection says why', async () => {
    const admin = await setUpKitchen(ctx.app);
    expect((await connection(admin)).json()).toMatchObject({
      containerGateway: null,
      trustContainerGateway: false,
    });

    // Anyone on the internet would arrive from the same address: outside.
    expect(await statusFrom(RELAY)).toBe('none');
    expect(await statusFrom(INSIDE)).toBe('inside');
    expect((await connection(admin)).json().containerGateway).toMatchObject({ address: RELAY });
  });

  it('count as inside once an administrator says so, and as outside again when switched off', async () => {
    const admin = await setUpKitchen(ctx.app);
    const set = (trustContainerGateway: boolean) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/api/connection',
        remoteAddress: INSIDE,
        headers: { host: '192.168.1.5:3000', cookie: `mise_session=${admin}` },
        payload: { trustContainerGateway },
      });

    const on = await set(true);
    expect(on.statusCode).toBe(200);
    expect(on.json().trustContainerGateway).toBe(true);
    expect(await statusFrom(RELAY)).toBe('inside');

    await set(false);
    expect(await statusFrom(RELAY)).toBe('none');
  });

  it('count as inside only with the password, when it is set from outside', async () => {
    // Everyone comes through the relay, the administrator too, so this can be
    // set from outside; a signed-in phone that went missing must not, or it
    // would count as inside itself and pass every other check.
    await setUpKitchen(ctx.app);
    const phone = await approvedOutside(ctx.app);
    const relayed = (options: InjectOptions & { cookie?: string }) =>
      ctx.app.inject({
        ...options,
        remoteAddress: RELAY,
        headers: {
          host: '192.168.1.5:3000',
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      });
    const signedIn = await relayed({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
      cookie: phone,
    });
    const cookie = `mise_session=${cookieFrom(signedIn, 'mise_session')!}; ${phone}`;
    const set = (payload: object) =>
      relayed({ method: 'PUT', url: '/api/connection', payload, cookie });

    const refused = await set({ trustContainerGateway: true });
    expect(refused.json().error.code).toBe('wrong_password');
    expect(await statusFrom(RELAY)).toBe('none');
    // Nor slipped in: an administrator added from there still asks too.
    const helper = await relayed({
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Helper',
        role: 'admin',
        email: 'helper@evil.example',
        password: 'thief-chosen-password',
      },
      cookie,
    });
    expect(helper.json().error.code).toBe('wrong_password');

    const trusted = await set({ trustContainerGateway: true, currentPassword: ADMIN.password });
    expect(trusted.statusCode).toBe(200);
    expect(await statusFrom(RELAY)).toBe('inside');
  });

  it('leave a trusted web server on the host passing visitors on as it was', async () => {
    const admin = await setUpKitchen(ctx.app);
    // Apache on the host reaches Mise through the published port, so from the relay.
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/connection',
      remoteAddress: INSIDE,
      headers: { host: '192.168.1.5:3000', cookie: `mise_session=${admin}` },
      payload: { trustedProxy: RELAY },
    });
    expect(await statusFrom(RELAY, { 'x-forwarded-for': '192.168.1.30' })).toBe('inside');
    expect(await statusFrom(RELAY, { 'x-forwarded-for': '203.0.113.7' })).toBe('none');
  });

  it("aren't let in by a forwarded address when TRUST_PROXY is set for Caddy", async () => {
    await setUpKitchen(ctx.app);
    // Caddy from the compose file, with its own address on the compose network.
    const app = await buildApp(
      { ...TEST_CONFIG, TRUST_PROXY: 1 },
      { db: ctx.db, serveClient: false },
    );
    try {
      const status = async (address: string, forwardedFor: string) => {
        const response = await app.inject({
          method: 'GET',
          url: '/api/access/status',
          remoteAddress: address,
          headers: { host: 'mise.example.com', 'x-forwarded-for': forwardedFor },
        });
        return response.json().status as string;
      };
      // Someone on the internet, relayed to the published port, naming a kitchen address.
      expect(await status(RELAY, '192.168.1.30')).toBe('none');
      // Caddy passing on a visitor on the kitchen network still counts them inside.
      expect(await status('172.18.0.5', '192.168.1.30')).toBe('inside');
      expect(await status('172.18.0.5', '203.0.113.7')).toBe('none');
    } finally {
      await app.close();
    }
  });
});
