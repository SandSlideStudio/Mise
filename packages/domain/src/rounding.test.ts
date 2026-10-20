import { describe, expect, it } from 'vitest';
import { formatQuantity, humanize, roundForKitchen } from './rounding.js';
import { qty } from './units.js';

describe('roundForKitchen', () => {
  it('rounds counts up, because you cannot prep part of a shallot', () => {
    expect(roundForKitchen(qty(2.4, 'each')).value).toBe(3);
    expect(roundForKitchen(qty(2.01, 'each')).value).toBe(3);
  });

  it('leaves a whole count alone', () => {
    expect(roundForKitchen(qty(3, 'each')).value).toBe(3);
  });

  it('rounds bulk grams to the nearest gram', () => {
    expect(roundForKitchen(qty(1483.33, 'g')).value).toBe(1483);
  });

  it('keeps a tenth of a gram for small weights, where cures and spices live', () => {
    expect(roundForKitchen(qty(4.27, 'g')).value).toBe(4.3);
  });

  it('rounds kilos to two decimals', () => {
    expect(roundForKitchen(qty(1.48333, 'kg')).value).toBe(1.48);
  });

  it('rounds spoons to the nearest quarter, matching real measuring spoons', () => {
    expect(roundForKitchen(qty(1.6, 'tsp')).value).toBe(1.5);
    expect(roundForKitchen(qty(1.7, 'tsp')).value).toBe(1.75);
  });
});

describe('humanize', () => {
  it('promotes bulk grams to kilos', () => {
    expect(humanize(qty(1500, 'g'))).toEqual({ value: 1.5, unit: 'kg' });
  });

  it('demotes a fraction of a kilo to grams', () => {
    expect(humanize(qty(0.4, 'kg'))).toEqual({ value: 400, unit: 'g' });
  });

  it('promotes bulk millilitres to litres', () => {
    expect(humanize(qty(2500, 'ml'))).toEqual({ value: 2.5, unit: 'l' });
  });

  it('keeps an imperial kitchen in imperial units', () => {
    expect(humanize(qty(32, 'oz')).unit).toBe('lb');
  });
});

describe('formatQuantity', () => {
  it('trims trailing zeros', () => {
    expect(formatQuantity(qty(1.5, 'kg'))).toBe('1.5 kg');
  });

  it('prints a bare number for counts', () => {
    expect(formatQuantity(qty(12, 'each'))).toBe('12');
  });
});

describe('small imperial amounts', () => {
  it('stay in teaspoons below a tablespoon', () => {
    expect(humanize(qty(0.25, 'tsp'))).toEqual(qty(0.25, 'tsp'));
    expect(humanize(qty(0.5, 'tsp'))).toEqual(qty(0.5, 'tsp'));
    expect(humanize(qty(1, 'tsp'))).toEqual(qty(1, 'tsp'));
  });

  it('move up to tablespoons from one tablespoon', () => {
    expect(humanize(qty(3, 'tsp'))).toEqual(qty(1, 'tbsp'));
  });
});

describe('rounding a tiny amount', () => {
  it('never rounds it away to nothing', () => {
    expect(roundForKitchen(qty(0.04, 'g')).value).toBe(0.1);
    expect(roundForKitchen(qty(0.1, 'tsp')).value).toBe(0.25);
  });

  it('still rounds nothing to nothing', () => {
    expect(roundForKitchen(qty(0, 'g')).value).toBe(0);
  });
});
