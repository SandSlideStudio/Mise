import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ExpandedRecipe, RecipeComponent } from '@mise/contracts';
import {
  componentsAsSent,
  inCourseOrder,
  knownNames,
  linesAsSent,
  menuDishAsSent,
} from './offlineEdits.js';
import { recipeAwaits, waitingOn } from '../lib/awaiting.js';
import type { OutboxEntry } from '../lib/outbox.js';

const line = (
  depth: number,
  kind: 'ingredient' | 'recipe',
  sourceId: string,
  name: string,
  value: number,
  unit: string,
) => ({ depth, kind, sourceId, name, section: null, note: null, quantity: { value, unit } });

const before: RecipeComponent[] = [
  {
    id: 'c-milk',
    sortOrder: 0,
    section: null,
    note: null,
    quantity: { value: 1, unit: 'l' },
    ref: { kind: 'ingredient', ingredientId: 'i-milk' },
    displayName: 'Whole milk',
  },
  {
    id: 'c-base',
    sortOrder: 1,
    section: null,
    note: null,
    quantity: { value: 200, unit: 'g' },
    ref: { kind: 'recipe', recipeId: 'r-base' },
    displayName: 'Custard base',
  },
];

/** Custard as written, scaled to double. */
const expanded = {
  recipe: { id: 'r-custard', components: before },
  factor: 2,
  allergens: { contains: ['eggs', 'milk'], mayContain: [] },
  lines: [
    line(0, 'ingredient', 'i-milk', 'Whole milk', 2000, 'ml'),
    line(0, 'recipe', 'r-base', 'Custard base', 400, 'g'),
    line(1, 'ingredient', 'i-yolk', 'Egg yolks', 240, 'g'),
  ],
} as unknown as ExpandedRecipe;

function cache() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['ingredients', ''], [{ id: 'i-sugar', name: 'Caster sugar' }]);
  queryClient.setQueryData(['recipes', {}], [{ id: 'r-base', name: 'Custard base' }]);
  queryClient.setQueryData(['recipe-expanded', 'r-custard', {}], expanded);
  queryClient.setQueryData(
    ['dishes'],
    [{ id: 'd-tart', name: 'Pear tart', course: 'dessert', status: 'published' }],
  );
  return queryClient;
}

describe('an offline edit to what goes in', () => {
  it('names new ingredients from what the device knows, and keeps sub-recipes in proportion', () => {
    const queryClient = cache();
    const next = componentsAsSent(
      [
        {
          sortOrder: 1,
          quantity: { value: 300, unit: 'g' },
          ref: { kind: 'recipe', recipeId: 'r-base' },
        },
        {
          sortOrder: 0,
          quantity: { value: 80, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: 'i-sugar' },
        },
      ],
      before,
      knownNames(queryClient, before),
    );
    expect(next.map((c) => c.displayName)).toEqual(['Caster sugar', 'Custard base']);
    expect(next[1]!.id).toBe('c-base');

    const lines = linesAsSent(expanded, next);
    expect(lines.map((l) => [l.depth, l.name, l.quantity.value])).toEqual([
      [0, 'Caster sugar', 160],
      [0, 'Custard base', 600],
      // 300 g of base instead of 200 g: half as much again.
      [1, 'Egg yolks', 360],
    ]);
  });

  it('shows a sub-recipe entered in another unit by itself, rather than guessing', () => {
    const next = componentsAsSent(
      [
        {
          sortOrder: 0,
          quantity: { value: 1, unit: 'kg' },
          ref: { kind: 'recipe', recipeId: 'r-base' },
        },
      ],
      before,
      new Map(),
    );
    expect(linesAsSent(expanded, next).map((l) => l.name)).toEqual(['Custard base']);
  });
});

describe('a dish put on a menu offline', () => {
  it('shows from what the device knows of it, in course order', () => {
    const queryClient = cache();
    const tart = menuDishAsSent(queryClient, 'd-tart')!;
    expect(tart).toMatchObject({ name: 'Pear tart', course: 'dessert' });
    expect(menuDishAsSent(queryClient, 'unknown')).toBeNull();
    const starter = { ...tart, recipeId: 'd-soup', name: 'Soup', course: 'starter' as const };
    expect(inCourseOrder([tart, starter]).map((d) => d.name)).toEqual(['Soup', 'Pear tart']);
  });
});

describe('what waits on a change made offline', () => {
  const entry = (path: string, body: unknown): OutboxEntry => ({
    id: path,
    userId: 'u',
    method: 'PATCH',
    path,
    body,
    label: { key: 'x' },
    queuedAt: 0,
  });

  it('is the recipe changed, and everything that uses it', () => {
    const queryClient = cache();
    const base = waitingOn([entry('/recipes/r-base', { components: [] })]);
    expect(recipeAwaits(queryClient, base, 'r-base')).toBe(true);
    expect(recipeAwaits(queryClient, base, 'r-custard')).toBe(true);

    const yolks = waitingOn([entry('/ingredients/i-yolk', { allergens: ['eggs'] })]);
    expect(recipeAwaits(queryClient, yolks, 'r-custard')).toBe(true);
  });

  it('is nothing for a change that does not touch allergens', () => {
    const queryClient = cache();
    const renamed = waitingOn([
      entry('/recipes/r-base', { name: 'Base' }),
      entry('/ingredients/i-yolk', { name: 'Yolks' }),
    ]);
    expect(recipeAwaits(queryClient, renamed, 'r-custard')).toBe(false);
  });
});
