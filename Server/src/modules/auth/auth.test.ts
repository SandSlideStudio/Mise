import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users } from '../../db/schema.js';
import { hashSecret } from '../../lib/crypto.js';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();

describe('first run', () => {
  it('reports that a fresh server needs setting up', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      needsSetup: true,
      language: 'en',
      kitchenName: null,
      setupTokenRequired: false,
    });
  });

  it('creates the kitchen, the admin, and a starting set of stations', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.role).toBe('admin');
    expect(response.json().user.kitchenName).toBe(ADMIN.kitchenName);

    const stations = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(stations.json()).toEqual({
      needsSetup: false,
      language: 'en',
      kitchenName: ADMIN.kitchenName,
      setupTokenRequired: false,
    });
  });

  it('signs the new administrator straight in', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(cookieFrom(response, 'mise_session')).toBeTruthy();
  });

  it('stops existing once a user exists, so nobody can create a second admin', async () => {
    await setUpKitchen(ctx.app);
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, email: 'intruder@example.com' },
    });
    expect(second.statusCode).toBe(404);
  });

  it('rejects a password that is too short to be worth having', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('password sign-in', () => {
  beforeEach(async () => {
    await setUpKitchen(ctx.app);
  });

  it('accepts the right password', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.email).toBe(ADMIN.email);
    expect(cookieFrom(response, 'mise_session')).toBeTruthy();
  });

  it('is not case sensitive about the email address', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email.toUpperCase(), password: ADMIN.password },
    });
    expect(response.statusCode).toBe(200);
  });

  it('rejects the wrong password without saying which half was wrong', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: 'not-the-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.message).not.toContain('password');
  });

  it('gives the same answer for an account that does not exist', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'not-the-password' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });

  it('locks the account after five failed attempts', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: 'wrong' },
      });
    }
    // Even the correct password is refused while the lockout stands.
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('account_locked');
  });

  it('resets the failure count after a good sign-in', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: 'wrong' },
    });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    const [user] = await ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    expect(user?.failedAttempts).toBe(0);
  });
});

describe('sessions', () => {
  it('identifies the signed-in user', async () => {
    const cookie = await setUpKitchen(ctx.app);
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { mise_session: cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.displayName).toBe(ADMIN.displayName);
  });

  it('refuses a request with no session', async () => {
    await setUpKitchen(ctx.app);
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
  });

  it('stops working the moment someone signs out', async () => {
    const cookie = await setUpKitchen(ctx.app);
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { mise_session: cookie },
    });
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { mise_session: cookie },
    });
    expect(after.statusCode).toBe(401);
  });

  it('never stores the session token itself', async () => {
    const cookie = await setUpKitchen(ctx.app);
    const rows = await ctx.db.query.sessions.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(cookie);
  });
});

