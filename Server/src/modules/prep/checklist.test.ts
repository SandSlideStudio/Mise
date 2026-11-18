import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;
let cook: string;
let hot: string;
let cold: string;

const as = (cookie: string) => ({ mise_session: cookie });

interface Item {
  id: string;
  stationId: string | null;
  name: string;
}

async function call(
  cookie: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return ctx.app.inject({
    method,
    url,
    payload: payload as Record<string, unknown> | undefined,
    cookies: as(cookie),
    headers,
  });
}

async function signInCook(): Promise<string> {
  const created = await call(admin, 'POST', '/api/users', {
    displayName: 'Marco',
    role: 'cook',
    pin: '4821',
  });
  const enrolled = await call(admin, 'POST', '/api/auth/devices', { name: 'Pass tablet' });
  const signedIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/pin-login',
    payload: { userId: created.json().id, pin: '4821' },
    cookies: { mise_device: cookieFrom(enrolled, 'mise_device')! },
  });
  return cookieFrom(signedIn, 'mise_session')!;
}

const setSwitch = (on: boolean) => call(admin, 'PATCH', '/api/kitchen', { prepChecklist: on });
const checklist = async (cookie = admin) =>
  (await call(cookie, 'GET', '/api/checklist')).json() as {
    enabled: boolean;
    items: Item[];
    updatedAt: string;
  };
const save = (items: unknown[], cookie = admin, headers: Record<string, string> = {}) =>
  call(cookie, 'PUT', '/api/checklist', { items }, headers);
const lines = async () =>
  (await call(admin, 'GET', '/api/running/tasks')).json() as {
    id: string;
    description: string;
    stationId: string | null;
    status: string;
    createdByName: string | null;
    fromChecklist: boolean;
  }[];

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
  cook = await signInCook();
  const stations = (await call(admin, 'GET', '/api/stations')).json() as { id: string }[];
  hot = stations[0]!.id;
  cold = stations[1]!.id;
});

describe('the kitchen switch', () => {
  it('is off by default and an administrator turns it on', async () => {
    const before = await call(admin, 'GET', '/api/kitchen');
    expect(before.json().prepChecklist).toBe(false);
    const after = await setSwitch(true);
    expect(after.json().prepChecklist).toBe(true);
    expect((await checklist()).enabled).toBe(true);
  });
});

