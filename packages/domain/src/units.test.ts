import { describe, expect, it } from 'vitest';
import { convert, fromBase, qty, toBase, unitsForDimension } from './units.js';

describe('conversion within a dimension', () => {
  it('converts mass without any ingredient context', () => {
    const r = convert(qty(1.5, 'kg'), 'g');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(1500);
  });

  it('converts volume without any ingredient context', () => {
    const r = convert(qty(2, 'l'), 'ml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(2000);
  });

  it('converts between metric and imperial mass', () => {
    const r = convert(qty(1, 'lb'), 'g');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(453.59237, 4);
  });

  it('converts tablespoons to millilitres', () => {
    const r = convert(qty(3, 'tbsp'), 'ml');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(44.36, 2);
  });
});

describe('conversion across dimensions', () => {
  it('converts volume to weight when a density is known', () => {
    // Rapeseed oil, 0.92 g per ml.
    const r = convert(qty(1, 'l'), 'g', { densityGPerMl: 0.92 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(920);
  });

  it('converts weight to volume when a density is known', () => {
    const r = convert(qty(920, 'g'), 'ml', { densityGPerMl: 0.92 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(1000);
  });

  it('refuses volume to weight without a density rather than assuming water', () => {
    const r = convert(qty(1, 'l'), 'g');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('missing_density');
  });

  it('converts a count to weight using the item weight', () => {
    const r = convert(qty(6, 'each'), 'g', { itemWeightG: 50 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(300);
  });

  it('refuses count to weight without an item weight', () => {
    const r = convert(qty(6, 'each'), 'g');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('missing_item_weight');
  });

  it('derives an item volume from item weight and density', () => {
    // One 50 g egg at 1.03 g per ml is a little under 50 ml.
    const r = convert(qty(2, 'each'), 'ml', { itemWeightG: 50, densityGPerMl: 1.03 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.value).toBeCloseTo(97.09, 1);
  });
});

describe('base unit round trips', () => {
  it('survives a round trip through the base unit', () => {
    for (const def of unitsForDimension('volume')) {
      const original = qty(7, def.code);
      const back = fromBase(toBase(original), def.code);
      expect(back.value).toBeCloseTo(7, 9);
    }
  });
});
