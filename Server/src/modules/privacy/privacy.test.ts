import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  kitchens,
  prepTasks,
  remoteDevices,
  sessions,
  users,
  writeReceipts,
} from '../../db/schema.js';
import { ADMIN, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

afterEach(() => {
  vi.useRealTimers();
});

function as(cookie: string) {
  return { mise_session: cookie };
}

const DAY = 86_400_000;

async function addStaff(payload: Record<string, unknown>): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/users',
    payload,
    cookies: as(admin),
  });
  expect(response.statusCode).toBe(200);
  return response.json().id;
}

/** Marco, a cook, signed in by PIN on an enrolled tablet. */
async function signInCook(): Promise<{ id: string; cookie: string }> {
  const id = await addStaff({ displayName: 'Marco', role: 'cook', pin: '4821' });
  const enrolled = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/devices',
    payload: { name: 'Pass tablet' },
    cookies: as(admin),
  });
  const signedIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    payload: { userId: id, pin: '4821' },
    headers: { 'user-agent': 'Mozilla/5.0 (iPad) Safari/605.1.15' },
    cookies: { mise_device: cookieFrom(enrolled, 'mise_device')! },
  });
  return { id, cookie: cookieFrom(signedIn, 'mise_session')! };
}

async function addLine(description: string, cookie = admin): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/running/tasks',
    payload: { description },
    cookies: as(cookie),
  });
  return response.json().task.id;
}

