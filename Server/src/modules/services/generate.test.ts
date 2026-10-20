import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;
let ids: { stock: string; veloute: string; pie: string; fricassee: string; service: string };

function as(cookie: string) {
  return { mise_session: cookie };
}

async function post(
  app: FastifyInstance,
  url: string,
  payload: Record<string, unknown>,
  cookie: string,
) {
  const response = await app.inject({ method: 'POST', url, payload, cookies: as(cookie) });
  if (response.statusCode !== 200) {
    throw new Error(`${url} failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

/**
 * The fixture from the domain tests, built through the API.
 *
 * Two dishes both take the same velouté, the velouté takes a stock, and the
 * stock takes onions. That shared sub-recipe is the whole reason generation is
 * worth having: adding it up by hand is what people get wrong.
 */
beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);

  const onion = await post(
    ctx.app,
    '/api/ingredients',
    { name: 'Onion', baseUnit: 'g', yieldPercent: 90, requiresPrep: true },
    admin,
  );
  const tarragon = await post(
    ctx.app,
    '/api/ingredients',
    { name: 'Tarragon', baseUnit: 'g', requiresPrep: true },
    admin,
  );

  const stock = await post(
    ctx.app,
    '/api/recipes',
    {
      name: 'Chicken stock',
      type: 'prep',
      yield: { value: 2, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 200, unit: 'g' },
          note: 'roughly chopped',
          ref: { kind: 'ingredient', ingredientId: onion.id },
        },
      ],
    },
    admin,
  );

  const veloute = await post(
    ctx.app,
    '/api/recipes',
    {
      name: 'Chicken velouté',
      type: 'prep',
      yield: { value: 1, unit: 'l' },
      components: [
        {
          sortOrder: 0,
          quantity: { value: 800, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: stock.id },
        },
      ],
    },
    admin,
  );

  const pie = await post(
    ctx.app,
    '/api/recipes',
    {
      name: 'Chicken pie',
      type: 'dish',
      yield: { value: 10, unit: 'each' },
      portions: 10,
      components: [
        {
          sortOrder: 0,
          quantity: { value: 500, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: veloute.id },
        },
      ],
    },
    admin,
  );

  const fricassee = await post(
    ctx.app,
    '/api/recipes',
    {
      name: 'Chicken fricassée',
      type: 'dish',
      yield: { value: 8, unit: 'each' },
      portions: 8,
      components: [
        {
          sortOrder: 0,
          quantity: { value: 400, unit: 'ml' },
          ref: { kind: 'recipe', recipeId: veloute.id },
        },
        {
          sortOrder: 1,
          quantity: { value: 20, unit: 'g' },
          note: 'picked',
          ref: { kind: 'ingredient', ingredientId: tarragon.id },
        },
      ],
    },
    admin,
  );

  const service = await post(
    ctx.app,
    '/api/services',
    { date: '2026-09-14', period: 'dinner', covers: 33 },
    admin,
  );

  ids = {
    stock: stock.id,
    veloute: veloute.id,
    pie: pie.id,
    fricassee: fricassee.id,
    service: service.id,
  };
});

async function addDish(recipeId: string, portions: number) {
  return post(
    ctx.app,
    `/api/services/${ids.service}/dishes`,
    { recipeId, plannedPortions: portions },
    admin,
  );
}

async function generate() {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/services/${ids.service}/generate`,
    cookies: as(admin),
  });
  return response;
}

function task(tasks: { description: string }[], name: string) {
  const found = tasks.find((t) => t.description.startsWith(name));
  if (!found)
    throw new Error(`no task for ${name}. Got: ${tasks.map((t) => t.description).join(', ')}`);
  return found as { description: string; quantity: { value: number; unit: string } } & Record<
    string,
    unknown
  >;
}