describe('PIN sign-in on the line', () => {
  let adminCookie: string;
  let cookId: string;

  beforeEach(async () => {
    adminCookie = await setUpKitchen(ctx.app);
    const [cook] = await ctx.db
      .insert(users)
      .values({
        displayName: 'Marco',
        role: 'cook',
        pinHash: await hashSecret('4821'),
      })
      .returning({ id: users.id });
    cookId = cook!.id;
  });

  it('refuses PIN sign-in on a tablet nobody enrolled', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cookId, pin: '4821' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('device_not_enrolled');
  });

  it('hides the staff roster from an unenrolled tablet', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/roster' });
    expect(response.statusCode).toBe(403);
  });

  it('accepts the PIN once an admin has enrolled the tablet', async () => {
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    expect(enrolled.statusCode).toBe(200);
    const deviceCookie = cookieFrom(enrolled, 'mise_device');
    expect(deviceCookie).toBeTruthy();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cookId, pin: '4821' },
      cookies: { mise_device: deviceCookie! },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().user.displayName).toBe('Marco');
  });

  it('shows the roster on an enrolled tablet, listing only staff with a PIN', async () => {
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    const deviceCookie = cookieFrom(enrolled, 'mise_device')!;

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/roster',
      cookies: { mise_device: deviceCookie },
    });
    expect(response.statusCode).toBe(200);
    // The admin signs in with a password, so they are not on the tablet roster.
    expect(response.json()).toEqual([
      expect.objectContaining({ displayName: 'Marco', role: 'cook', stationName: null }),
    ]);
  });

  it('names the station under each cook, because nobody is signed in to look it up', async () => {
    const [station] = await ctx.db.query.stations.findMany();
    await ctx.db.update(users).set({ defaultStationId: station!.id }).where(eq(users.id, cookId));

    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/roster',
      cookies: { mise_device: cookieFrom(enrolled, 'mise_device')! },
    });

    expect(response.json()).toEqual([
      expect.objectContaining({ displayName: 'Marco', stationName: station!.name }),
    ]);
  });

  it('refuses the wrong PIN, and locks the cook out after five tries', async () => {
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    const deviceCookie = cookieFrom(enrolled, 'mise_device')!;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bad = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/pin-login',
        payload: { userId: cookId, pin: '0000' },
        cookies: { mise_device: deviceCookie },
      });
      expect(bad.statusCode).toBe(401);
    }

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cookId, pin: '4821' },
      cookies: { mise_device: deviceCookie },
    });
    expect(response.statusCode).toBe(429);
  });

  it('signs everyone out of a tablet when it is revoked', async () => {
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    const deviceCookie = cookieFrom(enrolled, 'mise_device')!;
    const deviceId = enrolled.json().id;

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cookId, pin: '4821' },
      cookies: { mise_device: deviceCookie },
    });
    const cookCookie = cookieFrom(signedIn, 'mise_session')!;

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/auth/devices/${deviceId}`,
      cookies: { mise_session: adminCookie },
    });

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { mise_session: cookCookie },
    });
    expect(after.statusCode).toBe(401);
  });
});

describe('roles', () => {
  it('stops a cook from enrolling a device', async () => {
    const adminCookie = await setUpKitchen(ctx.app);
    const [cook] = await ctx.db
      .insert(users)
      .values({ displayName: 'Marco', role: 'cook', pinHash: await hashSecret('4821') })
      .returning({ id: users.id });

    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: { mise_session: adminCookie },
    });
    const deviceCookie = cookieFrom(enrolled, 'mise_device')!;

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cook!.id, pin: '4821' },
      cookies: { mise_device: deviceCookie },
    });
    const cookCookie = cookieFrom(signedIn, 'mise_session')!;

    const attempt = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Rogue tablet' },
      cookies: { mise_session: cookCookie },
    });
    expect(attempt.statusCode).toBe(403);
  });
});

describe('the database refuses nonsense', () => {
  it('will not store a user with no way to sign in', async () => {
    await setUpKitchen(ctx.app);
    await expect(
      ctx.db.insert(users).values({ displayName: 'Ghost', role: 'cook' }),
    ).rejects.toThrow();
  });

  it('will not store a password account with no email address', async () => {
    await setUpKitchen(ctx.app);
    await expect(
      ctx.db.insert(users).values({
        displayName: 'Ghost',
        role: 'cook',
        passwordHash: await hashSecret('x'.repeat(12)),
      }),
    ).rejects.toThrow();
  });
});

describe('guessing many passwords at once', () => {
  it('still locks the account after five', async () => {
    await setUpKitchen(ctx.app);
    const guesses = Array.from({ length: 8 }, (_, i) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: `wrong-guess-${i}` },
      }),
    );
    const responses = await Promise.all(guesses);
    expect(
      responses.filter((r) => r.json().error?.code === 'account_locked').length,
    ).toBeGreaterThan(0);

    // Locked now, even for the right password.
    const real = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(real.json().error?.code).toBe('account_locked');
  });
});
