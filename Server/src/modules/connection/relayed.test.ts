import { describe, expect, it, vi } from 'vitest';
import { setUpKitchen, useTestContext } from '../../test/harness.js';

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
});
