import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

function as(cookie: string) {
  return { mise_session: cookie };
}

async function me(cookie: string) {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/auth/me',
    cookies: as(cookie),
  });
  return response.json().user;
}

async function signInCook(): Promise<{ cookie: string; user: { tourSeen: boolean } }> {
  const created = await ctx.app.inject({
    method: 'POST',
    url: '/api/users',
    payload: { displayName: 'Marco', role: 'cook', pin: '4821' },
    cookies: as(admin),
  });
  const enrolled = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/devices',
    payload: { name: 'Pass tablet' },
    cookies: as(admin),
  });
  const signedIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    payload: { userId: created.json().id, pin: '4821' },
    cookies: { mise_device: cookieFrom(enrolled, 'mise_device')! },
  });
  return { cookie: cookieFrom(signedIn, 'mise_session')!, user: signedIn.json().user };
}

describe('the tour', () => {
  it('is offered to someone new, and not again once they have answered', async () => {
    expect((await me(admin)).tourSeen).toBe(false);

    const answered = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { tourSeen: true },
      cookies: as(admin),
    });
    expect(answered.statusCode).toBe(200);
    expect(answered.json().user.tourSeen).toBe(true);
    expect((await me(admin)).tourSeen).toBe(true);
  });

  it('asks each person for themselves, including a cook on their first PIN sign-in', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { tourSeen: true },
      cookies: as(admin),
    });

    const cook = await signInCook();
    expect(cook.user.tourSeen).toBe(false);
  });

  it('leaves the tour alone when someone only changes their language', async () => {
    const changed = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { language: 'nl' },
      cookies: as(admin),
    });
    expect(changed.json().user).toMatchObject({ language: 'nl', tourSeen: false });
  });
});
