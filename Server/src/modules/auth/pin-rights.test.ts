import { beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

/**
 * A PIN is four or six digits, guessable in days. So a chef or administrator
 * signed in with one can do the kitchen's work, but nothing that touches
 * security: that asks for the password.
 */

const ctx = useTestContext();
let byPassword = '';
let byPin = '';
let adminId = '';

beforeEach(async () => {
  byPassword = await setUpKitchen(ctx.app);
  const me = await ctx.app.inject({
    method: 'GET',
    url: '/api/auth/me',
    cookies: { mise_session: byPassword },
  });
  adminId = me.json().user.id;
  await ctx.app.inject({
    method: 'PATCH',
    url: `/api/users/${adminId}`,
    payload: { pin: '4821' },
    cookies: { mise_session: byPassword },
  });
  // A new credential ends that person's other sessions: sign in again.
  const again = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ADMIN.email, password: ADMIN.password },
  });
  byPassword = cookieFrom(again, 'mise_session')!;
  const enrolled = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/devices',
    payload: { name: 'Pass tablet' },
    cookies: { mise_session: byPassword },
  });
  const device = cookieFrom(enrolled, 'mise_device')!;
  const signedIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    payload: { userId: adminId, pin: '4821' },
    cookies: { mise_device: device },
  });
  expect(signedIn.statusCode).toBe(200);
  byPin = cookieFrom(signedIn, 'mise_session')!;
});

const as = (
  cookie: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) => ctx.app.inject({ method, url, payload, cookies: { mise_session: cookie } });

describe('an administrator signed in with a PIN', () => {
  it('says so, so the app can grey out what needs the password', async () => {
    expect((await as(byPin, 'GET', '/api/auth/me')).json().user.onTablet).toBe(true);
    expect((await as(byPassword, 'GET', '/api/auth/me')).json().user.onTablet).toBe(false);
  });

  it('does the kitchen’s work: recipes, the prep list, stations, kitchen settings', async () => {
    expect(
      (
        await as(byPin, 'POST', '/api/recipes', {
          name: 'Stock',
          type: 'prep',
          yield: { value: 1, unit: 'l' },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await as(byPin, 'POST', '/api/running/tasks', { description: 'Onions' })).statusCode,
    ).toBe(200);
    expect((await as(byPin, 'POST', '/api/stations', { name: 'Garde manger' })).statusCode).toBe(
      200,
    );
    expect(
      (await as(byPin, 'PATCH', '/api/kitchen', { name: 'The Test Kitchen' })).statusCode,
    ).toBe(200);
  });

  it('is asked for the password for anything that touches security', async () => {
    const security: [
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      url: string,
      payload?: object,
    ][] = [
      ['GET', '/api/backups'],
      ['GET', '/api/backups/key'],
      ['POST', '/api/backups/run'],
      ['POST', '/api/users', { displayName: 'Sam', role: 'cook', pin: '1234' }],
      ['PATCH', `/api/users/${adminId}`, { pin: '9999' }],
      ['POST', '/api/auth/devices', { name: 'Another tablet' }],
      ['PUT', '/api/connection', { outsideDomain: 'mise.example.com' }],
      ['PUT', '/api/connection/kitchen-https', { names: ['192.168.1.50'] }],
    ];
    for (const [method, url, payload] of security) {
      const response = await as(byPin, method, url, payload);
      expect(response.statusCode, `${method} ${url}`).toBe(403);
      expect(response.json().error.code, `${method} ${url}`).toBe('password_required');
    }
    // With the password, the same is fine.
    expect((await as(byPassword, 'GET', '/api/backups')).statusCode).toBe(200);
  });
});

describe('PIN guesses across tablets', () => {
  it('lock the person, not just the tablet', async () => {
    const tablets = await Promise.all(
      ['One', 'Two'].map(async (name) => {
        const enrolled = await as(byPassword, 'POST', '/api/auth/devices', { name });
        return cookieFrom(enrolled, 'mise_device')!;
      }),
    );
    const guess = (device: string, pin: string) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/pin-login',
        payload: { userId: adminId, pin },
        cookies: { mise_device: device },
      });
    for (let i = 0; i < 3; i += 1) expect((await guess(tablets[0]!, '0000')).statusCode).toBe(401);
    for (let i = 0; i < 2; i += 1) expect((await guess(tablets[1]!, '0000')).statusCode).toBe(401);
    // Five wrong across two tablets: even the right PIN waits now, on either.
    expect((await guess(tablets[0]!, '4821')).statusCode).toBe(429);
    expect((await guess(tablets[1]!, '4821')).statusCode).toBe(429);
    // The password still works.
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.statusCode).toBe(200);
  });
});
