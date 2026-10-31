import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES, type DishCard, type DishCardTheme } from '@mise/contracts';
import { createTranslator } from '../../i18n/index.js';
import { marksOnPage, sampleCard, sampleOverview, testFonts, type Mark } from '../../test/cards.js';
import type { CardFonts } from './fonts.js';
import { layoutDishCard } from './layout.js';
import { layoutMenuOverview } from './menuLayout.js';

/**
 * The allergen table is the part of a card someone's health depends on. These
 * read every mark back off the drawn page and check it sits in the row and
 * column the recipe says, in every language and both looks.
 */

let fonts: CardFonts;
beforeAll(async () => {
  fonts = await testFonts();
});

const printedAt = new Date('2026-10-31T12:00:00Z');

/** What the table should say, straight from the card's data. */
function expected(card: DishCard, otherName: string, mayContain = true) {
  const table = new Map<string, Map<string, Mark>>();
  const rows = [
    ...card.rows.map((row) => ({ name: row.name, facts: row })),
    ...(card.other ? [{ name: otherName, facts: card.other }] : []),
  ];
  for (const row of rows) {
    const cells = new Map<string, Mark>();
    for (const a of row.facts.contains) cells.set(a, 'X');
    if (mayContain) for (const a of row.facts.mayContain) if (!cells.has(a)) cells.set(a, '(X)');
    if (cells.size > 0) table.set(row.name, cells);
  }
  return table;
}

function rowNamesOf(card: DishCard, otherName: string) {
  return [...card.rows.map((row) => row.name), otherName];
}

describe('the back of a dish card', () => {
  for (const language of LANGUAGES) {
    for (const theme of ['day', 'night'] as DishCardTheme[]) {
      it(`puts every mark in the right row and column (${language}, ${theme})`, () => {
        const card = sampleCard();
        const pages = layoutDishCard(card, fonts, {
          language,
          kitchenLanguage: 'en',
          theme,
          printedAt,
        });
        expect(pages).toHaveLength(2);
        const other = createTranslator(language).t('card.other');
        expect(marksOnPage(pages[1]!, rowNamesOf(card, other))).toEqual(expected(card, other));
      });
    }
  }

  it('leaves the may-contain marks off when the kitchen hides them', () => {
    const card = sampleCard();
    card.settings.hidden = ['mayContain'];
    const pages = layoutDishCard(card, fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    const other = createTranslator('en').t('card.other');
    expect(marksOnPage(pages[1]!, rowNamesOf(card, other))).toEqual(expected(card, other, false));
  });

  it('keeps its table right for a dish with a very long name', () => {
    const card = sampleCard();
    card.dish.name =
      'Slow roast pork belly, crackling, burnt apple, celeriac, mustard seeds and a sharp cider sauce';
    const pages = layoutDishCard(card, fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    const other = createTranslator('en').t('card.other');
    expect(marksOnPage(pages[1]!, rowNamesOf(card, other))).toEqual(expected(card, other));
  });
});

describe('the front of a dish card', () => {
  it('says the whole dish contains every allergen of its parts, and nothing else', () => {
    const card = sampleCard();
    const pages = layoutDishCard(card, fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    const chips = pages[0]!.ops
      .filter((op) => op.kind === 'icon')
      .map((op) => (op.kind === 'icon' ? op.icon : null));
    expect(new Set(chips)).toEqual(
      new Set(['eggs', 'gluten', 'milk', 'nuts', 'sulphites', 'peanuts']),
    );
  });
});

describe('the allergen overview of a menu', () => {
  it('fits a short menu on one page, every dish in its row', () => {
    const overview = sampleOverview(6);
    const pages = layoutMenuOverview(overview, fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    expect(pages).toHaveLength(1);
    const names = overview.dishes.map((dish) => dish.name);
    const marks = marksOnPage(pages[0]!, names);
    for (const dish of overview.dishes) {
      expect(marks.get(dish.name)).toEqual(new Map(dish.contains.map((a) => [a, 'X'])));
    }
  });

  it('runs a long menu onto more pages without losing or repeating a dish', () => {
    const overview = sampleOverview(48);
    const pages = layoutMenuOverview(overview, fonts, {
      language: 'nl',
      kitchenLanguage: 'en',
      theme: 'night',
      printedAt,
    });
    expect(pages.length).toBeGreaterThan(1);
    const names = overview.dishes.map((dish) => dish.name);
    const seen = new Map<string, number>();
    for (const page of pages) {
      for (const [name, cells] of marksOnPage(page, names)) {
        seen.set(name, (seen.get(name) ?? 0) + 1);
        const dish = overview.dishes.find((d) => d.name === name)!;
        expect(cells).toEqual(new Map(dish.contains.map((a) => [a, 'X'])));
      }
    }
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    expect(seen.size).toBe(overview.dishes.length);
  });
});
