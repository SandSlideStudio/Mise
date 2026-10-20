import { describe, expect, it } from 'vitest';
import { book, cyclicBook } from './fixtures.js';
import {
  factorForPortions,
  factorForYield,
  findCycle,
  rollUpAllergens,
  scaleRecipe,
  wouldCreateCycle,
} from './recipe.js';
import { unwrap } from './result.js';
import { qty } from './units.js';

const pie = book.recipe('r-pie')!;
const stock = book.recipe('r-stock')!;

describe('scaling', () => {
  it('finds the factor for a target portion count', () => {
    expect(unwrap(factorForPortions(pie, 25))).toBeCloseTo(2.5);
  });

  it('refuses to scale by portions when a recipe has none', () => {
    const r = factorForPortions(stock, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_portions');
  });

  it('finds the factor for a target yield', () => {
    // The stock recipe makes 2 litres; we want 5.
    expect(unwrap(factorForYield(stock, qty(5, 'l')))).toBeCloseTo(2.5);
  });

  it('multiplies every component when scaling', () => {
    const doubled = scaleRecipe(stock, 2);
    expect(doubled.yield.value).toBe(4000);
    expect(doubled.components[0]!.quantity.value).toBe(4000);
    expect(doubled.components[3]!.quantity.value).toBe(6000);
  });
});

describe('cycle detection', () => {
  it('reports no cycle in a sound book', () => {
    expect(findCycle('r-pie', book)).toBeNull();
  });

  it('finds a cycle once a stock contains the sauce that uses it', () => {
    const cycle = findCycle('r-veloute', cyclicBook());
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('r-stock');
    expect(cycle).toContain('r-veloute');
  });

  it('rejects a component that would close a loop, before it is written', () => {
    expect(wouldCreateCycle('r-stock', 'r-veloute', book)).toBe(true);
  });

  it('rejects a recipe containing itself', () => {
    expect(wouldCreateCycle('r-stock', 'r-stock', book)).toBe(true);
  });

  it('allows a component that does not close a loop', () => {
    expect(wouldCreateCycle('r-pie', 'r-stock', book)).toBe(false);
  });
});

describe('allergen roll-up', () => {
  it('pulls allergens up through two levels of sub-recipe', () => {
    // The pie declares nothing. Gluten and milk arrive via its own flour and
    // butter, and again from the velouté underneath it.
    const profile = unwrap(rollUpAllergens('r-pie', book));
    expect(profile.contains).toEqual(['gluten', 'milk']);
  });

  it('finds allergens that exist only in a nested sub-recipe', () => {
    // The fricassée itself is only velouté and tarragon.
    const profile = unwrap(rollUpAllergens('r-fricassee', book));
    expect(profile.contains).toEqual(['gluten', 'milk']);
  });

  it('reports a clean recipe as clean', () => {
    const profile = unwrap(rollUpAllergens('r-stock', book));
    expect(profile.contains).toEqual([]);
  });

  it('keeps a may-contain warning separate from a certainty', () => {
    const declared = {
      ...stock,
      mayContain: ['celery' as const],
    };
    const localBook = {
      recipe: (id: string) => (id === 'r-stock' ? declared : book.recipe(id)),
      ingredient: book.ingredient,
    };
    const profile = unwrap(rollUpAllergens('r-stock', localBook));
    expect(profile.contains).toEqual([]);
    expect(profile.mayContain).toEqual(['celery']);
  });
});
