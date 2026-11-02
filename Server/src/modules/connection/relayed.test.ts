import { describe, expect, it, vi } from 'vitest';
import { setUpKitchen, useTestContext } from '../../test/harness.js';

// As in a rootless container, whose relay is 10.0.2.2.
vi.mock('../../lib/containerGateway.js', () => ({
  containerGateways: () => new Set(['10.0.2.2']),
}));

const ctx = useTestContext();

function connection(admin: string, from: string) {
  return ctx.app.inject({
    method: 'GET',
    url: '/api/connection',
    remoteAddress: from,
    headers: { host: '192.168.1.5:3000', cookie: `mise_session=${admin}` },
  });
}

describe('visitors relayed by the container', () => {
  it('are noticed, so Settings → Connection can warn that anyone may look inside', async () => {
    const admin = await setUpKitchen(ctx.app);
    expect((await connection(admin, '192.168.1.20')).json().containerGateway).toBeNull();

    await ctx.app.inject({
      method: 'GET',
      url: '/api/access/status',
      remoteAddress: '10.0.2.2',
      headers: { host: '192.168.1.5:3000' },
    });
    expect((await connection(admin, '192.168.1.20')).json().containerGateway).toMatchObject({
      address: '10.0.2.2',
    });
  });
});