describe('generating a prep list', () => {
  it('refuses until there are dishes on the service', async () => {
    const response = await generate();
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('dishes that are on tonight');
  });

  it('aggregates a shared sub-recipe into one line at the summed quantity', async () => {
    await addDish(ids.pie, 20);
    await addDish(ids.fricassee, 8);

    const response = await generate();
    expect(response.statusCode).toBe(200);
    const { tasks } = response.json();

    // 20 pies is twice the base recipe, so 1000 ml, plus 400 ml for 8 fricassées.
    const veloute = task(tasks, 'Chicken velouté');
    expect(veloute.quantity.value).toBeCloseTo(1400);
    // It appears exactly once, which is the entire point.
    expect(
      tasks.filter((t: { description: string }) => t.description.includes('velouté')),
    ).toHaveLength(1);
  });

  it('scales the third level to the combined figure above it', async () => {
    await addDish(ids.pie, 20);
    await addDish(ids.fricassee, 8);
    const { tasks } = (await generate()).json();

    // 1400 ml of velouté is 1.4 batches, each taking 800 ml of stock.
    expect(task(tasks, 'Chicken stock').quantity.value).toBeCloseTo(1120);
  });

  it('grosses ingredients up for trim loss', async () => {
    await addDish(ids.pie, 20);
    await addDish(ids.fricassee, 8);
    const { tasks } = (await generate()).json();

    // 1120 ml of stock is 0.56 batches, so 112 g of peeled onion. At 90 per
    // cent yield that means pulling about 124 g from the walk-in.
    expect(task(tasks, 'Onion').quantity.value).toBeCloseTo(124.44, 1);
  });

  it('puts the deepest work first, so the stock is on before the sauce', async () => {
    await addDish(ids.pie, 20);
    const { tasks } = (await generate()).json();
    const order = tasks.map((t: { description: string }) => t.description);
    expect(order.findIndex((d: string) => d.startsWith('Onion'))).toBeLessThan(
      order.findIndex((d: string) => d.startsWith('Chicken stock')),
    );
    expect(order.findIndex((d: string) => d.startsWith('Chicken stock'))).toBeLessThan(
      order.findIndex((d: string) => d.startsWith('Chicken velouté')),
    );
  });

  it('records where each total came from, so a chef can check the arithmetic', async () => {
    await addDish(ids.pie, 20);
    await addDish(ids.fricassee, 8);
    const { tasks } = (await generate()).json();

    const veloute = task(tasks, 'Chicken velouté');
    expect((veloute.usedBy as { recipeName: string }[]).map((u) => u.recipeName).sort()).toEqual([
      'Chicken fricassée',
      'Chicken pie',
    ]);
  });

  it('names the line and keeps the amount in its own column', async () => {
    await addDish(ids.pie, 20);
    const { tasks } = (await generate()).json();
    const veloute = task(tasks, 'Chicken velouté');
    // The list prints the quantity in front of the description, so putting it
    // in both places would show it twice.
    expect(veloute.description).toBe('Chicken velouté');
    expect(veloute.quantity).toEqual({ value: 1000, unit: 'ml' });
  });

  it('refuses a dish that has no portion count, naming what to fix', async () => {
    await addDish(ids.stock, 5);
    const response = await generate();
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('portion count');
  });
});

/**
 * The merge is what decides whether anyone presses this button twice. Losing
 * an afternoon's ticked-off work would end its use immediately.
 */
