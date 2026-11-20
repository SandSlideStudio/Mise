import { beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';
import { MAX_WAITING_LABEL_CHECKS } from './labelChecks.js';

/**
 * Checking a label at delivery: a chef's difference is applied and reaches
 * every dish, a cook's waits for a chef, and "no change" is kept too.
 */

const ctx = useTestContext();
let chef: Record<string, string>;

beforeEach(async () => {
  chef = { mise_session: await setUpKitchen(ctx.app) };
});

async function call(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: object,
  cookies = chef,
) {
  return ctx.app.inject({ method, url, payload, cookies });
}

async function ok(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, cookies = chef) {
  const response = await call(method, url, payload, cookies);
  if (response.statusCode !== 200) {
    throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

async function signInCook() {
  await ok('POST', '/api/users', {
    displayName: 'Ana',
    role: 'cook',
    email: 'ana@example.com',
    password: 'a-long-enough-password',
  });
  const signIn = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'ana@example.com', password: 'a-long-enough-password' },
  });
  return { mise_session: cookieFrom(signIn, 'mise_session')! };
}

/** Pesto in a pasta on the lunch menu; a salad without it. */
async function kitchen() {
  const pesto = await ok('POST', '/api/ingredients', {
    name: 'Pesto',
    baseUnit: 'g',
    allergens: ['milk'],
    allergenDetails: { gluten: [], nuts: ['pine nut'] },
  });
  const leaves = await ok('POST', '/api/ingredients', { name: 'Leaves', baseUnit: 'g' });
  const dish = (name: string, id: string) =>
    ok('POST', '/api/recipes', {
      name,
      type: 'dish',
      yield: { value: 1, unit: 'each' },
      portions: 1,
      components: [
        {
          sortOrder: 0,
          quantity: { value: 40, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: id },
        },
      ],
    });
  const pasta = await dish('Pasta pesto', pesto.id);
  const salad = await dish('Salad', leaves.id);
  await ok('POST', '/api/menus', { name: 'Lunch', dishes: [pasta.id, salad.id] });
  return { pesto, leaves, pasta, salad };
}

const history = (dishId: string) => ok('GET', `/api/recipes/${dishId}/allergen-history`);

describe('a chef checking a label', () => {
  it('applies a difference, and every dish it reaches records the label check as the cause', async () => {
    const { pesto, pasta, salad } = await kitchen();
    const check = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['nuts', 'milk'],
      mayContain: ['peanuts', 'milk'],
      note: 'Supplier B, 4471',
    });
    expect(check).toMatchObject({
      ingredientName: 'Pesto',
      checkedBy: 'Escoffier',
      changed: true,
      status: 'applied',
      note: 'Supplier B, 4471',
      before: { allergens: ['milk'], mayContain: [] },
      // In declaration order, and no trace of what it contains anyway.
      after: { allergens: ['milk', 'nuts'], mayContain: ['peanuts'] },
    });

    const now = await ok('GET', `/api/ingredients/${pesto.id}`);
    expect(now.allergens).toEqual(['milk', 'nuts']);
    expect(now.mayContain).toEqual(['peanuts']);
    expect(now.labelCheck).toMatchObject({ by: 'Escoffier', pending: false });
    // The editor's version moved on, so an edit started before is asked about.
    expect(now.updatedAt).not.toBe(pesto.updatedAt);

    const [latest] = await history(pasta.id);
    expect(latest).toMatchObject({
      contains: ['milk', 'nuts'],
      mayContain: ['peanuts'],
      cause: 'label check: Pesto',
      changedBy: 'Escoffier',
    });
    expect(await history(salad.id)).toHaveLength(1);
  });

  it('keeps a "no change" as a check, and changes nothing else', async () => {
    const { pesto, pasta } = await kitchen();
    const check = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk'],
      mayContain: [],
    });
    expect(check).toMatchObject({ changed: false, status: 'applied', note: null });
    const now = await ok('GET', `/api/ingredients/${pesto.id}`);
    expect(now.updatedAt).toBe(pesto.updatedAt);
    expect(now.labelCheck).toMatchObject({ at: check.checkedAt, by: 'Escoffier' });
    expect(await history(pasta.id)).toHaveLength(1);

    const list = await ok('GET', '/api/ingredients');
    const leaves = list.find((item: { name: string }) => item.name === 'Leaves');
    expect(leaves.labelCheck).toBeNull();
  });

  it('drops the named nuts with the nuts, as the editor does', async () => {
    const { pesto } = await kitchen();
    await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk', 'nuts'],
      mayContain: [],
    });
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergenDetails.nuts).toEqual([
      'pine nut',
    ]);
    await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk'],
      mayContain: [],
    });
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergenDetails.nuts).toEqual([]);
  });

  it('keeps the time a check made offline was made, but never one in the future', async () => {
    const { pesto } = await kitchen();
    const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const offline = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk'],
      mayContain: [],
      checkedAt: earlier,
    });
    expect(offline.checkedAt).toBe(earlier);
    const ahead = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk'],
      mayContain: [],
      checkedAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(Date.parse(ahead.checkedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('answers 404 for an ingredient that is not there', async () => {
    const response = await call(
      'POST',
      '/api/ingredients/00000000-0000-4000-8000-000000000000/label-checks',
      { allergens: [], mayContain: [] },
    );
    expect(response.statusCode).toBe(404);
  });
});

