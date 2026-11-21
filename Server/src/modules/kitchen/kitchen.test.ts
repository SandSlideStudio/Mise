import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { writeReceipts } from '../../db/schema.js';
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
      url: '/api/auth/sign-in-options',
      cookies: { mise_device: device },
    });
    expect(roster.json().people).toEqual([]);
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

  it('keeps no answer to a retried write that names someone removed', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { displayName: 'Marco', role: 'cook', email: 'Marco@example.com', pin: '4821' },
      headers: { 'x-mise-write': 'create-marco-0001' },
      cookies: as(admin),
    });
    expect(created.statusCode).toBe(200);
    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${created.json().id}`,
      cookies: as(admin),
    });
    expect(removed.statusCode).toBe(204);

    const kept = await ctx.db.select().from(writeReceipts);
    expect(kept.filter((receipt) => receipt.body?.toLowerCase().includes('marco'))).toEqual([]);
  });
});

describe('two administrators stepping down at the same moment', () => {
  /** A second administrator, signed in. */
  async function secondAdmin() {
    const email = 'sous@example.com';
    const password = 'another-long-password';
    const created = await addStaff(ctx.app, admin, {
      displayName: 'Sous',
      email,
      password,
      role: 'admin',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });
    return { id: created.id, cookie: cookieFrom(login, 'mise_session')! };
  }

  async function myId() {
    const list = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    return list.json().find((u: { email: string }) => u.email === ADMIN.email).id as string;
  }

  // The test database has one connection, so the two requests are interleaved
  // rather than truly parallel; the lock inside the write is what makes any
  // order safe on a real server.
  it('removes only one of two administrators removing each other', async () => {
    const other = await secondAdmin();
    const mine = await myId();
    const [a, b] = await Promise.all([
      ctx.app.inject({ method: 'DELETE', url: `/api/users/${other.id}`, cookies: as(admin) }),
      ctx.app.inject({ method: 'DELETE', url: `/api/users/${mine}`, cookies: as(other.cookie) }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([204, 409]);
    const loser = a.statusCode === 409 ? a : b;
    expect(loser.json().error.message).toContain('only administrator');
  });

  it('demotes only one of two administrators demoting each other', async () => {
    const other = await secondAdmin();
    const mine = await myId();
    const [a, b] = await Promise.all([
      ctx.app.inject({
        method: 'PATCH',
        url: `/api/users/${other.id}`,
        payload: { role: 'cook' },
        cookies: as(admin),
      }),
      ctx.app.inject({
        method: 'PATCH',
        url: `/api/users/${mine}`,
        payload: { role: 'cook' },
        cookies: as(other.cookie),
      }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
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

  it('no longer has a metric or imperial setting', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { unitSystem: 'imperial' },
      cookies: as(admin),
    });
    // Sent by an app from before 2.2.4: ignored, not an error.
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('unitSystem');
  });
});

describe('label settings', () => {
  it('start on the small Brother roll, printing only when asked', async () => {
    const kitchen = await ctx.app.inject({
      method: 'GET',
      url: '/api/kitchen',
      cookies: as(admin),
    });
    expect(kitchen.json()).toMatchObject({ labelSize: '62x29', labelOnTick: false });
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(admin) });
    expect(me.json().user.labels).toEqual({ size: '62x29', onTick: false });
  });

  it('are kept, and reach everyone signed in with who they are', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { labelSize: '89x36', labelOnTick: true },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ labelSize: '89x36', labelOnTick: true });

    // The tablets print offline from what they were told at sign-in.
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(admin) });
    expect(me.json().user.labels).toEqual({ size: '89x36', onTick: true });

    // Changing one leaves the other.
    const again = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { labelOnTick: false },
      cookies: as(admin),
    });
    expect(again.json()).toMatchObject({ labelSize: '89x36', labelOnTick: false });
  });

  it('refuses a size no printer has', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { labelSize: '10x10' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('are an administrator’s to change, like the rest of the kitchen', async () => {
    await addStaff(ctx.app, admin, {
      displayName: 'Ana',
      email: 'ana@example.com',
      role: 'head_chef',
      password: 'a long enough password',
    });
    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'a long enough password' },
    });
    const chef = cookieFrom(signIn, 'mise_session')!;
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { labelOnTick: true },
      cookies: as(chef),
    });
    expect(response.statusCode).toBe(403);
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

describe('changing your own password or email', () => {
  async function myId(): Promise<string> {
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(admin) });
    return me.json().user.id;
  }

  const editMe = async (payload: Record<string, unknown>) =>
    ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${await myId()}`,
      payload,
      cookies: as(admin),
    });

  const signIn = (email: string, password: string) =>
    ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });

  it('asks for the current password, even inside the kitchen', async () => {
    const without = await editMe({ password: 'someone-elses-choice' });
    expect(without.statusCode).toBe(403);
    expect(without.json().error.code).toBe('password_missing');
    const wrong = await editMe({ password: 'someone-elses-choice', currentPassword: 'guess' });
    expect(wrong.json().error.code).toBe('wrong_password');
    const otherEmail = await editMe({ email: 'taken-over@example.com' });
    expect(otherEmail.json().error.code).toBe('password_missing');
    // Nothing changed: the owner still gets in.
    expect((await signIn(ADMIN.email, ADMIN.password)).statusCode).toBe(200);

    const changed = await editMe({
      password: 'my-own-new-password',
      email: 'escoffier@example.com',
      currentPassword: ADMIN.password,
    });
    expect(changed.statusCode).toBe(200);
    expect((await signIn('escoffier@example.com', 'my-own-new-password')).statusCode).toBe(200);
  });

  it('counts a wrong current password like a wrong sign-in', async () => {
    for (let i = 0; i < 10; i++) {
      await editMe({ password: 'someone-elses-choice', currentPassword: 'still-guessing' });
    }
    const locked = await editMe({
      password: 'my-own-new-password',
      currentPassword: ADMIN.password,
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe('account_locked');
  });

  it('never lets you lift your own lock, not even with a new PIN of your own', async () => {
    for (let i = 0; i < 10; i++) {
      await editMe({ password: 'someone-elses-choice', currentPassword: 'still-guessing' });
    }
    const lift = await ctx.app.inject({
      method: 'POST',
      url: `/api/users/${await myId()}/unlock`,
      cookies: as(admin),
    });
    expect(lift.statusCode).toBe(403);
    expect(lift.json().error.code).toBe('own_lock');
    const id = await myId();
    expect((await editMe({ pin: '7356' })).statusCode).toBe(200);
    // Still locked, where the guesses came from.
    const still = await ctx.app.auth.confirmPassword(id, ADMIN.password, '127.0.0.1');
    expect(still).toMatchObject({ lockedUntil: expect.any(Date) });
  });

  it('asks nothing for your name, or for the same email sent back unchanged', async () => {
    const renamed = await editMe({ displayName: 'Auguste', email: ADMIN.email, role: 'admin' });
    expect(renamed.statusCode).toBe(200);
  });

  it('asks nothing more inside the kitchen to set someone else’s password', async () => {
    const chef = await addStaff(ctx.app, admin, { displayName: 'Rosa', role: 'cook', pin: '4821' });
    const set = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${chef.id}`,
      payload: { role: 'sous_chef', email: 'rosa@example.com', password: 'rosas-own-password' },
      cookies: as(admin),
    });
    expect(set.statusCode).toBe(200);
  });
});
