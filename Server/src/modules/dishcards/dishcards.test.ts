import { randomBytes, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dishCardSettings } from '../../db/schema.js';
import { cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: Record<string, string>;

beforeEach(async () => {
  admin = { mise_session: await setUpKitchen(ctx.app) };
});

async function post(url: string, payload: Record<string, unknown>, cookies = admin) {
  const response = await ctx.app.inject({ method: 'POST', url, payload, cookies });
  if (response.statusCode !== 200) {
    throw new Error(`${url} failed: ${response.statusCode} ${response.body}`);
  }
  return response.json();
}

const ingredient = (payload: Record<string, unknown>) =>
  post('/api/ingredients', { baseUnit: 'g', ...payload });

const sub = (recipeId: string, sortOrder: number) => ({
  sortOrder,
  quantity: { value: 50, unit: 'g' },
  ref: { kind: 'recipe', recipeId },
});
const ing = (ingredientId: string, sortOrder: number) => ({
  sortOrder,
  quantity: { value: 5, unit: 'g' },
  ref: { kind: 'ingredient', ingredientId },
});

/** Luchtige Mais: three of its components, enough to show every rule. */
async function luchtigeMais(extra: Record<string, unknown>[] = []) {
  const corn = await ingredient({ name: 'Mais', vegan: true });
  const garlic = await ingredient({
    name: 'Zwarte knoflook',
    allergens: ['sulphites'],
    vegan: true,
  });
  const mustard = await ingredient({ name: 'Mosterdzaad', allergens: ['mustard'], vegan: true });

  const prep = (name: string, components: unknown[]) =>
    post('/api/recipes', { name, type: 'prep', yield: { value: 1, unit: 'kg' }, components });
  const cream = await prep('Mais Crème', [ing(corn.id, 0)]);
  const puree = await prep('Zwarte Knoflook Puree', [ing(garlic.id, 0), ing(corn.id, 1)]);
  const crumble = await prep('Uitgebakken Mosterd', [ing(mustard.id, 0)]);

  return post('/api/recipes', {
    name: 'Luchtige Mais',
    type: 'dish',
    yield: { value: 10, unit: 'each' },
    portions: 10,
    flavourProfile: ['Romig', 'Knoflook', 'Fris'],
    servingTemperature: 'cold',
    course: 'middle',
    drinkPairings: ['Bordeaux Wit', 'Inspiration 4.1'],
    cutlery: ['Kleine Lepel'],
    components: [sub(cream.id, 0), sub(puree.id, 1), sub(crumble.id, 2), ...extra],
  });
}

function card(recipeId: string, cookies = admin) {
  return ctx.app.inject({ method: 'GET', url: `/api/recipes/${recipeId}/card`, cookies });
}

describe('front-of-house fields on a recipe', () => {
  it('keeps what the chef fills in, and starts empty when they do not', async () => {
    const dish = await luchtigeMais();
    expect(dish).toMatchObject({
      flavourProfile: ['Romig', 'Knoflook', 'Fris'],
      servingTemperature: 'cold',
      course: 'middle',
      drinkPairings: ['Bordeaux Wit', 'Inspiration 4.1'],
      cutlery: ['Kleine Lepel'],
    });

    const plain = await post('/api/recipes', {
      name: 'Fond',
      type: 'prep',
      yield: { value: 1, unit: 'l' },
    });
    expect(plain).toMatchObject({
      flavourProfile: [],
      servingTemperature: null,
      course: null,
    });
  });

  it('changes one field without touching the rest', async () => {
    const dish = await luchtigeMais();
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/recipes/${dish.id}`,
      payload: { course: 'starter' },
      cookies: admin,
    });
    expect(response.json()).toMatchObject({
      course: 'starter',
      flavourProfile: ['Romig', 'Knoflook', 'Fris'],
    });
  });

  it('refuses a serving temperature it does not know', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes',
      payload: {
        name: 'X',
        type: 'dish',
        yield: { value: 1, unit: 'each' },
        servingTemperature: 'lukewarm',
      },
      cookies: admin,
    });
    expect(response.statusCode).toBe(400);
  });

  it('copies them along with the spec', async () => {
    const dish = await luchtigeMais();
    const copy = await post(`/api/recipes/${dish.id}/duplicate`, { name: 'Luchtige Mais II' });
    expect(copy).toMatchObject({ course: 'middle', cutlery: ['Kleine Lepel'] });
  });
});

describe('vegan and allergen names on an ingredient', () => {
  it('starts as unanswered, never as vegan', async () => {
    const salt = await ingredient({ name: 'Zout' });
    expect(salt).toMatchObject({ vegan: null, allergenDetails: { gluten: [], nuts: [] } });
  });

  it('keeps which cereal and which nut', async () => {
    const flour = await ingredient({
      name: 'Bloem',
      allergens: ['gluten'],
      allergenDetails: { gluten: ['tarwe'], nuts: [] },
    });
    expect(flour.allergenDetails.gluten).toEqual(['tarwe']);
  });
});

describe('the dish card', () => {
  it('lists allergens per sub-recipe, in the order of the dish', async () => {
    const dish = await luchtigeMais();
    const response = await card(dish.id);
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.kitchenName).toBe('The Test Kitchen');
    expect(body.dish).toMatchObject({ name: 'Luchtige Mais', course: 'middle', photoUrl: null });
    expect(body.rows.map((row: { name: string }) => row.name)).toEqual([
      'Mais Crème',
      'Zwarte Knoflook Puree',
      'Uitgebakken Mosterd',
    ]);
    expect(body.rows[1].contains).toEqual(['sulphites']);
    expect(body.rows[2].contains).toEqual(['mustard']);
    expect(body.rows.every((row: { vegan: string }) => row.vegan === 'yes')).toBe(true);
    expect(body.other).toBeNull();
    expect(body.whole).toMatchObject({ contains: ['mustard', 'sulphites'], vegan: 'yes' });
    expect(body.attention).toEqual({ veganUnknown: [], missingDetails: [] });
  });

  it('names the active menus the dish is on, and no others', async () => {
    const dish = await luchtigeMais();
    expect((await card(dish.id)).json().dish.menus).toEqual([]);

    await post('/api/menus', { name: 'Winterkaart', status: 'active', dishes: [dish.id] });
    await post('/api/menus', { name: 'Proeverij', status: 'active', dishes: [dish.id] });
    await post('/api/menus', { name: 'Zomerkaart', status: 'draft', dishes: [dish.id] });
    await post('/api/menus', { name: 'Lunch', status: 'active', dishes: [] });

    expect((await card(dish.id)).json().dish.menus).toEqual(['Proeverij', 'Winterkaart']);
  });

  it('gives an ingredient straight on the plate its own row when it brings an allergen', async () => {
    const hazelnut = await ingredient({ name: 'Hazelnoot', allergens: ['nuts'], vegan: true });
    const dish = await luchtigeMais([ing(hazelnut.id, 3)]);
    const body = (await card(dish.id)).json();
    expect(body.other).toMatchObject({ contains: ['nuts'] });
    expect(body.whole.contains).toContain('nuts');
    // Nobody said which nut yet.
    expect(body.attention.missingDetails).toEqual(['Hazelnoot']);
  });

  it('points out ingredients nobody has said are vegan', async () => {
    const salt = await ingredient({ name: 'Zout' });
    const dish = await luchtigeMais([ing(salt.id, 3)]);
    const body = (await card(dish.id)).json();
    expect(body.whole.vegan).toBe('unknown');
    expect(body.attention.veganUnknown).toEqual(['Zout']);
  });

  it('only exists for a dish', async () => {
    const prep = await post('/api/recipes', {
      name: 'Fond',
      type: 'prep',
      yield: { value: 1, unit: 'l' },
    });
    expect((await card(prep.id)).statusCode).toBe(400);
    expect((await card(randomUUID())).statusCode).toBe(404);
  });

  it('can be kept to chefs and managers', async () => {
    const dish = await luchtigeMais();
    await post('/api/users', {
      displayName: 'Marco',
      role: 'cook',
      email: 'marco@example.com',
      password: 'a-long-enough-password',
    });
    const signIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'marco@example.com', password: 'a-long-enough-password' },
    });
    const cook = { mise_session: cookieFrom(signIn, 'mise_session')! };

    expect((await card(dish.id, cook)).statusCode).toBe(200);

    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/dish-cards/settings',
      payload: { access: 'managers' },
      cookies: admin,
    });
    expect((await card(dish.id, cook)).statusCode).toBe(403);
    expect((await card(dish.id)).statusCode).toBe(200);

    const change = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/dish-cards/settings',
      payload: { access: 'everyone' },
      cookies: cook,
    });
    expect(change.statusCode).toBe(403);
  });
});

describe('the dishes page', () => {
  it('lists every dish with the front of its card and its allergens, and no preps', async () => {
    const dish = await luchtigeMais();
    await post('/api/menus', { name: 'Winterkaart', status: 'active', dishes: [dish.id] });
    const response = await ctx.app.inject({ method: 'GET', url: '/api/dishes', cookies: admin });
    expect(response.statusCode).toBe(200);
    const dishes = response.json();
    expect(dishes).toHaveLength(1);
    expect(dishes[0]).toMatchObject({
      id: dish.id,
      name: 'Luchtige Mais',
      course: 'middle',
      servingTemperature: 'cold',
      menus: ['Winterkaart'],
      photoUrl: null,
      facts: { contains: ['mustard', 'sulphites'], vegan: 'yes' },
    });
  });

  it('is there for everyone signed in, even when the cards are kept to chefs', async () => {
    await luchtigeMais();
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/dish-cards/settings',
      payload: { access: 'managers' },
      cookies: admin,
    });
    const created = await post('/api/users', { displayName: 'Marco', role: 'cook', pin: '4821' });
    const enrolled = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/devices',
      payload: { name: 'Pass tablet' },
      cookies: admin,
    });
    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: created.id, pin: '4821' },
      cookies: { mise_device: cookieFrom(enrolled, 'mise_device')! },
    });
    const cook = { mise_session: cookieFrom(signedIn, 'mise_session')! };
    const dishes = await ctx.app.inject({ method: 'GET', url: '/api/dishes', cookies: cook });
    expect(dishes.statusCode).toBe(200);
    expect(dishes.json()).toHaveLength(1);

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/dishes' });
    expect(anonymous.statusCode).toBe(401);
  });
});

describe('dish card settings', () => {
  it('start with nothing filled in and a white card', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/dish-cards/settings',
      cookies: admin,
    });
    expect(response.json()).toEqual({
      title: null,
      locationName: null,
      address: null,
      logoUrl: null,
      warnings: {},
      hidden: [],
      theme: 'day',
      access: 'everyone',
    });
  });

  it('keep the menu line hidden for a kitchen that hid the season before 2.1', async () => {
    await ctx.app.inject({ method: 'GET', url: '/api/dish-cards/settings', cookies: admin });
    await ctx.db.update(dishCardSettings).set({ hidden: ['season', 'summary', 'gone'] });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/dish-cards/settings',
      cookies: admin,
    });
    expect(response.json().hidden).toEqual(['menu', 'summary']);
  });

  it('keep a warning per language and drop the empty ones', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/dish-cards/settings',
      payload: {
        warnings: { nl: 'Eigendom van Down to Earth Dining.', en: '   ' },
        hidden: ['summary', 'summary'],
        theme: 'night',
        address: '',
      },
      cookies: admin,
    });
    expect(response.json()).toMatchObject({
      warnings: { nl: 'Eigendom van Down to Earth Dining.' },
      hidden: ['summary'],
      theme: 'night',
      address: null,
    });
  });

  it('take a logo, replace it, and let it go', async () => {
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)]);
    const upload = () =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/dish-cards/logo',
        cookies: admin,
        ...multipart('image/png', png),
      });

    const first = await upload();
    expect(first.statusCode).toBe(200);
    const url = first.json().logoUrl as string;
    expect(url).toMatch(/^\/api\/uploads\/logo-[\w-]+\.png$/);
    expect((await ctx.app.inject({ method: 'GET', url, cookies: admin })).statusCode).toBe(200);

    const second = await upload();
    expect(second.json().logoUrl).not.toBe(url);
    expect((await ctx.app.inject({ method: 'GET', url, cookies: admin })).statusCode).toBe(404);

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/dish-cards/logo',
      cookies: admin,
    });
    expect(removed.json().logoUrl).toBeNull();
  });

  it('refuse a logo that is not an image', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/dish-cards/logo',
      cookies: admin,
      ...multipart('application/pdf', Buffer.from('%PDF-1.4')),
    });
    expect(response.statusCode).toBe(400);
  });
});

function multipart(type: string, data: Buffer) {
  const boundary = `----mise${randomUUID()}`;
  return {
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