describe('a cook checking a label', () => {
  it('may record a "no change", which applies straight away', async () => {
    const { pesto } = await kitchen();
    const cook = await signInCook();
    const check = await ok(
      'POST',
      `/api/ingredients/${pesto.id}/label-checks`,
      { allergens: ['milk'], mayContain: [] },
      cook,
    );
    expect(check).toMatchObject({ changed: false, status: 'applied', checkedBy: 'Ana' });
  });

  it('leaves a difference waiting for a chef, who approves it', async () => {
    const { pesto, pasta } = await kitchen();
    const cook = await signInCook();
    const check = await ok(
      'POST',
      `/api/ingredients/${pesto.id}/label-checks`,
      { allergens: ['milk', 'nuts'], mayContain: [] },
      cook,
    );
    expect(check).toMatchObject({ changed: true, status: 'pending', checkedBy: 'Ana' });
    // Nothing changed yet.
    const waiting = await ok('GET', `/api/ingredients/${pesto.id}`);
    expect(waiting.allergens).toEqual(['milk']);
    expect(waiting.labelCheck).toMatchObject({ by: 'Ana', pending: true });
    expect(await history(pasta.id)).toHaveLength(1);

    // Cooks can't see or decide the waiting list; chefs can.
    expect(
      (await call('GET', '/api/ingredients/label-checks/pending', undefined, cook)).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `/api/ingredients/label-checks/${check.id}/approve`, undefined, cook))
        .statusCode,
    ).toBe(403);
    const pending = await ok('GET', '/api/ingredients/label-checks/pending');
    expect(pending.map((item: { id: string }) => item.id)).toEqual([check.id]);

    const approved = await ok('POST', `/api/ingredients/label-checks/${check.id}/approve`);
    expect(approved.status).toBe('applied');
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergens).toEqual(['milk', 'nuts']);
    const [latest] = await history(pasta.id);
    // The chef made the change; the record says it came from the label.
    expect(latest).toMatchObject({
      contains: ['milk', 'nuts'],
      cause: 'label check: Pesto',
      changedBy: 'Escoffier',
    });
    expect(await ok('GET', '/api/ingredients/label-checks/pending')).toEqual([]);

    // Decided once is decided.
    const again = await call('POST', `/api/ingredients/label-checks/${check.id}/reject`);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('label_check_decided');
  });

  it('leaves the ingredient as it was when a chef rejects the change', async () => {
    const { pesto, pasta } = await kitchen();
    const cook = await signInCook();
    const check = await ok(
      'POST',
      `/api/ingredients/${pesto.id}/label-checks`,
      { allergens: [], mayContain: ['milk'] },
      cook,
    );
    const rejected = await ok('POST', `/api/ingredients/label-checks/${check.id}/reject`);
    expect(rejected.status).toBe('rejected');
    const now = await ok('GET', `/api/ingredients/${pesto.id}`);
    expect(now.allergens).toEqual(['milk']);
    // A rejected reading doesn't count as the label having been checked.
    expect(now.labelCheck).toBeNull();
    expect(await history(pasta.id)).toHaveLength(1);

    const checks = await ok('GET', `/api/ingredients/${pesto.id}/label-checks`, undefined, cook);
    expect(checks).toEqual([expect.objectContaining({ id: check.id, status: 'rejected' })]);
  });

  it('may leave only so many changes waiting, so a chef can still see everyone else’s', async () => {
    const { pesto, leaves } = await kitchen();
    const cook = await signInCook();
    const send = (allergens: string[], cookies = cook) =>
      call(
        'POST',
        `/api/ingredients/${pesto.id}/label-checks`,
        { allergens, mayContain: [] },
        cookies,
      );
    for (let i = 0; i < MAX_WAITING_LABEL_CHECKS; i += 1) {
      expect((await send(['milk', 'nuts'])).statusCode).toBe(200);
    }
    const refused = await send(['milk', 'nuts']);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.code).toBe('label_checks_waiting');
    // Still free to say a label is unchanged, and so is anyone else.
    expect((await send(['milk'])).json().status).toBe('applied');
    await ok('POST', '/api/users', {
      displayName: 'Bo',
      role: 'cook',
      email: 'bo@example.com',
      password: 'a-long-enough-password',
    });
    const bo = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'bo@example.com', password: 'a-long-enough-password' },
    });
    const other = await call(
      'POST',
      `/api/ingredients/${leaves.id}/label-checks`,
      { allergens: ['celery'], mayContain: [] },
      { mise_session: cookieFrom(bo, 'mise_session')! },
    );
    expect(other.json().status).toBe('pending');
    const pending = await ok('GET', '/api/ingredients/label-checks/pending');
    expect(pending).toHaveLength(MAX_WAITING_LABEL_CHECKS + 1);
    // Once a chef decides one, there is room for another.
    await ok('POST', `/api/ingredients/label-checks/${pending[0].id}/reject`);
    expect((await send(['milk', 'nuts'])).statusCode).toBe(200);
  });

  it('may still not edit the ingredient itself', async () => {
    const { pesto } = await kitchen();
    const cook = await signInCook();
    const edit = await call('PATCH', `/api/ingredients/${pesto.id}`, { allergens: [] }, cook);
    expect(edit.statusCode).toBe(403);
  });
});

