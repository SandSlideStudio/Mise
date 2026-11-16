import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setUpKitchen, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
let admin: string;
let ids: { stock: string; veloute: string; pie: string; onion: string };

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
 * The fixture from the domain tests, built through the API: a pie that takes a
 * velouté that takes a stock that takes onions. Three levels, which is normal
 * in a fine dining kitchen and is where scaling earns its keep.
 */
beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);

  const onion = await post(ctx.app, '/api/ingredients', { name: 'Onion', baseUnit: 'g' }, admin);

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

  ids = { stock: stock.id, veloute: veloute.id, pie: pie.id, onion: onion.id };
});

function lineFor(lines: { name: string; quantity: { value: number } }[], name: string) {
  const found = lines.find((line) => line.name === name);
  if (!found) throw new Error(`no line for ${name}`);
  return found;
}

describe('reading a recipe at another size', () => {
  it('reads at one batch when no size is asked for', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().factor).toBe(1);
  });

  it('scales all three levels to a portion count', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded?portions=25`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    const { factor, lines } = response.json();

    expect(factor).toBeCloseTo(2.5);
    // 25 pies is 2.5 batches, so 1250 ml of velouté.
    expect(lineFor(lines, 'Chicken velouté').quantity.value).toBeCloseTo(1250);
    // 1250 ml of velouté is 1.25 batches, each taking 800 ml of stock.
    expect(lineFor(lines, 'Chicken stock').quantity.value).toBeCloseTo(1000);
    // 1000 ml of stock is half a batch, so half its 200 g of onion.
    expect(lineFor(lines, 'Onion').quantity.value).toBeCloseTo(100);
  });

  it('scales to a target yield, which is the other way a chef asks', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.stock}/expanded?yieldValue=5&yieldUnit=l`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    // Five litres from a two litre recipe.
    expect(response.json().factor).toBeCloseTo(2.5);
    expect(lineFor(response.json().lines, 'Onion').quantity.value).toBeCloseTo(500);
  });

  it('nests sub-recipe contents beneath the line that uses them', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded`,
      cookies: as(admin),
    });
    const lines = response.json().lines;
    expect(lines.map((l: { name: string; depth: number }) => [l.name, l.depth])).toEqual([
      ['Chicken velouté', 0],
      ['Chicken stock', 1],
      ['Onion', 2],
    ]);
  });

  it('carries the note through, because that is half the instruction', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded`,
      cookies: as(admin),
    });
    expect(lineFor(response.json().lines, 'Onion')).toMatchObject({ note: 'roughly chopped' });
  });

  it('refuses to scale by portions a recipe that has none', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.stock}/expanded?portions=10`,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain('not written in portions');
  });

  it('includes the allergens, so scaling never loses them', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded?portions=25`,
      cookies: as(admin),
    });
    expect(response.json()).toHaveProperty('allergens');
  });

  it('lets a cook read a scaled spec, which is the whole point on the line', async () => {
    const cook = await post(
      ctx.app,
      '/api/users',
      { displayName: 'Marco', role: 'cook', pin: '4821' },
      admin,
    );
    const enrolled = await post(ctx.app, '/api/auth/devices', { name: 'Pass tablet' }, admin);
    const device = enrolled.token;
    expect(device).toBeTruthy();

    const signedIn = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      payload: { userId: cook.id, pin: '4821' },
      cookies: { mise_device: device },
    });
    const cookCookie = signedIn.cookies.find(
      (c: { name: string }) => c.name === 'mise_session',
    )?.value;

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/recipes/${ids.pie}/expanded?portions=25`,
      cookies: { mise_session: cookCookie! },
    });
    expect(response.statusCode).toBe(200);
  });
});

const HEADERS: Record<string, Uint8Array> = {
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
  webp: Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'),
  avif: Buffer.concat([
    Buffer.from([0, 0, 0, 0x1c]),
    Buffer.from('ftypavif\0\0\0\0avifmif1miaf', 'latin1'),
  ]),
};
const EXTENSIONS: Record<string, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
};
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe('plating photographs', () => {
  it('refuses anything that is not an image we can store', async () => {
    const form = new FormData();
    form.append('file', new Blob(['not an image'], { type: 'text/plain' }), 'notes.txt');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/recipes/${ids.pie}/photos`,
      payload: form,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('image_type');
  });

  it('refuses a photograph on a recipe that does not exist', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG_HEAD], { type: 'image/png' }), 'plate.png');

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/recipes/11111111-1111-4111-8111-111111111111/photos',
      payload: form,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(404);
  });

  it('stores an image and makes the first one represent the recipe', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG_HEAD], { type: 'image/png' }), 'x');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/recipes/${ids.pie}/photos`,
      payload: form,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().isPrimary).toBe(true);
    // The stored name is generated here, never taken from the browser.
    expect(response.json().url).not.toContain('plate');
    expect(response.json().url).toMatch(/^\/api\/uploads\/[0-9a-f-]+\.png$/);
  });

  it('stores each kind of photo by what its bytes prove, whatever it claims to be', async () => {
    for (const [kind, extension] of Object.entries(EXTENSIONS)) {
      const form = new FormData();
      // Claimed as a PNG every time: the content decides.
      form.append('file', new Blob([HEADERS[kind]!], { type: 'image/png' }), 'plate.png');
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/recipes/${ids.pie}/photos`,
        payload: form,
        cookies: as(admin),
      });
      expect(response.statusCode, kind).toBe(200);
      expect(response.json().url, kind).toMatch(new RegExp(`\\${extension}$`));
      const served = await ctx.app.inject({
        method: 'GET',
        url: response.json().url,
        cookies: as(admin),
      });
      expect(served.headers['content-type'], kind).toBe(`image/${kind === 'jpeg' ? 'jpeg' : kind}`);
    }
  });

  it('refuses text, HTML and SVG renamed to look like a photo', async () => {
    const disguises: [string, string, string][] = [
      ['notes', 'text/plain', 'image/jpeg'],
      ['<!doctype html><script>alert(1)</script>', 'text/html', 'image/png'],
      ['<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'image/svg+xml', 'image/webp'],
    ];
    for (const [content, , claimed] of disguises) {
      const form = new FormData();
      form.append('file', new Blob([content], { type: claimed }), 'plate.jpg');
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/recipes/${ids.pie}/photos`,
        payload: form,
        cookies: as(admin),
      });
      expect(response.statusCode, content).toBe(400);
      expect(response.json().error.code).toBe('image_type');
    }
    const empty = new FormData();
    empty.append('file', new Blob([], { type: 'image/png' }), 'plate.png');
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/recipes/${ids.pie}/photos`,
      payload: empty,
      cookies: as(admin),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an upload from a cook', async () => {
    const form = new FormData();
    form.append('file', new Blob([PNG_HEAD], { type: 'image/png' }), 'x');

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/recipes/${ids.pie}/photos`,
      payload: form,
    });
    expect(response.statusCode).toBe(401);
  });

  it('keeps uploaded images behind a session', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/uploads/anything.png' });
    expect(response.statusCode).toBe(401);
  });
});
