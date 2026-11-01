import { readFile } from 'node:fs/promises';
import type { DishCard, DishCardFacts, MenuOverview } from '@mise/contracts';
import { loadCardFonts, type CardFonts } from '../lib/dishcard/fonts.js';
import type { CardPage, Op } from '../lib/dishcard/layout.js';

/**
 * The card fonts, read from disk. In the browser the loader fetches the
 * bundled files; under test their addresses are /@fs/<path on disk>, so the
 * fetch is answered by reading that file. The fonts are the real ones, so
 * every line wraps exactly as it does in the app.
 */
export async function testFonts(): Promise<CardFonts> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.startsWith('/@fs/')) return realFetch(input);
    return new Response(await readFile(url.slice('/@fs'.length)));
  }) as typeof fetch;
  try {
    return await loadCardFonts();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const facts = (over: Partial<DishCardFacts> = {}): DishCardFacts => ({
  contains: [],
  mayContain: [],
  vegan: 'yes',
  gluten: [],
  nuts: [],
  ...over,
});

/** An invented dish with every kind of row a card can have. */
export function sampleCard(over: Partial<DishCard> = {}): DishCard {
  return {
    kitchenName: 'Demo Kitchen',
    dish: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Pear tart, hazelnut praline',
      status: 'published',
      menus: ['Autumn menu'],
      flavourProfile: ['Sweet', 'Nutty'],
      servingTemperature: 'warm',
      course: 'dessert',
      drinkPairings: ['Late harvest riesling'],
      cutlery: ['Dessert spoon'],
      photoUrl: null,
    },
    rows: [
      {
        recipeId: '00000000-0000-4000-8000-000000000011',
        name: 'Rough puff pastry',
        ...facts({ contains: ['gluten', 'milk'], vegan: 'no', gluten: ['wheat'] }),
      },
      {
        recipeId: '00000000-0000-4000-8000-000000000012',
        name: 'Vanilla custard',
        ...facts({ contains: ['eggs', 'milk', 'gluten'], vegan: 'no', gluten: ['wheat'] }),
      },
      {
        recipeId: '00000000-0000-4000-8000-000000000013',
        name: 'Hazelnut praline',
        ...facts({ contains: ['nuts'], mayContain: ['peanuts'], nuts: ['hazelnut'] }),
      },
      {
        recipeId: '00000000-0000-4000-8000-000000000014',
        name: 'Poached pear',
        ...facts({ vegan: 'unknown' }),
      },
    ],
    other: facts({ contains: ['sulphites'] }),
    whole: facts({
      contains: ['eggs', 'gluten', 'milk', 'nuts', 'sulphites'],
      mayContain: ['peanuts'],
      vegan: 'no',
      gluten: ['wheat'],
      nuts: ['hazelnut'],
    }),
    attention: { veganUnknown: [], missingDetails: [] },
    settings: {
      title: null,
      locationName: 'Demo Kitchen',
      address: null,
      logoUrl: null,
      warnings: {},
      hidden: [],
      theme: 'day',
      access: 'everyone',
    },
    ...over,
  };
}

/** A menu with as many invented dishes as asked, spread over the courses. */
export function sampleOverview(count: number): MenuOverview {
  const courses = ['starter', 'main', 'dessert'] as const;
  const allergens = ['milk', 'eggs', 'gluten', 'celery', 'mustard', 'fish', 'nuts'] as const;
  return {
    kitchenName: 'Demo Kitchen',
    menu: { id: '00000000-0000-4000-8000-000000000100', name: 'Long menu', description: null },
    settings: sampleCard().settings,
    dishes: Array.from({ length: count }, (_, i) => ({
      recipeId: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`,
      name: `Dish number ${i + 1}`,
      course: courses[Math.floor((i * courses.length) / count)]!,
      ...facts({
        contains: [allergens[i % allergens.length]!],
        vegan: i % 5 === 0 ? 'yes' : 'no',
      }),
    })),
  };
}

export type Mark = 'X' | '(X)';

/**
 * Read an allergen table back off a drawn page: which mark sits in which
 * row and which column. Columns are found by their icons, rows by their name.
 */
export function marksOnPage(page: CardPage, rowNames: string[]): Map<string, Map<string, Mark>> {
  const ops = page.ops;
  const icons = ops.filter(
    (op): op is Extract<Op, { kind: 'icon' }> => op.kind === 'icon' && op.icon !== 'check',
  );
  // The header icons sit on one line; chips elsewhere don't matter here.
  const headerY = Math.min(...icons.map((op) => op.y));
  const columns = icons
    .filter((op) => Math.abs(op.y - headerY) < 0.5)
    .map((op) => ({ name: op.icon, x: op.x + op.size / 2 }));
  const texts = ops.filter((op): op is Extract<Op, { kind: 'text' }> => op.kind === 'text');
  const rows = rowNames.flatMap((name) => {
    // The whole name, or for a name wrapped over two lines, its first line.
    const label =
      texts.find((op) => op.text === name && op.y > headerY) ??
      texts.find((op) => op.text.length > 3 && name.startsWith(op.text) && op.y > headerY);
    return label ? [{ name, y: label.y }] : [];
  });
  const table = new Map<string, Map<string, Mark>>();
  for (const op of texts) {
    if (op.text !== 'X' && op.text !== '(X)') continue;
    if (op.y <= headerY) continue;
    const row = rows.reduce((best, r) =>
      Math.abs(r.y - op.y) < Math.abs(best.y - op.y) ? r : best,
    );
    const column = columns.reduce((best, c) =>
      Math.abs(c.x - op.x) < Math.abs(best.x - op.x) ? c : best,
    );
    if (Math.abs(row.y - op.y) > 6) continue; // the key under the table
    const cells = table.get(row.name) ?? new Map<string, Mark>();
    cells.set(column.name, op.text);
    table.set(row.name, cells);
  }
  return table;
}