describe('who checked a label', () => {
  it('is in their own data, and the checks go with the ingredient', async () => {
    const { pesto } = await kitchen();
    const cook = await signInCook();
    await ok(
      'POST',
      `/api/ingredients/${pesto.id}/label-checks`,
      { allergens: ['milk'], mayContain: [], note: 'Batch 12' },
      cook,
    );
    const users = await ok('GET', '/api/users');
    const ana = users.find((user: { displayName: string }) => user.displayName === 'Ana');
    const data = await ok('GET', `/api/users/${ana.id}/data`);
    expect(data.labelChecks).toEqual([
      expect.objectContaining({
        ingredient: 'Pesto',
        changed: false,
        status: 'applied',
        note: 'Batch 12',
      }),
    ]);
  });
});

describe('a check sent after someone changed the ingredient', () => {
  // Read against Pesto with milk; sesame added in the editor before it arrived.
  const base = { allergens: ['milk'], mayContain: [] };

  async function sesameAdded(id: string) {
    await ok('PATCH', `/api/ingredients/${id}`, { allergens: ['milk', 'sesame'] });
  }

  it('changes nothing when it found no change', async () => {
    const { pesto, pasta } = await kitchen();
    await sesameAdded(pesto.id);
    const check = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk'],
      mayContain: [],
      base,
    });
    expect(check).toMatchObject({ changed: false, status: 'applied', before: base });
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergens).toEqual(['milk', 'sesame']);
    expect((await history(pasta.id))[0].contains).toEqual(['milk', 'sesame']);
  });

  it('waits for a chef when it found a difference, shown against what is there now', async () => {
    const { pesto } = await kitchen();
    await sesameAdded(pesto.id);
    // Sent by a chef, and still not applied over the sesame unseen.
    const check = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk', 'nuts'],
      mayContain: [],
      base,
    });
    expect(check).toMatchObject({
      changed: true,
      status: 'pending',
      before: { allergens: ['milk', 'sesame'], mayContain: [] },
      after: { allergens: ['milk', 'nuts'], mayContain: [] },
    });
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergens).toEqual(['milk', 'sesame']);
  });

  it('applies straight away when nothing changed in between', async () => {
    const { pesto } = await kitchen();
    const check = await ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
      allergens: ['milk', 'nuts'],
      mayContain: [],
      base,
    });
    expect(check).toMatchObject({ changed: true, status: 'applied' });
  });

  it('may not be approved once the ingredient changed after it came in', async () => {
    const { pesto } = await kitchen();
    const cook = await signInCook();
    const check = await ok(
      'POST',
      `/api/ingredients/${pesto.id}/label-checks`,
      { allergens: ['milk', 'nuts'], mayContain: [], base },
      cook,
    );
    expect(check.status).toBe('pending');
    await sesameAdded(pesto.id);
    const approve = await call('POST', `/api/ingredients/label-checks/${check.id}/approve`);
    expect(approve.statusCode).toBe(409);
    expect(approve.json().error.code).toBe('label_check_outdated');
    expect((await ok('GET', `/api/ingredients/${pesto.id}`)).allergens).toEqual(['milk', 'sesame']);
    // Still there to reject.
    expect((await ok('POST', `/api/ingredients/label-checks/${check.id}/reject`)).status).toBe(
      'rejected',
    );
  });
});