describe('editing the checklist', () => {
  it('is for chefs: a cook can read it but not change it', async () => {
    const refused = await save([{ stationId: hot, name: 'Stock' }], cook);
    expect(refused.statusCode).toBe(403);
    expect((await call(cook, 'GET', '/api/checklist')).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/checklist' })).statusCode).toBe(401);
  });

  it('keeps names by station in the kitchen’s order, with no station last', async () => {
    const saved = await save([
      { stationId: null, name: 'Mop' },
      { stationId: cold, name: 'Slaw' },
      { stationId: hot, name: 'Stock' },
      { stationId: hot, name: 'Jus' },
      { name: 'Beets', stationId: cold },
    ]);
    expect(saved.statusCode).toBe(200);
    expect(saved.json().items.map((item: Item) => item.name)).toEqual([
      'Stock',
      'Jus',
      'Slaw',
      'Beets',
      'Mop',
    ]);
  });

  it('renames, reorders, moves and removes in one save, keeping ids', async () => {
    const first = (
      await save([
        { stationId: hot, name: 'Stock' },
        { stationId: hot, name: 'Jus' },
        { stationId: hot, name: 'Gone soon' },
      ])
    ).json().items as Item[];
    const [stock, jus] = first;

    const second = (
      await save([
        { id: jus!.id, stationId: hot, name: 'Veal jus' },
        { id: stock!.id, stationId: cold, name: 'Stock' },
      ])
    ).json().items as Item[];

    expect(second.map((item) => [item.id, item.name, item.stationId])).toEqual([
      [jus!.id, 'Veal jus', hot],
      [stock!.id, 'Stock', cold],
    ]);
  });

  it('refuses an item that is in the list twice, and a station that is gone', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const twice = await save([
      { id, stationId: hot, name: 'A' },
      { id, stationId: hot, name: 'B' },
    ]);
    expect(twice.statusCode).toBe(400);
    const gone = await save([{ stationId: '22222222-2222-4222-8222-222222222222', name: 'A' }]);
    expect(gone.statusCode).toBeGreaterThanOrEqual(400);
    expect(gone.statusCode).toBeLessThan(500);
  });

  it('refuses an edit that started from an older version, with what is there now', async () => {
    const start = await checklist();
    const first = await save([{ stationId: hot, name: 'Stock' }], admin, {
      'x-mise-base': start.updatedAt,
    });
    expect(first.statusCode).toBe(200);

    // A second chef still working from the version they opened.
    const stale = await save([{ stationId: hot, name: 'Other' }], admin, {
      'x-mise-base': start.updatedAt,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('changed_meanwhile');
    expect(stale.json().error.details.current.items.map((item: Item) => item.name)).toEqual([
      'Stock',
    ]);
    expect((await checklist()).items.map((item) => item.name)).toEqual(['Stock']);

    // From the current version it goes through, and without a version it always does.
    const now = first.json().updatedAt as string;
    expect(
      (await save([{ stationId: hot, name: 'Fond' }], admin, { 'x-mise-base': now })).statusCode,
    ).toBe(200);
    expect((await save([{ stationId: hot, name: 'Jus' }])).statusCode).toBe(200);
  });
});

describe('adding from the checklist', () => {
  let items: Item[];

  beforeEach(async () => {
    await setSwitch(true);
    items = (
      await save([
        { stationId: hot, name: 'Chicken stock' },
        { stationId: hot, name: 'Jus' },
        { stationId: cold, name: 'Slaw' },
        { stationId: null, name: 'Chicken stock' },
      ])
    ).json().items;
  });

  const ids = (...names: string[]) => items.filter((i) => names.includes(i.name)).map((i) => i.id);

  it('lets a cook tick items onto the list, with who added them and where from', async () => {
    const response = await call(cook, 'POST', '/api/checklist/add', { ids: ids('Jus', 'Slaw') });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ added: 2, alreadyThere: 0 });

    const list = await lines();
    expect(list.map((line) => line.description).sort()).toEqual(['Jus', 'Slaw']);
    for (const line of list) {
      expect(line).toMatchObject({ createdByName: 'Marco', fromChecklist: true, status: 'open' });
    }
    // Where the chef put them.
    expect(list.find((line) => line.description === 'Slaw')!.stationId).toBe(cold);
  });

  it('skips what is already open or in progress on the same station, however it is written', async () => {
    await call(admin, 'POST', '/api/running/tasks', {
      description: '  chicken STOCK ',
      stationId: hot,
    });
    const started = await call(admin, 'POST', '/api/running/tasks', {
      description: 'Jus',
      stationId: hot,
    });
    await call(admin, 'PATCH', `/api/tasks/${started.json().task.id}`, { status: 'in_progress' });

    const response = await call(cook, 'POST', '/api/checklist/add', {
      ids: ids('Chicken stock', 'Jus', 'Slaw'),
    });
    // Two on the hot station were there; the same name with no station is another line.
    expect(response.json()).toEqual({ added: 2, alreadyThere: 2 });
    expect(await lines()).toHaveLength(4);
  });

  it('adds a line again once the one before it is ticked off', async () => {
    await call(cook, 'POST', '/api/checklist/add', { ids: ids('Jus') });
    const [line] = await lines();
    await call(cook, 'PATCH', `/api/tasks/${line!.id}`, { status: 'done' });

    const again = await call(cook, 'POST', '/api/checklist/add', { ids: ids('Jus') });
    expect(again.json()).toEqual({ added: 1, alreadyThere: 0 });
  });

  it('counts the same item ticked twice in one go as already there', async () => {
    const [jus] = ids('Jus');
    const response = await call(cook, 'POST', '/api/checklist/add', { ids: [jus, jus] });
    expect(response.json()).toEqual({ added: 1, alreadyThere: 0 });
    expect(await lines()).toHaveLength(1);
  });

  it('is refused when the kitchen has switched the checklist off', async () => {
    await setSwitch(false);
    const response = await call(cook, 'POST', '/api/checklist/add', { ids: ids('Jus') });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('checklist_off');
    expect(await lines()).toHaveLength(0);
  });

  it('still keeps a cook from typing lines by hand', async () => {
    const response = await call(cook, 'POST', '/api/running/tasks', { description: 'Jus' });
    expect(response.statusCode).toBe(403);
  });

  it('is made once when the same change is sent again with the same id', async () => {
    const write = { 'x-mise-write': 'checklist-add-0001' };
    const body = { ids: ids('Jus', 'Slaw') };
    const first = await call(cook, 'POST', '/api/checklist/add', body, write);
    const again = await call(cook, 'POST', '/api/checklist/add', body, write);
    expect(first.json()).toEqual({ added: 2, alreadyThere: 0 });
    // The first answer, not "2 already there".
    expect(again.json()).toEqual({ added: 2, alreadyThere: 0 });
    expect(again.headers['x-mise-replayed']).toBe('1');
    expect(await lines()).toHaveLength(2);
  });

  it('ignores an item the chef removed since it was ticked', async () => {
    const [jus] = ids('Jus');
    await save(items.filter((item) => item.id !== jus));
    const response = await call(cook, 'POST', '/api/checklist/add', { ids: [jus] });
    expect(response.json()).toEqual({ added: 0, alreadyThere: 0 });
  });
});

