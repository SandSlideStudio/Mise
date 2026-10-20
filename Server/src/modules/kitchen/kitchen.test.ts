import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

function as(cookie: string) {
  return { mise_session: cookie };
}

/** Create a staff member and hand back the parsed row. */
async function addStaff(
  app: FastifyInstance,
  cookie: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; displayName: string; hasPin: boolean; hasPassword: boolean }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/users',
    payload,
    cookies: as(cookie),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not create staff: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

describe('stations', () => {
  it('seeds a starting brigade at setup', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((s: { name: string }) => s.name)).toEqual([
      'Larder',
      'Sauce',
      'Sauté',
      'Grill',
      'Pastry',
    ]);
  });

  it('renames a station to match the real brigade', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies: as(admin) });
    const id = list.json()[0].id;

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/stations/${id}`,
      payload: { name: 'Garde manger' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Garde manger');
  });

  it('applies a whole new order in one call', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies: as(admin) });
    const reversed = list
      .json()
      .map((s: { id: string }) => s.id)
      .reverse();

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/stations/reorder',
      payload: { ids: reversed },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().map((s: { name: string }) => s.name)).toEqual([
      'Pastry',
      'Grill',
      'Sauté',
      'Sauce',
      'Larder',
    ]);
  });

  it('deletes a station without taking anything else with it', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies: as(admin) });
    const id = list.json()[0].id;

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/stations/${id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(204);

    const after = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies: as(admin) });
    expect(after.json()).toHaveLength(4);
  });

  it('needs a session even to read the list', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/stations' });
    expect(response.statusCode).toBe(401);
  });
});

describe('creating staff', () => {
  it('creates a cook who signs in by PIN alone', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    expect(cook.hasPin).toBe(true);
    expect(cook.hasPassword).toBe(false);
  });

  it('creates a sous chef with a password', async () => {
    const sous = await addStaff(ctx.app, admin, {
      displayName: 'Amelie',
      role: 'sous_chef',
      email: 'amelie@example.com',
      password: 'a-long-enough-password',
    });
    expect(sous.hasPassword).toBe(true);
  });

  it('refuses somebody with no way to sign in', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Ghost', role: 'cook' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a password account with no email address', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Ghost', role: 'cook', password: 'a-long-enough-password' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a PIN that is not digits', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'cook', pin: 'abcd' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('never reports anything derived from the secret', async () => {
    await addStaff(ctx.app, admin, { displayName: 'Marco', role: 'cook', pin: '4821' });
    const response = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const body = response.body;
    expect(body).not.toContain('argon2');
    expect(body).not.toContain('pinHash');
    expect(body).not.toContain('4821');
  });
});

describe('editing staff', () => {
  it('resets a forgotten PIN and clears the lockout with it', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });

    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: as(admin),
    });
    const device = cookieFrom(enrolled, 'mise_device')!;

    // Lock the account out with bad guesses.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/pin-login',
        payload: { userId: cook.id, pin: '0000' },
        cookies: { mise_device: device },
      });
    }

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${cook.id}`,
      payload: { pin: '1234' },
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cook.id, pin: '1234' },
      cookies: { mise_device: device },
    });
    expect(response.statusCode).toBe(200);
  });

  it('signs somebody out everywhere when their PIN changes', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: as(admin),
    });
    const device = cookieFrom(enrolled, 'mise_device')!;

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cook.id, pin: '4821' },
      cookies: { mise_device: device },
    });
    const cookCookie = cookieFrom(signedIn, 'mise_session')!;

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${cook.id}`,
      payload: { pin: '1234' },
      cookies: as(admin),
    });

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: as(cookCookie),
    });
    expect(after.statusCode).toBe(401);
  });

  it('clearing a PIN takes somebody off the tablet roster', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
      email: 'marco@example.com',
      password: 'a-long-enough-password',
    });

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${cook.id}`,
      payload: { pin: null },
      cookies: as(admin),
    });

    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: as(admin),
    });
    const device = cookieFrom(enrolled, 'mise_device')!;
    const roster = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/roster',
      cookies: { mise_device: device },
    });
    expect(roster.json()).toEqual([]);
  });

  it('refuses an edit that would leave somebody unable to sign in', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${cook.id}`,
      payload: { pin: null },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('no way to sign in');
  });

  it('removes someone completely, leaving their prep on the list without a name', async () => {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    const line = await ctx.app.inject({
      method: 'POST',
      url: '/api/running/tasks',
      payload: { description: 'Chicken stock' },
      cookies: as(admin),
    });
    const taskId = line.json().task.id;
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      payload: { status: 'in_progress', assignedUserId: cook.id },
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${cook.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(204);

    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    expect(list.json().find((u: { id: string }) => u.id === cook.id)).toBeUndefined();

    const tasks = await ctx.app.inject({
      method: 'GET',
      url: '/api/running/tasks',
      cookies: as(admin),
    });
    expect(tasks.json()).toEqual([
      expect.objectContaining({ id: taskId, assignedUserId: null, assignedUserName: null }),
    ]);
  });
});

/**
 * A self-hosted server has no support desk. If the last administrator locks
 * themselves out, nobody can let them back in without a database client.
 */
describe('locking yourself out of your own kitchen', () => {
  it('refuses to deactivate the only administrator', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const me = list.json().find((u: { email: string }) => u.email === ADMIN.email);

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${me.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('only administrator');
  });

  it('refuses to demote the only administrator', async () => {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const me = list.json().find((u: { email: string }) => u.email === ADMIN.email);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${me.id}`,
      payload: { role: 'cook' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
  });

  it('allows the demotion once a second administrator exists', async () => {
    await addStaff(ctx.app, admin, {
      displayName: 'Second',
      role: 'admin',
      email: 'second@example.com',
      password: 'a-long-enough-password',
    });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const me = list.json().find((u: { email: string }) => u.email === ADMIN.email);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${me.id}`,
      payload: { role: 'sous_chef' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
  });

  it('refuses to deactivate your own account even with a spare administrator', async () => {
    await addStaff(ctx.app, admin, {
      displayName: 'Second',
      role: 'admin',
      email: 'second@example.com',
      password: 'a-long-enough-password',
    });
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const me = list.json().find((u: { email: string }) => u.email === ADMIN.email);

    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${me.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('your own account');
  });
});

describe('who is allowed to manage the brigade', () => {
  async function signInAsCook(): Promise<string> {
    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: as(admin),
    });
    const device = cookieFrom(enrolled, 'mise_device')!;
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cook.id, pin: '4821' },
      cookies: { mise_device: device },
    });
    return cookieFrom(signedIn, 'mise_session')!;
  }

  it('stops a cook reading the staff list', async () => {
    const cook = await signInAsCook();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a cook creating an account', async () => {
    const cook = await signInAsCook();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Rogue', role: 'admin', pin: '0000' },
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a cook renaming a station', async () => {
    const cook = await signInAsCook();
    const list = await ctx.app.inject({ method: 'GET', url: '/api/stations', cookies: as(cook) });
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/stations/${list.json()[0].id}`,
      payload: { name: 'Mine now' },
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(403);
  });

  it('lets a cook read the station list, because the prep views need it', async () => {
    const cook = await signInAsCook();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('managing people at or above your own rank', () => {
  async function signInAsHeadChef(): Promise<{ cookie: string; id: string }> {
    const chef = await addStaff(ctx.app, admin, {
      displayName: 'Ana',
      role: 'head_chef',
      email: 'ana@example.com',
      password: 'a-long-enough-password',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'a-long-enough-password' },
    });
    return { cookie: cookieFrom(login, 'mise_session')!, id: chef.id };
  }

  async function adminId(): Promise<string> {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    return list.json().find((u: { email: string }) => u.email === ADMIN.email).id;
  }

  it('lets a head chef add cooks and sous chefs', async () => {
    const chef = await signInAsHeadChef();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'sous_chef', pin: '4821' },
      cookies: as(chef.cookie),
    });
    expect(response.statusCode).toBe(200);
  });

  it('stops a head chef creating an administrator', async () => {
    const chef = await signInAsHeadChef();
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Mallory',
        role: 'admin',
        email: 'mallory@example.com',
        password: 'a-long-enough-password',
      },
      cookies: as(chef.cookie),
    });
    expect(response.statusCode).toBe(403);
  });

  it("stops a head chef changing an administrator's password", async () => {
    const chef = await signInAsHeadChef();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${await adminId()}`,
      payload: { password: 'taken-over-the-kitchen' },
      cookies: as(chef.cookie),
    });
    expect(response.statusCode).toBe(403);

    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(login.statusCode).toBe(200);
  });

  it('stops a head chef promoting themselves', async () => {
    const chef = await signInAsHeadChef();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${chef.id}`,
      payload: { role: 'admin' },
      cookies: as(chef.cookie),
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a head chef removing an administrator', async () => {
    const chef = await signInAsHeadChef();
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${await adminId()}`,
      cookies: as(chef.cookie),
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses an administrator who could only sign in with a PIN', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Pin Admin', role: 'admin', pin: '1234' },
      cookies: as(admin),
    });
    expect(created.statusCode).toBe(400);

    const cook = await addStaff(ctx.app, admin, {
      displayName: 'Marco',
      role: 'cook',
      pin: '4821',
    });
    const promoted = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${cook.id}`,
      payload: { role: 'admin' },
      cookies: as(admin),
    });
    expect(promoted.statusCode).toBe(400);
  });
});

describe('kitchen settings', () => {
  it('renames the kitchen', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { name: 'The Ship Inn' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('The Ship Inn');

    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(admin) });
    expect(me.json().user.kitchenName).toBe('The Ship Inn');
  });

  it('switches the kitchen to imperial', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { unitSystem: 'imperial' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().unitSystem).toBe('imperial');
  });
});

describe('email addresses', () => {
  it('treat capitals as the same address, since sign-in does', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Copycat',
        role: 'sous_chef',
        email: ADMIN.email.toUpperCase(),
        password: 'a-long-enough-password',
      },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
  });
});