describe('generating a second time', () => {
  beforeEach(async () => {
    await addDish(ids.pie, 20);
    await generate();
  });

  it('updates quantities rather than duplicating lines', async () => {
    // Covers went up: 30 pies instead of 20.
    await addDish(ids.pie, 30);
    const response = await generate();
    const { created, updated, tasks } = response.json();

    expect(created).toBe(0);
    expect(updated).toBeGreaterThan(0);
    expect(
      tasks.filter((t: { description: string }) => t.description.includes('velouté')),
    ).toHaveLength(1);
    expect(task(tasks, 'Chicken velouté').quantity.value).toBeCloseTo(1500);
  });

  it('leaves finished work exactly as it was', async () => {
    const before = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}/tasks`,
        cookies: as(admin),
      })
    ).json();
    const stock = task(before, 'Chicken stock');

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${stock.id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    // Now double the covers and regenerate.
    await addDish(ids.pie, 40);
    const { tasks, kept } = (await generate()).json();

    const after = task(tasks, 'Chicken stock');
    expect(after.status).toBe('done');
    // The quantity is not rewritten either: they made what they made.
    expect(after.quantity.value).toBeCloseTo(stock.quantity.value);
    expect(kept).toBeGreaterThan(0);
  });

  it('leaves a line someone is making alone', async () => {
    const before = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}/tasks`,
        cookies: as(admin),
      })
    ).json();
    const stock = task(before, 'Chicken stock');
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${stock.id}`,
      payload: { status: 'in_progress' },
      cookies: as(admin),
    });

    await addDish(ids.pie, 40);
    const { tasks } = (await generate()).json();
    const after = task(tasks, 'Chicken stock');
    expect(after.status).toBe('in_progress');
    expect(after.quantity.value).toBeCloseTo(stock.quantity.value);
  });

  it('keeps an amount a chef corrected by hand', async () => {
    const before = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}/tasks`,
        cookies: as(admin),
      })
    ).json();
    const stock = task(before, 'Chicken stock');
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${stock.id}`,
      payload: { quantity: { value: 5, unit: 'l' } },
      cookies: as(admin),
    });

    await addDish(ids.pie, 40);
    const { tasks } = (await generate()).json();
    expect(task(tasks, 'Chicken stock').quantity.value).toBeCloseTo(5000);
  });

  it('gives one list when two people generate at the same moment', async () => {
    await addDish(ids.pie, 40);
    const [first, second] = await Promise.all([generate(), generate()]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const tasks = second.json().tasks as { description: string }[];
    const velouteLines = tasks.filter((t) => t.description.includes('velouté'));
    expect(velouteLines).toHaveLength(1);
  });

  it('never touches a task somebody added by hand', async () => {
    await post(
      ctx.app,
      `/api/services/${ids.service}/tasks`,
      { description: 'Butcher the lamb racks' },
      admin,
    );

    const { tasks } = (await generate()).json();
    const manual = tasks.find(
      (t: { description: string }) => t.description === 'Butcher the lamb racks',
    );
    expect(manual).toBeDefined();
    expect(manual.source).toBe('manual');
  });

  it('withdraws a generated line once the dish comes off the menu', async () => {
    const dishes = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}`,
        cookies: as(admin),
      })
    ).json().dishes;

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/services/${ids.service}/dishes/${dishes[0].id}`,
      cookies: as(admin),
    });
    await addDish(ids.fricassee, 8);

    const { tasks } = (await generate()).json();
    // The fricassée brings tarragon with it; the pie is gone but the velouté
    // is shared, so it stays at the smaller figure.
    expect(task(tasks, 'Chicken velouté').quantity.value).toBeCloseTo(400);
    expect(task(tasks, 'Tarragon')).toBeDefined();
  });

  it('keeps a withdrawn line if somebody already made it', async () => {
    const before = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}/tasks`,
        cookies: as(admin),
      })
    ).json();
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task(before, 'Onion').id}`,
      payload: { status: 'done' },
      cookies: as(admin),
    });

    const dishes = (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/services/${ids.service}`,
        cookies: as(admin),
      })
    ).json().dishes;
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/services/${ids.service}/dishes/${dishes[0].id}`,
      cookies: as(admin),
    });
    await addDish(ids.fricassee, 8);

    const { tasks } = (await generate()).json();
    // The onion was prepped. It does not vanish because the menu changed.
    expect(task(tasks, 'Onion').status).toBe('done');
  });

  it('records when the list was last generated', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${ids.service}`,
      cookies: as(admin),
    });
    expect(response.json().generatedAt).not.toBeNull();
  });
});

describe('dishes on a service', () => {
  it('names the dishes it is carrying', async () => {
    await addDish(ids.pie, 20);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/services/${ids.service}`,
      cookies: as(admin),
    });
    expect(response.json().dishes[0]).toMatchObject({
      recipeName: 'Chicken pie',
      plannedPortions: 20,
    });
  });

  it('changes the portions rather than adding the dish twice', async () => {
    await addDish(ids.pie, 20);
    const dishes = await addDish(ids.pie, 35);
    expect(dishes).toHaveLength(1);
    expect(dishes[0].plannedPortions).toBe(35);
  });

  it('stops a cook changing what is on tonight', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/services/${ids.service}/dishes`,
      payload: { recipeId: ids.pie, plannedPortions: 20 },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('removing a dish', () => {
  it('only removes it from the service in the address', async () => {
    const dishes = await addDish(ids.pie, 10);
    const other = await post(
      ctx.app,
      '/api/services',
      { date: '2026-12-31', period: 'lunch' },
      admin,
    );
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/services/${other.id}/dishes/${dishes[0].id}`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(404);
  });
});
