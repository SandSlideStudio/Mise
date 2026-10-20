import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;
let device: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
  const enrolled = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/devices',
    payload: { name: 'Pass tablet' },
    cookies: { mise_session: admin },
  });
  device = cookieFrom(enrolled, 'mise_device')!;
});

async function roster(): Promise<{ id: string; displayName: string; pinLength: number | null }[]> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/auth/roster',
    cookies: { mise_device: device },
  });
  return response.json();
}

describe('the sign-in screens', () => {
  it('know which kitchen this is before anyone signs in', async () => {
    const status = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toEqual({
      needsSetup: false,
      language: 'en',
      kitchenName: ADMIN.kitchenName,
      setupTokenRequired: false,
    });
  });

  it('know how long each PIN is, so the pad can sign in the moment it is complete', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'cook', pin: '482193' },
      cookies: { mise_session: admin },
    });
    const id = created.json().id;
    expect((await roster()).find((p) => p.id === id)?.pinLength).toBe(6);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${id}`,
      payload: { pin: '1234' },
      cookies: { mise_session: admin },
    });
    expect((await roster()).find((p) => p.id === id)?.pinLength).toBe(4);

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: id, pin: '1234' },
      cookies: { mise_device: device },
    });
    expect(signedIn.statusCode).toBe(200);
  });
});
