import { describe, expect, it } from 'vitest';
import { expandRecipe, factorFor } from './expand.js';
import { book, cyclicBook } from './fixtures.js';
import { unwrap } from './result.js';
import { qty } from './units.js';

describe('expandRecipe', () => {
  it('lists the recipe’s own lines at depth zero', () => {
    const lines = unwrap(expandRecipe('r-stock', 1, book));
    expect(lines.filter((l) => l.depth === 0).map((l) => l.name)).toEqual([
      'Chicken bones',
      'Onion',
      'Carrot',
      'Water',
    ]);
  });

  it('keeps the order the recipe was written in', () => {
    const lines = unwrap(expandRecipe('r-veloute', 1, book));
    expect(lines[0]?.name).toBe('Chicken stock');
    // The stock's own contents follow it, nested.
    expect(lines[1]?.depth).toBe(1);
  });

  it('nests a sub-recipe’s contents beneath it', () => {
    const lines = unwrap(expandRecipe('r-veloute', 1, book));
    const stockLine = lines.find((l) => l.name === 'Chicken stock');
    expect(stockLine).toMatchObject({ depth: 0, kind: 'recipe' });

    // 800 ml of a 2 l batch is 0.4 batches, so 0.4 of every line beneath it.
    const onion = lines.find((l) => l.name === 'Onion');
    expect(onion?.depth).toBe(1);
    expect(onion?.quantity.value).toBeCloseTo(80);
  });

  it('scales every level when the factor changes', () => {
    const single = unwrap(expandRecipe('r-veloute', 1, book));
    const double = unwrap(expandRecipe('r-veloute', 2, book));

    for (const [index, line] of single.entries()) {
      expect(double[index]?.quantity.value).toBeCloseTo(line.quantity.value * 2);
    }
  });

  it('reports quantities in base units, so the client can choose how to show them', () => {
    const lines = unwrap(expandRecipe('r-veloute', 1, book));
    const stock = lines.find((l) => l.name === 'Chicken stock');
    // Written as 800 ml, and millilitres are already the base unit for volume.
    expect(stock?.quantity).toEqual({ value: 800, unit: 'ml' });
  });

  it('carries the note through, because that is half the instruction', () => {
    const lines = unwrap(expandRecipe('r-stock', 1, book));
    expect(lines.find((l) => l.name === 'Onion')?.note).toBe('roughly chopped');
  });

  it('refuses a cyclic book rather than running forever', () => {
    const result = expandRecipe('r-veloute', 1, cyclicBook());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('cycle');
  });

  it('reports a recipe that is not in the book', () => {
    const result = expandRecipe('r-nope', 1, book);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('missing_recipe');
  });
});

describe('factorFor', () => {
  it('works out the multiplier from a portion count', () => {
    // The pie is written for 10 and we want 25.
    expect(unwrap(factorFor('r-pie', { portions: 25 }, book))).toBeCloseTo(2.5);
  });

  it('works out the multiplier from a target yield', () => {
    // The stock makes 2 litres and we want 5.
    expect(unwrap(factorFor('r-stock', { yield: qty(5, 'l') }, book))).toBeCloseTo(2.5);
  });

  it('takes an explicit factor as given', () => {
    expect(unwrap(factorFor('r-stock', { factor: 3 }, book))).toBe(3);
  });

  it('defaults to one batch', () => {
    expect(unwrap(factorFor('r-stock', {}, book))).toBe(1);
  });

  it('refuses to scale by portions a recipe that has none', () => {
    const result = factorFor('r-stock', { portions: 10 }, book);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('no_portions');
  });
});

/** The whole point of scaling: twenty-five covers instead of ten. */
describe('scaling a dish to a service', () => {
  it('scales three levels down to the right quantities', () => {
    const factor = unwrap(factorFor('r-pie', { portions: 25 }, book));
    const lines = unwrap(expandRecipe('r-pie', factor, book));

    // 25 pies is 2.5 batches, so 1250 ml of velouté.
    expect(lines.find((l) => l.name === 'Chicken velouté')?.quantity.value).toBeCloseTo(1250);
    // That is 1.25 batches of velouté, each taking 800 ml of stock.
    expect(lines.find((l) => l.name === 'Chicken stock')?.quantity.value).toBeCloseTo(1000);
    // And 1000 ml of stock is half a batch, so half its 200 g of onion.
    expect(lines.find((l) => l.name === 'Onion')?.quantity.value).toBeCloseTo(100);
  });
});
