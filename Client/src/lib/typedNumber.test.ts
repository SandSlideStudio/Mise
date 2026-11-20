import { describe, expect, it } from 'vitest';
import { createTranslator } from '../i18n/index.js';
import { numberText, problemText, readNumber } from './typedNumber.js';

const value = (text: string, rules = {}) => readNumber(text, rules).value;
const problem = (text: string, rules = {}) => readNumber(text, rules).problem?.kind ?? null;

describe('reading a number as a kitchen types it', () => {
  it('takes a comma or a point as the decimals', () => {
    expect(value('9,80')).toBe(9.8);
    expect(value('9.80')).toBe(9.8);
    expect(value(',5')).toBe(0.5);
    expect(value('2.')).toBe(2);
    expect(value('400')).toBe(400);
  });

  it('reads one separator as the decimals, never as thousands', () => {
    // "1.250" could be a thousand and a quarter or one and a quarter: asked,
    // never guessed, or a price is a thousand times off. "0,250" can't be.
    expect(value('1.250')).toBeNull();
    expect(value('1,250')).toBeNull();
    expect(problem('12.500')).toBe('ambiguous');
    expect(value('0,250')).toBe(0.25);
    expect(value('1,25')).toBe(1.25);
    expect(value('1.2500')).toBe(1.25);
  });

  it('lets spaces and a currency sign go', () => {
    expect(value(' 2 ')).toBe(2);
    expect(value('€ 9,80')).toBe(9.8);
    expect(value('€9.80')).toBe(9.8);
    expect(value('9,80 €')).toBe(9.8);
    expect(value('£12')).toBe(12);
  });

  it('takes a percent sign only where a percentage is asked', () => {
    expect(value('9 %', { percent: true })).toBe(9);
    expect(value('5,5%', { percent: true })).toBe(5.5);
    expect(problem('9%')).toBe('notNumber');
  });

  it('is nothing when empty, which the field decides is allowed or not', () => {
    expect(readNumber('')).toEqual({ value: null, problem: null });
    expect(readNumber('   ')).toEqual({ value: null, problem: null });
    expect(readNumber('€')).toEqual({ value: null, problem: null });
  });

  it('refuses thousands written out, rather than guess which is which', () => {
    expect(problem('1.250,5')).toBe('grouped');
    expect(problem('1,250.5')).toBe('grouped');
    expect(problem('1.250.000')).toBe('grouped');
    expect(problem('1 250')).toBe('grouped');
    expect(value('1.250,5')).toBeNull();
  });

  it('refuses what is not a number at all', () => {
    expect(problem('1,5e3')).toBe('notNumber');
    expect(problem('1e3')).toBe('notNumber');
    expect(problem('abc')).toBe('notNumber');
    expect(problem('-')).toBe('notNumber');
    expect(problem(',')).toBe('notNumber');
    expect(problem('Infinity')).toBe('notNumber');
    expect(problem('0x10')).toBe('notNumber');
    expect(problem('9,80 kg')).toBe('notNumber');
  });

  it('holds the box to its limits', () => {
    expect(problem('-1', { min: 0 })).toBe('atLeast');
    expect(problem('0', { above: 0 })).toBe('moreThan');
    expect(value('0', { min: 0 })).toBe(0);
    expect(problem('101', { max: 100 })).toBe('atMost');
    expect(value('100', { max: 100 })).toBe(100);
    expect(problem('2,5', { integer: true })).toBe('whole');
    expect(value('25', { integer: true })).toBe(25);
  });
});

describe('writing a number back', () => {
  it('writes it the way the reader does, without thousands', () => {
    expect(numberText(9.8, 'nl-NL')).toBe('9,8');
    expect(numberText(9.8, 'en-GB')).toBe('9.8');
    expect(numberText(1250.5, 'de-DE')).toBe('1250,5');
    expect(numberText(null, 'nl-NL')).toBe('');
    expect(numberText(undefined, 'nl-NL')).toBe('');
  });

  it('writes a price with its cents', () => {
    expect(numberText(9.8, 'nl-NL', { money: true })).toBe('9,80');
    expect(numberText(12, 'nl-NL', { money: true })).toBe('12');
  });

  it('reads back what it wrote, in every language', () => {
    for (const locale of ['en-GB', 'nl-NL', 'de-DE', 'fr-FR', 'es-ES']) {
      for (const n of [0, 0.5, 9.8, 1250.5, 12345.678]) {
        expect(value(numberText(n, locale))).toBe(n);
      }
    }
  });
});

describe('saying what is wrong', () => {
  it('shows the example in the reader’s own way of writing', () => {
    expect(problemText(createTranslator('nl'), { kind: 'notNumber' })).toBe(
      'Geen getal. Schrijf het zoals 9,8.',
    );
    expect(problemText(createTranslator('en'), { kind: 'atMost', max: 100 })).toBe('At most 100.');
  });
});
