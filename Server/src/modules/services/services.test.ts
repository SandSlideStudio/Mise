import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

function as(cookie: string) {
  return { mise_session: cookie };
}

async function createService(
  app: FastifyInstance,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/services',
    payload: { date: '2026-09-11', period: 'dinner', covers: 40, ...overrides },
    cookies: as(cookie),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not create service: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

async function addTask(
  app: FastifyInstance,
  cookie: string,
  serviceId: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/services/${serviceId}/tasks`,
    payload,
    cookies: as(cookie),
  });
  if (response.statusCode !== 200) {
    throw new Error(`Could not add task: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

/** Sign in a cook on an enrolled tablet and hand back their session cookie. */
async function signInCook(app: FastifyInstance, adminCookie: string): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/api/users',
    payload: { displayName: 'Marco', role: 'cook', pin: '4821' },
    cookies: as(adminCookie),
  });
  const cookId = created.json().id;

  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/auth/devices',
    payload: { name: 'Pass tablet' },
    cookies: as(adminCookie),
  });
  const device = cookieFrom(enrolled, 'mise_device')!;

  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    payload: { userId: cookId, pin: '4821' },
    cookies: { mise_device: device },
  });
  return cookieFrom(signedIn, 'mise_session')!;
}

describe('services', () => {
  it('creates a service for a date and a period', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/services',
      payload: { date: '2026-09-11', period: 'dinner', covers: 40 },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ date: '2026-09-11', period: 'dinner', covers: 40 });
  });

  it('refuses a second service for the same date and period', async () => {
    await createService(ctx.app, admin);
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/services',
      payload: { date: '2026-09-11', period: 'dinner' },
      cookies: as(admin),
    });
    expect(again.statusCode).toBe(409);
  });

  it('allows lunch and dinner on the same day', async () => {
    await createService(ctx.app, admin, { period: 'lunch' });
    const dinner = await ctx.app.inject({
      method: 'POST',
      url: '/api/services',
      payload: { date: '2026-09-11', period: 'dinner' },
      cookies: as(admin),
    });
    expect(dinner.statusCode).toBe(200);
  });

  it('lists services within a date range', async () => {
    await createService(ctx.app, admin, { date: '2026-09-10' });
    await createService(ctx.app, admin, { date: '2026-09-11' });
    await createService(ctx.app, admin, { date: '2026-09-20' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/services?from=2026-09-10&to=2026-09-12',
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
  });

  it('counts the tasks and how many are done', async () => {
    const service = await createService(ctx.app, admin);
    const first = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    await addTask(ctx.app, admin, service.id, { description: 'Brunoise shallots' });

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${first.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/services',
      cookies: as(admin),
    });
    expect(response.json()[0]).toMatchObject({ taskCount: 2, doneCount: 1 });
  });

  it('takes its prep list with it when deleted', async () => {
    const service = await createService(ctx.app, admin);
    await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/services/${service.id}`,
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${service.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('the prep list', () => {
  it('adds a task by hand, which is all a whiteboard ever did', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, {
      description: 'Brunoise shallots',
    });
    expect(task).toMatchObject({
      description: 'Brunoise shallots',
      status: 'open',
      source: 'manual',
    });
  });

  it('stores a quantity in base units, so hand-added and generated tasks match', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, {
      description: 'Peel onions',
      quantity: { value: 2, unit: 'kg' },
    });
    // 2 kg is recorded as 2000 g, the same shape the explosion will produce.
    expect(task.quantity).toEqual({ value: 2000, unit: 'g' });
  });

  it('groups the list by station, in the order the kitchen is laid out', async () => {
    const service = await createService(ctx.app, admin);
    const stations = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(admin),
    });
    const [larder, sauce] = stations.json();

    // Added in the wrong order on purpose.
    await addTask(ctx.app, admin, service.id, { description: 'Reduce jus', stationId: sauce.id });
    await addTask(ctx.app, admin, service.id, { description: 'Pick herbs', stationId: larder.id });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${service.id}/tasks`,
      cookies: as(admin),
    });
    expect(response.json().map((t: { description: string }) => t.description)).toEqual([
      'Pick herbs',
      'Reduce jus',
    ]);
  });

  it('records who finished a task and when', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().completedByName).toBe('Escoffier');
    expect(response.json().completedAt).not.toBeNull();
  });

  it('clears the record when a task is reopened', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });
    const reopened = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'open' },
      cookies: as(admin),
    });

    // Nothing should still claim somebody finished a task that is open again.
    expect(reopened.json().completedByName).toBeNull();
    expect(reopened.json().completedAt).toBeNull();
  });

  it('filters down to one station, for a cook on that section', async () => {
    const service = await createService(ctx.app, admin);
    const stations = await ctx.app.inject({
      method: 'GET',
      url: '/api/stations',
      cookies: as(admin),
    });
    const [larder, sauce] = stations.json();
    await addTask(ctx.app, admin, service.id, { description: 'Pick herbs', stationId: larder.id });
    await addTask(ctx.app, admin, service.id, { description: 'Reduce jus', stationId: sauce.id });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${service.id}/tasks?stationId=${larder.id}`,
      cookies: as(admin),
    });
    expect(response.json()).toHaveLength(1);
    expect(response.json()[0].description).toBe('Pick herbs');
  });
});

describe('what a cook is allowed to do', () => {
  it('lets a cook see the list, because that is the entire point', async () => {
    const service = await createService(ctx.app, admin);
    await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${service.id}/tasks`,
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(1);
  });

  it('lets a cook tick a task off', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'done' },
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().completedByName).toBe('Marco');
  });

  it('stops a cook rewording a task', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { description: 'Have a break' },
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a cook handing a task to somebody else', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);
    const staff = await ctx.app.inject({ method: 'GET', url: '/api/users', cookies: as(admin) });
    const someoneElse = staff.json().find((u: { role: string }) => u.role === 'admin');

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { assignedUserId: someoneElse.id },
      cookies: as(cook),
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a cook adding or deleting tasks', async () => {
    const service = await createService(ctx.app, admin);
    const task = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    const added = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${service.id}/tasks`,
      payload: { description: 'Nothing to do' },
      cookies: as(cook),
    });
    expect(added.statusCode).toBe(403);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${task.id}`,
      cookies: as(cook),
    });
    expect(deleted.statusCode).toBe(403);
  });
});

