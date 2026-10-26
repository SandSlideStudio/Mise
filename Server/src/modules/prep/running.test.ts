import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { prepTasks } from '../../db/schema.js';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

function as(cookie: string) {
  return { mise_session: cookie };
}

interface Line {
  id: string;
  recipeId: string | null;
  stationId: string | null;
  description: string;
  status: string;
  quantity: { value: number; unit: string } | null;
}

async function add(payload: Record<string, unknown>, cookie = admin) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/running/tasks',
    payload,
    cookies: as(cookie),
  });
}

async function list(): Promise<Line[]> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/running/tasks',
    cookies: as(admin),
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

async function setStatus(id: string, status: string, cookie = admin) {
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/tasks/${id}`,
    payload: { status },
    cookies: as(cookie),
  });
}

/** Pretend a tick happened some hours ago. */
async function tickedHoursAgo(id: string, hours: number) {
  await ctx.db
    .update(prepTasks)
    .set({ completedAt: new Date(Date.now() - hours * 3_600_000) })
    .where(eq(prepTasks.id, id));
}

async function stationIds(): Promise<string[]> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/api/stations',
    cookies: as(admin),
  });
  return response.json().map((s: { id: string }) => s.id);
}

async function signInCook(): Promise<string> {
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
  return cookieFrom(signedIn, 'mise_session')!;
}

describe('the kitchen setting', () => {
  it('keeps ticked lines by default, and an administrator can switch to deleting them', async () => {
    const before = await ctx.app.inject({ method: 'GET', url: '/api/kitchen', cookies: as(admin) });
    expect(before.json()).toMatchObject({ tickedRetention: 'keep' });
    expect(before.json()).not.toHaveProperty('prepMode');

    const after = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedRetention: 'delete' },
      cookies: as(admin),
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ tickedRetention: 'delete' });
  });
});

describe('the running list', () => {
  it('holds the lines added to it', async () => {
    const response = await add({
      description: 'Brunoise shallots',
      quantity: { value: 2, unit: 'kg' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      merged: false,
      task: { description: 'Brunoise shallots', status: 'open' },
    });
    expect(await list()).toHaveLength(1);
  });

  it('adds to a line already waiting instead of starting a second one', async () => {
    await add({ description: 'Onions', quantity: { value: 2, unit: 'kg' } });
    const second = await add({ description: '  onions ', quantity: { value: 500, unit: 'g' } });
    expect(second.json().merged).toBe(true);

    const lines = await list();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toEqual({ value: 2500, unit: 'g' });
  });

  it('keeps separate lines for another station, or for amounts that do not add up', async () => {
    const [larder, sauce] = await stationIds();
    await add({ description: 'Onions', stationId: larder, quantity: { value: 1, unit: 'kg' } });
    await add({ description: 'Onions', stationId: sauce, quantity: { value: 1, unit: 'kg' } });
    // A count does not add to a weight.
    await add({ description: 'Onions', stationId: larder, quantity: { value: 3, unit: 'each' } });

    expect(await list()).toHaveLength(3);
  });

  it('starts a fresh line once the old one has been ticked off', async () => {
    const first = await add({ description: 'Pie lids', quantity: { value: 25, unit: 'each' } });
    await setStatus(first.json().task.id, 'done');

    const again = await add({ description: 'Pie lids', quantity: { value: 25, unit: 'each' } });
    expect(again.json().merged).toBe(false);
    expect(await list()).toHaveLength(2);
  });

  it('shows a ticked line for two hours, then drops it for good', async () => {
    const created = await add({ description: 'Pastry cream' });
    const id = created.json().task.id;
    await setStatus(id, 'done');

    await tickedHoursAgo(id, 1.5);
    expect((await list()).map((line) => line.id)).toContain(id);

    await tickedHoursAgo(id, 2.5);
    expect(await list()).toHaveLength(0);

    // No way back by unticking: if it needs doing again, it goes on again.
    const reopened = await setStatus(id, 'open');
    expect(reopened.statusCode).toBe(404);
  });

  it('keeps gone lines in the database by default, out of sight', async () => {
    const created = await add({ description: 'Leeks, washed' });
    const id = created.json().task.id;
    await setStatus(id, 'done');
    await tickedHoursAgo(id, 3);

    await list();
    const rows = await ctx.db.select().from(prepTasks).where(eq(prepTasks.id, id));
    expect(rows).toHaveLength(1);
  });

  it('deletes gone lines when the kitchen chooses to save the space', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedRetention: 'delete' },
      cookies: as(admin),
    });
    const created = await add({ description: 'Leeks, washed' });
    const id = created.json().task.id;
    await setStatus(id, 'done');
    await tickedHoursAgo(id, 3);

    await list();
    const rows = await ctx.db.select().from(prepTasks).where(eq(prepTasks.id, id));
    expect(rows).toHaveLength(0);
  });

  it('lets a cook tick the running list, but not add to it', async () => {
    const created = await add({ description: 'Tarragon, picked' });
    const cook = await signInCook();

    const refused = await add({ description: 'Anything' }, cook);
    expect(refused.statusCode).toBe(403);

    const ticked = await setStatus(created.json().task.id, 'done', cook);
    expect(ticked.statusCode).toBe(200);
  });
});

describe('lines from a recipe', () => {
  async function recipe(name: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { name, type: 'prep', yield: { value: 1, unit: 'kg' } },
      cookies: as(admin),
    });
    return response.json().id as string;
  }

  it('remembers which recipe a line is for', async () => {
    const gel = await recipe('Vijgen Gel');
    const response = await add({
      description: 'Vijgen Gel',
      recipeId: gel,
      quantity: { value: 2, unit: 'kg' },
    });
    expect(response.json().task).toMatchObject({
      recipeId: gel,
      quantity: { value: 2000, unit: 'g' },
    });
  });

  it('links a line typed by hand once the same thing is added from the book', async () => {
    const gel = await recipe('Vijgen Gel');
    const typed = await add({ description: 'vijgen gel', quantity: { value: 500, unit: 'g' } });
    expect(typed.json().task.recipeId).toBeNull();

    const picked = await add({
      description: 'Vijgen Gel',
      recipeId: gel,
      quantity: { value: 1, unit: 'kg' },
    });
    expect(picked.json()).toMatchObject({
      merged: true,
      task: { recipeId: gel, quantity: { value: 1500, unit: 'g' } },
    });
  });

  it('refuses a recipe that does not exist', async () => {
    const response = await add({
      description: 'Ghost',
      recipeId: '00000000-0000-4000-8000-000000000000',
    });
    expect(response.statusCode).toBe(400);
  });

  it('keeps the line when its recipe is deleted, without the link', async () => {
    const gel = await recipe('Vijgen Gel');
    await add({ description: 'Vijgen Gel', recipeId: gel });
    await ctx.app.inject({ method: 'DELETE', url: `/api/recipes/${gel}`, cookies: as(admin) });
    const [line] = await list();
    expect(line).toMatchObject({ description: 'Vijgen Gel', recipeId: null });
  });
});

describe('being made', () => {
  it('lets a cook mark a job as theirs in progress, so nobody else starts it', async () => {
    const created = await add({ description: 'Chicken stock' });
    const id = created.json().task.id;
    const cook = await signInCook();
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', cookies: as(cook) });

    const started = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { status: 'in_progress', assignedUserId: me.json().user.id },
      cookies: as(cook),
    });
    expect(started.statusCode).toBe(200);

    // The rest of the kitchen sees who has it.
    const line = (await list()).find((task) => task.id === id);
    expect(line).toMatchObject({ status: 'in_progress', assignedUserName: 'Marco' });
  });

  it('does not let a cook say somebody else is making it', async () => {
    const created = await add({ description: 'Chicken stock' });
    const cook = await signInCook();
    const adminMe = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: as(admin),
    });

    const refused = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.json().task.id}`,
      payload: { status: 'in_progress', assignedUserId: adminMe.json().user.id },
      cookies: as(cook),
    });
    expect(refused.statusCode).toBe(403);
  });
});