async function patchLine(id: string, payload: Record<string, unknown>, cookie: string) {
  const response = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/tasks/${id}`,
    payload,
    cookies: as(cookie),
  });
  expect(response.statusCode).toBe(200);
}

async function dataOf(id: string, cookie = admin) {
  return ctx.app.inject({ method: 'GET', url: `/api/users/${id}/data`, cookies: as(cookie) });
}

describe('downloading one person’s data', () => {
  it('holds their account, their lines, their note and where they are signed in', async () => {
    const cook = await signInCook();
    const stock = await addLine('Chicken stock');
    const leeks = await addLine('Leeks, washed');
    await addLine('Not theirs');
    await patchLine(stock, { status: 'in_progress', assignedUserId: cook.id }, cook.cookie);
    await patchLine(leeks, { status: 'done' }, cook.cookie);
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/running/note',
      payload: { text: 'Fond staat op.' },
      cookies: as(cook.cookie),
    });

    const response = await dataOf(cook.id);
    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.kitchen).toBe(ADMIN.kitchenName);
    expect(data.person).toMatchObject({
      id: cook.id,
      displayName: 'Marco',
      role: 'cook',
      hasPin: true,
      hasPassword: false,
    });
    expect(data.prepLines).toEqual([
      expect.objectContaining({ id: stock, added: false, onIt: true, ticked: false }),
      expect.objectContaining({ id: leeks, added: false, onIt: false, ticked: true }),
    ]);
    expect(data.prepLines[1].completedAt).not.toBeNull();
    expect(data.handoverNote).toMatchObject({ text: 'Fond staat op.' });
    expect(data.sessions).toEqual([
      expect.objectContaining({ tablet: 'Pass tablet', browser: expect.stringContaining('iPad') }),
    ]);
  });

  it('never gives away anything made from a PIN or password', async () => {
    const cook = await signInCook();
    const [row] = await ctx.db.select().from(users).where(eq(users.id, cook.id));
    const body = (await dataOf(cook.id)).body;
    expect(body).not.toContain(row!.pinHash!);
    expect(body).not.toMatch(/hash|token/i);
  });

  it('lists the outside devices they approved', async () => {
    const [me] = await ctx.db.select().from(users).limit(1);
    await ctx.app.access.approveNew({
      name: 'Sam’s phone',
      userAgent: null,
      address: '203.0.113.9',
      userId: me!.id,
    });
    const data = (await dataOf(me!.id)).json();
    expect(data.approvedDevices).toEqual([expect.objectContaining({ name: 'Sam’s phone' })]);
  });

  it('needs a password sign-in and the rank to manage them', async () => {
    const cook = await signInCook();
    expect((await dataOf(cook.id, cook.cookie)).statusCode).toBe(403);

    await addStaff({
      displayName: 'Hélène',
      role: 'head_chef',
      email: 'helene@example.com',
      password: 'a-long-head-chef-password',
    });
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'helene@example.com', password: 'a-long-head-chef-password' },
    });
    const headChef = cookieFrom(signedIn, 'mise_session')!;
    const [me] = await ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    expect((await dataOf(me!.id, headChef)).statusCode).toBe(403);
    expect((await dataOf(cook.id, headChef)).statusCode).toBe(200);
  });

  it('lets a sous chef download their own, and nobody else’s', async () => {
    const cook = await signInCook();
    const sous = await addStaff({
      displayName: 'Ana',
      role: 'sous_chef',
      email: 'ana@example.com',
      password: 'a-long-sous-chef-password',
    });
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'a-long-sous-chef-password' },
    });
    const cookie = cookieFrom(signedIn, 'mise_session')!;
    const own = await dataOf(sous, cookie);
    expect(own.statusCode).toBe(200);
    expect(own.json().person.id).toBe(sous);
    expect((await dataOf(cook.id, cookie)).statusCode).toBe(403);
  });
});

describe('removing someone for good', () => {
  it('clears their name from the handover note, their sessions and kept answers', async () => {
    const cook = await signInCook();
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/running/note',
      payload: { text: 'Fond staat op.' },
      headers: { 'x-mise-write': 'note-from-marco-1' },
      cookies: as(cook.cookie),
    });
    const [me] = await ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    await ctx.app.access.approveNew({
      name: 'Sam’s phone',
      userAgent: null,
      address: '203.0.113.9',
      userId: me!.id,
    });

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${cook.id}`,
      cookies: as(admin),
    });
    expect(removed.statusCode).toBe(204);

    const [kitchen] = await ctx.db.select().from(kitchens);
    // The kitchen's note stays; the name under it goes.
    expect(kitchen).toMatchObject({ handoverNote: 'Fond staat op.', handoverNoteBy: null });
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, cook.id))).toEqual([]);
    const answers = await ctx.db.select().from(writeReceipts);
    expect(answers.filter((answer) => answer.key.startsWith(cook.id))).toEqual([]);
    // Someone else's approval is untouched.
    expect(await ctx.db.select().from(remoteDevices)).toHaveLength(1);
  });

  it('keeps a device they approved, without saying who approved it', async () => {
    const id = await addStaff({
      displayName: 'Hélène',
      role: 'head_chef',
      email: 'helene@example.com',
      password: 'a-long-head-chef-password',
    });
    await ctx.app.access.approveNew({
      name: 'Sam’s phone',
      userAgent: null,
      address: '203.0.113.9',
      userId: id,
    });
    await ctx.app.inject({ method: 'DELETE', url: `/api/users/${id}`, cookies: as(admin) });
    const [device] = await ctx.db.select().from(remoteDevices);
    expect(device).toMatchObject({ name: 'Sam’s phone', status: 'approved', approvedBy: null });
  });

  it('leaves someone else’s note signed', async () => {
    const cook = await signInCook();
    await ctx.app.inject({
      method: 'PUT',
      url: '/api/running/note',
      payload: { text: 'Vis komt later.' },
      cookies: as(admin),
    });
    await ctx.app.inject({ method: 'DELETE', url: `/api/users/${cook.id}`, cookies: as(admin) });
    const [kitchen] = await ctx.db.select().from(kitchens);
    expect(kitchen!.handoverNoteBy).toBe(ADMIN.displayName);
  });

  it('still refuses to remove yourself or the last administrator', async () => {
    const [me] = await ctx.db.select().from(users).where(eq(users.email, ADMIN.email));
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${me!.id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(409);
    expect(await ctx.db.select().from(users)).toHaveLength(1);
  });
});

