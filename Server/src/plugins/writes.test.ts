import { describe, expect, it } from 'vitest';
import { setUpKitchen, useTestContext } from '../test/harness.js';

const ctx = useTestContext();

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

function send(
  cookie: string,
  method: Method,
  url: string,
  payload?: object,
  headers: Record<string, string> = {},
) {
  return ctx.app.inject({ method, url, payload, cookies: { mise_session: cookie }, headers });
}

async function runningList(cookie: string) {
  return (await send(cookie, 'GET', '/api/running/tasks')).json() as {
    description: string;
    quantity: { value: number; unit: string } | null;
  }[];
}

describe('a change sent again after a dropped connection', () => {
  it('is made once, and the second send gets the first answer', async () => {
    const admin = await setUpKitchen(ctx.app);
    const line = { description: 'Brunoise shallots', quantity: { value: 2, unit: 'kg' } };
    const write = { 'x-mise-write': 'tablet-change-0001' };

    const first = await send(admin, 'POST', '/api/running/tasks', line, write);
    const again = await send(admin, 'POST', '/api/running/tasks', line, write);
    expect(first.statusCode).toBe(200);
    expect(again.statusCode).toBe(200);
    expect(again.headers['x-mise-replayed']).toBe('1');
    expect(again.json()).toEqual(first.json());

    // Adding the same line twice would add the amounts up; it didn't.
    const list = await runningList(admin);
    expect(list).toHaveLength(1);
    expect(list[0]!.quantity).toEqual({ value: 2000, unit: 'g' });
  });

  it('without an id, behaves as always', async () => {
    const admin = await setUpKitchen(ctx.app);
    const line = { description: 'Onions', quantity: { value: 2, unit: 'kg' } };
    await send(admin, 'POST', '/api/running/tasks', line);
    await send(admin, 'POST', '/api/running/tasks', line);
    expect((await runningList(admin))[0]!.quantity).toEqual({ value: 4000, unit: 'g' });
  });

  it("keeps one person's ids apart from another's", async () => {
    const admin = await setUpKitchen(ctx.app);
    await send(admin, 'POST', '/api/users', {
      displayName: 'Sous',
      role: 'sous_chef',
      email: 'sous@example.com',
      password: 'a-long-sous-password',
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'sous@example.com', password: 'a-long-sous-password' },
    });
    const sous = login.cookies.find((c) => c.name === 'mise_session')!.value;
    const write = { 'x-mise-write': 'same-id-on-two-tablets' };

    await send(admin, 'POST', '/api/running/tasks', { description: 'Stock' }, write);
    const theirs = await send(
      sous,
      'POST',
      '/api/running/tasks',
      { description: 'Beurre blanc' },
      write,
    );
    expect(theirs.headers['x-mise-replayed']).toBeUndefined();
    expect((await runningList(admin)).map((line) => line.description).sort()).toEqual([
      'Beurre blanc',
      'Stock',
    ]);
  });

  it('answers a refusal fresh each time, so a settled conflict can go through', async () => {
    const admin = await setUpKitchen(ctx.app);
    const stale = { 'x-mise-write': 'note-edit-000001', 'x-mise-base': '2020-01-01T00:00:00.000Z' };
    await send(admin, 'PUT', '/api/running/note', { text: 'First' });

    const refused = await send(admin, 'PUT', '/api/running/note', { text: 'Mine' }, stale);
    expect(refused.statusCode).toBe(409);
    // Keep mine: the same change again, without the version it started from.
    const kept = await send(
      admin,
      'PUT',
      '/api/running/note',
      { text: 'Mine' },
      {
        'x-mise-write': 'note-edit-000001',
      },
    );
    expect(kept.statusCode).toBe(200);
    expect(kept.json().text).toBe('Mine');
  });

  it('ignores an id that is not one', async () => {
    const admin = await setUpKitchen(ctx.app);
    const odd = { 'x-mise-write': 'no' };
    await send(
      admin,
      'POST',
      '/api/running/tasks',
      { description: 'Onions', quantity: { value: 1, unit: 'kg' } },
      odd,
    );
    const again = await send(
      admin,
      'POST',
      '/api/running/tasks',
      { description: 'Onions', quantity: { value: 1, unit: 'kg' } },
      odd,
    );
    expect(again.headers['x-mise-replayed']).toBeUndefined();
  });
});

describe('an edit made offline, when someone else changed the same thing', () => {
  async function aRecipe(admin: string) {
    const response = await send(admin, 'POST', '/api/recipes', {
      name: 'Pear tart',
      type: 'prep',
      yield: { value: 1, unit: 'kg' },
    });
    return response.json() as { id: string; updatedAt: string; name: string };
  }

  it('is refused with what is there now, so both can be shown', async () => {
    const admin = await setUpKitchen(ctx.app);
    const recipe = await aRecipe(admin);
    // Someone else renames it first.
    await send(admin, 'PATCH', `/api/recipes/${recipe.id}`, { name: 'Pear and almond tart' });

    const mine = await send(
      admin,
      'PATCH',
      `/api/recipes/${recipe.id}`,
      { name: 'Poached pear tart' },
      {
        'x-mise-base': recipe.updatedAt,
      },
    );
    expect(mine.statusCode).toBe(409);
    expect(mine.json().error.code).toBe('changed_meanwhile');
    expect(mine.json().error.details.current.name).toBe('Pear and almond tart');
  });

  it('goes through when nothing changed meanwhile', async () => {
    const admin = await setUpKitchen(ctx.app);
    const recipe = await aRecipe(admin);
    const mine = await send(
      admin,
      'PATCH',
      `/api/recipes/${recipe.id}`,
      { name: 'Poached pear tart' },
      {
        'x-mise-base': recipe.updatedAt,
      },
    );
    expect(mine.statusCode).toBe(200);
    expect(mine.json().name).toBe('Poached pear tart');
  });

  it('checks menus too', async () => {
    const admin = await setUpKitchen(ctx.app);
    const menu = (await send(admin, 'POST', '/api/menus', { name: 'Spring' })).json() as {
      id: string;
      updatedAt: string;
    };
    await send(admin, 'PATCH', `/api/menus/${menu.id}`, { name: 'Spring lunch' });
    const mine = await send(
      admin,
      'PATCH',
      `/api/menus/${menu.id}`,
      { name: 'Spring dinner' },
      {
        'x-mise-base': menu.updatedAt,
      },
    );
    expect(mine.statusCode).toBe(409);
    expect(mine.json().error.details.current.name).toBe('Spring lunch');
  });

  it('checks the handover note, including one written where there was none', async () => {
    const admin = await setUpKitchen(ctx.app);
    // Written offline when there was no note, but someone left one meanwhile.
    await send(admin, 'PUT', '/api/running/note', { text: 'Fish delivery at 10' });
    const mine = await send(
      admin,
      'PUT',
      '/api/running/note',
      { text: 'Low on cream' },
      { 'x-mise-base': 'none' },
    );
    expect(mine.statusCode).toBe(409);
    expect(mine.json().error.details.current.text).toBe('Fish delivery at 10');

    const note = (await send(admin, 'GET', '/api/running/note')).json() as { at: string };
    const fine = await send(
      admin,
      'PUT',
      '/api/running/note',
      { text: 'Low on cream' },
      { 'x-mise-base': note.at },
    );
    expect(fine.statusCode).toBe(200);
  });
});
