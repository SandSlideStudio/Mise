import { describe, expect, it } from 'vitest';
import { explodeService, groupByStation } from './explode.js';
import { book, cyclicBook, STATION, taskFor } from './fixtures.js';
import { unwrap } from './result.js';

/**
 * Twenty chicken pies and eight fricassées. Both dishes take the same velouté,
 * so the whole point of the exercise is that velouté appears once.
 */
const tonight = [
  { recipeId: 'r-pie', portions: 20 },
  { recipeId: 'r-fricassee', portions: 8 },
];

describe('explodeService', () => {
  it('generates a task for every sub-recipe and every ingredient needing prep', () => {
    const tasks = unwrap(explodeService(tonight, book));
    expect(tasks.map((t) => t.sourceId).sort()).toEqual([
      'i-carrot',
      'i-onion',
      'i-tarragon',
      'r-stock',
      'r-veloute',
    ]);
  });

  it('aggregates a shared sub-recipe into a single summed task', () => {
    const tasks = unwrap(explodeService(tonight, book));
    const veloute = taskFor(tasks, 'r-veloute');

    // 20 pies is twice the base recipe, so 1000 ml, plus 400 ml for 8 fricassées.
    expect(veloute.quantity.value).toBeCloseTo(1400);
    expect(veloute.quantity.unit).toBe('ml');
    expect(veloute.usedBy.map((u) => u.recipeId).sort()).toEqual(['r-fricassee', 'r-pie']);
  });

  it('scales a third-level sub-recipe to the combined figure above it', () => {
    const tasks = unwrap(explodeService(tonight, book));
    // 1400 ml of velouté is 1.4 batches, and each batch takes 800 ml of stock.
    expect(taskFor(tasks, 'r-stock').quantity.value).toBeCloseTo(1120);
  });

  it('grosses ingredient quantities up for trim loss', () => {
    const tasks = unwrap(explodeService(tonight, book));
    // 1120 ml of stock is 0.56 batches, so 112 g of peeled onion. At a 90 per
    // cent yield that means pulling about 124 g from the walk-in.
    expect(taskFor(tasks, 'i-onion').quantity.value).toBeCloseTo(124.44, 1);
    // Carrot trims harder at 80 per cent: 84 g peeled needs 105 g bought.
    expect(taskFor(tasks, 'i-carrot').quantity.value).toBeCloseTo(105, 1);
  });

  it('skips ingredients that need no preparation', () => {
    const tasks = unwrap(explodeService(tonight, book));
    // Flour and butter get weighed, not prepped.
    expect(tasks.find((t) => t.sourceId === 'i-flour')).toBeUndefined();
    expect(tasks.find((t) => t.sourceId === 'i-butter')).toBeUndefined();
  });

  it('makes a task out of an ingredient carrying a prep note', () => {
    const tasks = unwrap(explodeService(tonight, book));
    expect(taskFor(tasks, 'i-tarragon').notes).toContain('picked');
  });

  it('orders the deepest work first, so the stock is on before the sauce', () => {
    const tasks = unwrap(explodeService(tonight, book));
    const order = tasks.map((t) => t.sourceId);
    expect(order.indexOf('i-onion')).toBeLessThan(order.indexOf('r-stock'));
    expect(order.indexOf('r-stock')).toBeLessThan(order.indexOf('r-veloute'));
  });

  it('carries the station through from the recipe', () => {
    const tasks = unwrap(explodeService(tonight, book));
    expect(taskFor(tasks, 'r-veloute').stationId).toBe(STATION.sauce);
    expect(taskFor(tasks, 'r-stock').stationId).toBe(STATION.larder);
  });

  it('gives every task a key stable enough to regenerate against', () => {
    const first = unwrap(explodeService(tonight, book));
    const second = unwrap(explodeService(tonight, book));
    expect(first.map((t) => t.key)).toEqual(second.map((t) => t.key));
    expect(taskFor(first, 'r-veloute').key).toBe('recipe:r-veloute:ml');
  });

  it('scales linearly with covers', () => {
    const half = unwrap(explodeService([{ recipeId: 'r-pie', portions: 10 }], book));
    const full = unwrap(explodeService([{ recipeId: 'r-pie', portions: 20 }], book));
    expect(taskFor(full, 'r-stock').quantity.value).toBeCloseTo(
      taskFor(half, 'r-stock').quantity.value * 2,
    );
  });
});

describe('explodeService failures', () => {
  it('refuses to walk a cyclic book rather than running forever', () => {
    const r = explodeService(tonight, cyclicBook());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('cycle');
  });

  it('reports a dish that is not in the book', () => {
    const r = explodeService([{ recipeId: 'r-nope', portions: 4 }], book);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('missing_recipe');
  });

  it('reports a dish with no portion count', () => {
    const r = explodeService([{ recipeId: 'r-stock', portions: 4 }], book);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('no_portions');
  });
});

describe('groupByStation', () => {
  it('splits the list into one bucket per station', () => {
    const tasks = unwrap(explodeService(tonight, book));
    const groups = groupByStation(tasks);
    expect(groups.get(STATION.sauce)?.map((t) => t.sourceId)).toEqual(['r-veloute']);
    expect(groups.get(STATION.larder)?.map((t) => t.sourceId)).toEqual(['r-stock']);
    // Ingredient prep has no station of its own yet.
    expect(groups.get(null)?.length).toBe(3);
  });
});