describe('how long things are kept', () => {
  async function tick(description: string) {
    const id = await addLine(description);
    await patchLine(id, { status: 'done' }, admin);
    return id;
  }

  async function remaining() {
    return (await ctx.db.select({ id: prepTasks.id }).from(prepTasks)).map((row) => row.id).sort();
  }

  it('keeps ticked lines a year by default, then deletes them', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const old = await tick('Chicken stock');
    vi.setSystemTime(new Date('2026-12-01T12:00:00Z'));
    const recent = await tick('Leeks, washed');

    vi.setSystemTime(new Date('2027-01-09T12:00:00Z'));
    await ctx.app.privacy.forgetOld();
    expect(await remaining()).toEqual([old, recent].sort());

    vi.setSystemTime(new Date('2027-01-11T12:00:00Z'));
    await ctx.app.privacy.forgetOld();
    expect(await remaining()).toEqual([recent]);
  });

  it('follows the number of days the kitchen chooses, or keeps them for good', async () => {
    const changed = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedKeepDays: 30 },
      cookies: as(admin),
    });
    expect(changed.json()).toMatchObject({ tickedRetention: 'keep', tickedKeepDays: 30 });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const id = await tick('Chicken stock');
    const open = await addLine('Still to do');

    vi.setSystemTime(new Date('2026-03-31T13:00:00Z'));
    await ctx.app.privacy.forgetOld();
    // Only ticked lines go; a line nobody has ticked is still work to do.
    expect(await remaining()).toEqual([open]);

    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedKeepDays: null },
      cookies: as(admin),
    });
    const kept = await tick('Kept for good');
    vi.setSystemTime(new Date('2036-03-31T13:00:00Z'));
    await ctx.app.privacy.forgetOld();
    expect(await remaining()).toContain(kept);
    expect(await remaining()).not.toContain(id);
  });

  it('refuses a number of days that makes no sense', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedKeepDays: 0 },
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('deletes gone lines once an hour when the kitchen deletes them, without anyone looking', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedRetention: 'delete' },
      cookies: as(admin),
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    await tick('Chicken stock');
    vi.setSystemTime(new Date('2026-03-01T15:00:00Z'));
    await ctx.app.privacy.forgetOld();
    expect(await remaining()).toEqual([]);
  });

  it('forgets an outside device, address and browser, after 90 days unused', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
    const { token } = await ctx.app.access.approveNew({
      name: 'Sam’s phone',
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605.1.15',
      address: '203.0.113.9',
      userId: null,
    });
    await ctx.app.access.approveNew({
      name: 'Left in a drawer',
      userAgent: 'Mozilla/5.0 (Android) Chrome/130',
      address: '203.0.113.10',
      userId: null,
    });

    vi.setSystemTime(new Date('2026-05-29T12:00:00Z'));
    await ctx.app.privacy.forgetOld();
    expect(await ctx.db.select().from(remoteDevices)).toHaveLength(2);
    // Used now: it starts its 90 days again.
    expect(await ctx.app.access.approved(token)).not.toBeNull();

    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
    await ctx.app.privacy.forgetOld();
    const left = await ctx.db.select().from(remoteDevices);
    expect(left).toEqual([expect.objectContaining({ name: 'Sam’s phone' })]);
    // Still let in: forgetting the idle one doesn't touch an approval in use.
    expect(await ctx.app.access.approved(token)).toMatchObject({ name: 'Sam’s phone' });
  });

  it('clears a browser name from a session nobody has used for 90 days', async () => {
    const cook = await signInCook();
    await ctx.db
      .update(sessions)
      .set({ lastSeenAt: new Date(Date.now() - 91 * DAY), expiresAt: new Date(Date.now() + DAY) })
      .where(eq(sessions.userId, cook.id));
    await ctx.app.privacy.forgetOld();
    const [session] = await ctx.db.select().from(sessions).where(eq(sessions.userId, cook.id));
    expect(session!.userAgent).toBeNull();
  });
});

describe('the privacy page', () => {
  it('quotes this kitchen’s own limits', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/privacy',
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      tickedRetention: 'keep',
      tickedKeepDays: 365,
      outsideDeviceIdleDays: 90,
      updateCheck: true,
      domainHttps: false,
      backups: { keepLocal: 7, keepRemote: 30, webdav: false, onedrive: false },
    });
  });

  it('is for managers', async () => {
    const cook = await signInCook();
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/privacy',
      cookies: as(cook.cookie),
    });
    expect(response.statusCode).toBe(403);
  });
});
