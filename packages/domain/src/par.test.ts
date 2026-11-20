import { describe, expect, it } from 'vitest';
import { parBelowBatch, toMakeForPar } from './par.js';
import { qty } from './units.js';

describe('what to make to reach a par', () => {
  it('asks for the par less what is there', () => {
    expect(toMakeForPar(qty(3, 'l'), qty(1, 'l'))).toEqual({
      kind: 'make',
      make: qty(2, 'l'),
      par: qty(3, 'l'),
      onHand: qty(1, 'l'),
    });
  });

  it('asks for the whole par when nobody said what is there', () => {
    expect(toMakeForPar(qty(40, 'each'), null)).toMatchObject({
      kind: 'make',
      make: qty(40, 'each'),
      onHand: qty(0, 'each'),
    });
  });

  it('counts what is there in another unit of the same kind', () => {
    // 3 l less 1200 ml is 1.8 l.
    expect(toMakeForPar(qty(3, 'l'), qty(1200, 'ml'))).toMatchObject({
      kind: 'make',
      make: qty(1.8, 'l'),
    });
    // 2 kg less 1.75 kg reads as grams, the way a chef would write it.
    expect(toMakeForPar(qty(2, 'kg'), qty(1750, 'g'))).toMatchObject({
      kind: 'make',
      make: qty(250, 'g'),
    });
  });

  it('rounds the shortfall up, so there is never a little too little', () => {
    expect(toMakeForPar(qty(3, 'l'), qty(1.234, 'l'))).toMatchObject({ make: qty(1.77, 'l') });
    // Half a piece counted is one more piece to make.
    expect(toMakeForPar(qty(40, 'each'), qty(12.5, 'each'))).toMatchObject({
      make: qty(28, 'each'),
    });
    expect(toMakeForPar(qty(2, 'dozen'), qty(5, 'each'))).toMatchObject({
      make: qty(19, 'each'),
    });
  });

  it('asks for nothing when there is enough, or more', () => {
    expect(toMakeForPar(qty(3, 'l'), qty(3, 'l')).kind).toBe('enough');
    expect(toMakeForPar(qty(3, 'l'), qty(3000, 'ml')).kind).toBe('enough');
    expect(toMakeForPar(qty(3, 'l'), qty(5, 'l')).kind).toBe('enough');
  });

  it('guesses nothing when what is there can’t be compared with the par', () => {
    expect(toMakeForPar(qty(3, 'l'), qty(500, 'g'))).toEqual({
      kind: 'unknown',
      par: qty(3, 'l'),
    });
  });
});

describe('a par smaller than one batch', () => {
  it('is pointed out, with the bigger unit it was likely meant in', () => {
    expect(parBelowBatch(qty(1, 'ml'), qty(500, 'ml'))).toEqual({ meant: qty(1, 'l') });
    expect(parBelowBatch(qty(2, 'g'), qty(1.5, 'kg'))).toEqual({ meant: qty(2, 'kg') });
  });

  it('is pointed out without a guess when the bigger unit would still be too little', () => {
    expect(parBelowBatch(qty(0.2, 'ml'), qty(500, 'ml'))).toEqual({ meant: null });
    expect(parBelowBatch(qty(0.5, 'l'), qty(2, 'l'))).toEqual({ meant: null });
    expect(parBelowBatch(qty(4, 'each'), qty(10, 'each'))).toEqual({ meant: null });
  });

  it('says nothing about a batch or more, or about units that do not compare', () => {
    expect(parBelowBatch(qty(500, 'ml'), qty(0.5, 'l'))).toBeNull();
    expect(parBelowBatch(qty(3, 'l'), qty(500, 'ml'))).toBeNull();
    expect(parBelowBatch(qty(1, 'g'), qty(500, 'ml'))).toBeNull();
    expect(parBelowBatch(qty(0, 'ml'), qty(500, 'ml'))).toBeNull();
  });
});
