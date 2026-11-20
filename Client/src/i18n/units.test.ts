import { describe, expect, it } from 'vitest';
import { createTranslator, errorMessage, quantityText, unitLabel, unitName } from './index.js';
import { RequestFailed } from '../api/client.js';

describe('units in the reader’s language', () => {
  const nl = createTranslator('nl');
  const de = createTranslator('de');
  const fr = createTranslator('fr');
  const es = createTranslator('es');
  const en = createTranslator('en');

  it('name each unit in a list to choose from, metric symbols as they are', () => {
    expect(
      (['each', 'dozen', 'tsp', 'tbsp', 'cup', 'g', 'l'] as const).map((u) => unitName(nl.t, u)),
    ).toEqual(['stuk', 'dozijn', 'tl', 'el', 'kopje', 'g', 'l']);
    expect(unitName(de.t, 'each')).toBe('Stück');
    expect(unitName(de.t, 'tbsp')).toBe('EL');
    expect(unitName(fr.t, 'each')).toBe('pièce');
    expect(unitName(es.t, 'each')).toBe('unidad');
    // English keeps what it always showed.
    expect(unitName(en.t, 'each')).toBe('each');
    expect(unitName(en.t, 'floz')).toBe('floz');
  });

  it('say an amount in the reader’s words, singular or plural by it', () => {
    expect(quantityText(nl, { value: 1, unit: 'cup' })).toBe('1 kopje');
    expect(quantityText(nl, { value: 2, unit: 'cup' })).toBe('2 kopjes');
    expect(quantityText(nl, { value: 1.5, unit: 'tbsp' })).toBe('1,5 el');
    expect(quantityText(nl, { value: 2, unit: 'dozen' })).toBe('2 dozijn');
    expect(quantityText(de, { value: 2, unit: 'cup' })).toBe('2 Tassen');
    expect(quantityText(de, { value: 3, unit: 'tsp' })).toBe('3 TL');
    expect(quantityText(fr, { value: 1, unit: 'dozen' })).toBe('1 douzaine');
    expect(quantityText(fr, { value: 2, unit: 'dozen' })).toBe('2 douzaines');
    // French keeps the singular below two: "1,5 tasse".
    expect(quantityText(fr, { value: 1.5, unit: 'cup' })).toBe('1,5 tasse');
    expect(quantityText(fr, { value: 2, unit: 'tbsp' })).toBe('2 c. à s.');
    expect(quantityText(es, { value: 1, unit: 'cup' })).toBe('1 taza');
    expect(quantityText(es, { value: 2, unit: 'cup' })).toBe('2 tazas');
    expect(quantityText(es, { value: 2, unit: 'tsp' })).toBe('2 cdta.');
    expect(quantityText(es, { value: 2, unit: 'tbsp' })).toBe('2 cda.');
    expect(quantityText(nl, { value: 1.5, unit: 'kg' })).toBe('1,5 kg');
    expect(quantityText(en, { value: 2, unit: 'dozen' })).toBe('2 dz');
    // A count stays a bare number in every language.
    expect(quantityText(nl, { value: 40, unit: 'each' })).toBe('40');
  });

  it('put a counted unit beside an empty box in the plural', () => {
    expect(unitLabel(nl, 'each')).toBe('stuks');
    expect(unitLabel(fr, 'each')).toBe('pièces');
    expect(unitLabel(es, 'each')).toBe('unidades');
    expect(unitLabel(de, 'each')).toBe('Stück');
    expect(unitLabel(nl, 'each', 1)).toBe('stuk');
    expect(unitLabel(en, 'each')).toBe('ea');
    expect(unitLabel(nl, 'ml')).toBe('ml');
  });

  it('name the units in a refused change of what a recipe makes', () => {
    const error = new RequestFailed(
      409,
      {
        error: {
          code: 'incompatible_units',
          message: 'Units',
          details: { child: 'Vinaigrette', unit: 'tbsp', makes: 'each' },
        },
      },
      'Units',
    );
    expect(errorMessage(nl, error)).toMatch(/^Vinaigrette levert stuk op, .* in el worden/);
  });
});
