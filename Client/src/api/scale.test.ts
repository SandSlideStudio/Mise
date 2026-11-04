import { describe, expect, it } from 'vitest';
import type { ExpandedRecipe } from '@mise/contracts';
import { scaleOnDevice } from './recipes.js';

/** Vanilla custard as written: makes 1 l, 8 portions. */
const written = {
  recipe: {
    id: 'r-custard',
    name: 'Vanilla custard',
    type: 'prep',
    yield: { value: 1, unit: 'l' },
    portions: 8,
  },
  factor: 1,
  allergens: { contains: ['eggs', 'milk'], mayContain: [] },
  lines: [
    {
      depth: 0,
      kind: 'ingredient',
      sourceId: 'i-milk',
      name: 'Whole milk',
      section: null,
      note: null,
      quantity: { value: 1000, unit: 'ml' },
    },
    {
      depth: 0,
      kind: 'recipe',
      sourceId: 'r-base',
      name: 'Custard base',
      section: null,
      note: null,
      quantity: { value: 200, unit: 'g' },
    },
    {
      depth: 1,
      kind: 'ingredient',
      sourceId: 'i-yolk',
      name: 'Egg yolks',
      section: null,
      note: null,
      quantity: { value: 160, unit: 'g' },
    },
  ],
} as unknown as ExpandedRecipe;

const amounts = (expanded: ExpandedRecipe | null) =>
  expanded?.lines.map((line) => line.quantity.value);

describe('working a size out on the tablet', () => {
  it('scales every line, sub-recipe contents too, to the amount asked for', () => {
    const twoLitres = scaleOnDevice(written, { yieldValue: 2000, yieldUnit: 'ml' });
    expect(twoLitres?.factor).toBe(2);
    expect(amounts(twoLitres)).toEqual([2000, 400, 320]);
  });

  it('takes the amount in another unit of the same kind', () => {
    expect(amounts(scaleOnDevice(written, { yieldValue: 0.5, yieldUnit: 'l' }))).toEqual([
      500, 100, 80,
    ]);
  });

  it('scales by portions and by batches', () => {
    expect(amounts(scaleOnDevice(written, { portions: 4 }))).toEqual([500, 100, 80]);
    expect(amounts(scaleOnDevice(written, { factor: 3 }))).toEqual([3000, 600, 480]);
  });

  it('gives up where the server would refuse, rather than guess', () => {
    // Kilos of something that makes litres: no density to go by.
    expect(scaleOnDevice(written, { yieldValue: 2, yieldUnit: 'kg' })).toBeNull();
    expect(
      scaleOnDevice({ ...written, recipe: { ...written.recipe, portions: null } }, { portions: 4 }),
    ).toBeNull();
  });
});