/** The bottom half of yesterday's whiteboard, moved onto today's. */
describe('carrying work over', () => {
  it('moves unfinished work onto the next service', async () => {
    const yesterday = await createService(ctx.app, admin, { date: '2026-09-10' });
    const today = await createService(ctx.app, admin, { date: '2026-09-11' });

    const done = await addTask(ctx.app, admin, yesterday.id, { description: 'Pick tarragon' });
    await addTask(ctx.app, admin, yesterday.id, { description: 'Brunoise shallots' });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${done.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${today.id}/carry-over`,
      payload: { fromServiceId: yesterday.id },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().created).toBe(1);
    // The finished job stays finished and stays behind.
    expect(response.json().tasks.map((t: { description: string }) => t.description)).toEqual([
      'Brunoise shallots',
    ]);
  });

  it('arrives as open work, whoever it was assigned to', async () => {
    const yesterday = await createService(ctx.app, admin, { date: '2026-09-10' });
    const today = await createService(ctx.app, admin, { date: '2026-09-11' });
    const task = await addTask(ctx.app, admin, yesterday.id, { description: 'Brunoise shallots' });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      payload: { status: 'in_progress' },
      cookies: as(admin),
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${today.id}/carry-over`,
      payload: { fromServiceId: yesterday.id },
      cookies: as(admin),
    });
    expect(response.json().tasks[0]).toMatchObject({ status: 'open', source: 'manual' });
  });

  it('does not double the list when carried over twice', async () => {
    const yesterday = await createService(ctx.app, admin, { date: '2026-09-10' });
    const today = await createService(ctx.app, admin, { date: '2026-09-11' });
    await addTask(ctx.app, admin, yesterday.id, { description: 'Brunoise shallots' });

    const payload = { fromServiceId: yesterday.id };
    await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${today.id}/carry-over`,
      payload,
      cookies: as(admin),
    });
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${today.id}/carry-over`,
      payload,
      cookies: as(admin),
    });

    expect(again.json().created).toBe(0);
    expect(again.json().skipped).toBe(1);
    expect(again.json().tasks).toHaveLength(1);
  });

  it('refuses to carry a service over onto itself', async () => {
    const service = await createService(ctx.app, admin);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${service.id}/carry-over`,
      payload: { fromServiceId: service.id },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });
});

/**
 * Two cooks on two tablets, one list. Neither should be able to erase what the
 * other actually did.
 */
describe('when two people reach for the same task', () => {
  it('keeps the first person’s name when a second marks it done again', async () => {
    const service = await createService(ctx.app, admin);
    const prep = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    // Marco gets there first.
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(cook),
    });

    // The chef's tablet was showing it as open and they tap it too.
    const second = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    expect(second.statusCode).toBe(200);
    // The person who actually did it keeps the credit.
    expect(second.json().completedByName).toBe('Marco');
  });

  it('does not move the time it was finished', async () => {
    const service = await createService(ctx.app, admin);
    const prep = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });
    const again = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    expect(again.json().completedAt).toBe(first.json().completedAt);
  });

  it('still lets somebody deliberately reopen it', async () => {
    const service = await createService(ctx.app, admin);
    const prep = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });
    const cook = await signInCook(ctx.app, admin);

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(cook),
    });
    const reopened = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'open' },
      cookies: as(admin),
    });

    expect(reopened.json().status).toBe('open');
    expect(reopened.json().completedByName).toBeNull();
  });

  it('refuses a tick on a task that has been deleted, rather than recreating it', async () => {
    const service = await createService(ctx.app, admin);
    const prep = await addTask(ctx.app, admin, service.id, { description: 'Pick tarragon' });

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${prep.id}`,
      cookies: as(admin),
    });

    // The tablet still had it on screen. A clear refusal lets the client drop
    // it from the retry queue instead of trying forever.
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${prep.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(404);
  });
});