describe('who added a line', () => {
  it('records the signed-in user for a line typed by a chef, and not as from the checklist', async () => {
    await call(admin, 'POST', '/api/running/tasks', { description: 'Pickled onions' });
    expect((await lines())[0]).toMatchObject({
      createdByName: 'Escoffier',
      fromChecklist: false,
    });
  });

  it('keeps the first person when a later line is merged into it', async () => {
    await call(admin, 'POST', '/api/running/tasks', {
      description: 'Onions',
      quantity: { value: 1, unit: 'kg' },
    });
    const merged = await call(admin, 'POST', '/api/running/tasks', {
      description: 'onions',
      quantity: { value: 500, unit: 'g' },
    });
    expect(merged.json().merged).toBe(true);
    const list = await lines();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ createdByName: 'Escoffier', fromChecklist: false });
  });

  it('says nothing about a person who has since been removed', async () => {
    await setSwitch(true);
    const [item] = (await save([{ stationId: hot, name: 'Jus' }])).json().items as Item[];
    await call(cook, 'POST', '/api/checklist/add', { ids: [item!.id] });
    const marco = (await call(admin, 'GET', '/api/users'))
      .json()
      .find((u: { displayName: string }) => u.displayName === 'Marco');
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/users/${marco.id}`,
      cookies: as(admin),
    });
    const [line] = await lines();
    expect(line).toMatchObject({ createdByName: null, fromChecklist: true });
  });
});

describe('a checklist line linked to a recipe', () => {
  async function recipe(name: string) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: { name, type: 'prep', yield: { value: 1, unit: 'kg' } },
      cookies: as(admin),
    });
    return response.json().id as string;
  }

  type Linked = Item & { recipeId: string | null };
  const read = async () => (await checklist()).items as Linked[];

  beforeEach(async () => {
    await setSwitch(true);
  });

  it('keeps the link, and a line without one has none', async () => {
    const gel = await recipe('Vijgen Gel');
    const saved = await save([
      { stationId: hot, name: 'Fig gel', recipeId: gel },
      { stationId: hot, name: 'Jus' },
    ]);
    expect(saved.json().items.map((i: Linked) => i.recipeId)).toEqual([gel, null]);
  });

  it('puts the recipe on the prep line it adds, and not on others', async () => {
    const gel = await recipe('Vijgen Gel');
    await save([
      { stationId: hot, name: 'Fig gel', recipeId: gel },
      { stationId: hot, name: 'Jus' },
    ]);
    const items = await read();
    const response = await call(cook, 'POST', '/api/checklist/add', {
      ids: items.map((i) => i.id),
    });
    expect(response.json()).toEqual({ added: 2, alreadyThere: 0 });
    const list = (await call(admin, 'GET', '/api/running/tasks')).json() as {
      description: string;
      recipeId: string | null;
    }[];
    expect(list.find((l) => l.description === 'Fig gel')!.recipeId).toBe(gel);
    expect(list.find((l) => l.description === 'Jus')!.recipeId).toBeNull();
  });

  it('still skips a line that is already open on the station', async () => {
    const gel = await recipe('Vijgen Gel');
    await save([{ stationId: hot, name: 'Fig gel', recipeId: gel }]);
    const [item] = await read();
    await call(cook, 'POST', '/api/checklist/add', { ids: [item!.id] });
    const again = await call(cook, 'POST', '/api/checklist/add', { ids: [item!.id] });
    expect(again.json()).toEqual({ added: 0, alreadyThere: 1 });
  });

  it('leaves the line without a link when the recipe is deleted', async () => {
    const gel = await recipe('Vijgen Gel');
    await save([{ stationId: hot, name: 'Fig gel', recipeId: gel }]);
    await call(admin, 'DELETE', `/api/recipes/${gel}`);
    expect((await read()).map((i) => [i.name, i.recipeId])).toEqual([['Fig gel', null]]);
  });

  it('refuses a recipe that does not exist', async () => {
    const response = await save([
      { stationId: hot, name: 'Fig gel', recipeId: '33333333-3333-4333-8333-333333333333' },
    ]);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });
});

describe('live updates', () => {
  it('tell every screen when the checklist changes or is added from', async () => {
    const heard: string[] = [];
    ctx.app.live.subscribe((topic) => heard.push(topic));
    await setSwitch(true);
    const [item] = (await save([{ stationId: hot, name: 'Jus' }])).json().items as Item[];
    heard.length = 0;
    await call(cook, 'POST', '/api/checklist/add', { ids: [item!.id] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toContain('prep');
  });
});
