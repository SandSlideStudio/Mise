// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { factorText } from './RecipeView.js';

/** "How many times the written recipe", as the line above the recipe says it. */
describe('the scale of a recipe opened at an amount', () => {
  it('keeps a small part of a big batch from reading as nothing', () => {
    expect(factorText('en-GB', 0.002)).toBe('0.002');
    expect(factorText('en-GB', 0.333)).toBe('0.33');
  });

  it('writes a larger one to two decimals, in the reader’s own decimals', () => {
    expect(factorText('en-GB', 2.5)).toBe('2.5');
    expect(factorText('nl-NL', 1.256)).toBe('1,26');
  });
});
