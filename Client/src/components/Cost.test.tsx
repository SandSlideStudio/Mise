// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { RecipeCost } from '@mise/contracts';
import { createTranslator } from '../i18n/index.js';
import {
  CostGaps,
  DishCost,
  formatMoney,
  ingredientPriceText,
  MenuCostSummary,
  MenuDishCostText,
  perUnitText,
  priceAge,
  readableUnit,
  RecipeCostLine,
} from './Cost.js';

/**
 * Food cost on screen: in the kitchen's currency and the reader's language,
 * per kilo rather than per gram, and never a low number without saying what
 * it leaves out.
 */

afterEach(cleanup);
const en = createTranslator('en');
const nl = createTranslator('nl');
// Intl puts a narrow no-break space in some languages; compare on plain spaces.
const plain = (text: string | null | undefined) => (text ?? '').replace(/[\u00a0\u202f]/g, ' ');

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sauce: RecipeCost = {
  currency: 'EUR',
  total: 4.2,
  perBase: 0.00084,
  perPortion: null,
  foodCostPercent: null,
  gaps: [],
};

describe('money and units', () => {
  it('formats in the kitchen’s currency and the reader’s language', () => {
    expect(plain(formatMoney(en.locale, 'EUR', 12.5))).toBe('€12.50');
    expect(plain(formatMoney(nl.locale, 'EUR', 12.5))).toBe('€ 12,50');
    expect(plain(formatMoney(en.locale, 'GBP', 3))).toBe('£3.00');
  });

  it('shows a cost per gram per kilo, per millilitre per litre, and per piece each', () => {
    expect(readableUnit('g')).toBe('kg');
    expect(readableUnit('cl')).toBe('l');
    expect(readableUnit('lb')).toBe('lb');
    expect(plain(perUnitText(en, 'EUR', 0.0025, 'g'))).toBe('€2.50 per kg');
    expect(plain(perUnitText(nl, 'EUR', 0.0032, 'ml'))).toBe('€ 3,20 per l');
    expect(plain(perUnitText(en, 'EUR', 0.3, 'each'))).toBe('€0.30 each');
  });
});

describe('how old a price is', () => {
  const now = new Date('2026-11-19T12:00:00Z');

  it('says nothing for a price from the last six months', () => {
    expect(priceAge(en, '2026-06-01T09:00:00Z', now)).toBeNull();
    expect(priceAge(en, null, now)).toBeNull();
  });

  it('says how old an older one is, gently', () => {
    expect(priceAge(en, '2026-03-10T09:00:00Z', now)).toBe('price from 8 months ago');
    expect(priceAge(nl, '2026-03-10T09:00:00Z', now)).toBe('prijs van 8 maanden geleden');
    expect(priceAge(en, '2025-01-10T09:00:00Z', now)).toBe('price from 1 year ago');
  });

  it('puts it next to the price per unit in the ingredient list', () => {
    const price = {
      amount: 12.5,
      quantity: { value: 5, unit: 'kg' as const },
      updatedAt: '2026-03-10T09:00:00Z',
      perBase: 0.0025,
    };
    expect(plain(ingredientPriceText(en, 'EUR', price, 'g', now))).toBe(
      '€2.50 per kg · price from 8 months ago',
    );
    expect(ingredientPriceText(en, 'EUR', { ...price, perBase: null }, 'g', now)).toMatch(
      /can’t convert/,
    );
  });
});

describe('what a cost leaves out', () => {
  it('names the ingredients without a price and the amounts it can’t convert', () => {
    render(
      <CostGaps
        gaps={[
          { kind: 'ingredient', id: ID(1), name: 'Water', reason: 'no_price' },
          { kind: 'ingredient', id: ID(2), name: 'Salt', reason: 'no_price' },
          { kind: 'recipe', id: ID(3), name: 'Sauce', reason: 'units' },
        ]}
      />,
    );
    const note = screen.getByRole('note');
    expect(note.textContent).toContain('Cost so far');
    expect(note.textContent).toContain('2 ingredients without a price: Water, Salt');
    expect(note.textContent).toContain('1 amount that can’t be converted');
  });

  it('says nothing when nothing is left out', () => {
    const { container } = render(<CostGaps gaps={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('the cost on a recipe', () => {
  it('gives the cost per batch and per unit of what it makes', () => {
    render(<RecipeCostLine cost={sauce} yieldUnit="l" scaled={false} />);
    expect(screen.getByRole('heading', { name: 'Food cost' })).toBeTruthy();
    expect(plain(screen.getByText(/per batch/).textContent)).toBe('€4.20 per batch · €0.84 per l');
  });

  it('follows the scaler', () => {
    render(<RecipeCostLine cost={{ ...sauce, total: 8.4 }} yieldUnit="l" scaled />);
    expect(plain(screen.getByText(/for this size/).textContent)).toBe(
      '€8.40 for this size · €0.84 per l',
    );
  });

  it('gives a dish made in plates its cost per portion instead of per piece', () => {
    render(
      <RecipeCostLine
        cost={{ ...sauce, total: 3, perBase: 3, perPortion: 3 }}
        yieldUnit="each"
        scaled={false}
      />,
    );
    expect(plain(screen.getByText(/per batch/).textContent)).toBe(
      '€3.00 per batch · €3.00 per portion',
    );
  });
});

describe('the cost of a dish', () => {
  const dish: RecipeCost = {
    currency: 'EUR',
    total: 3.2,
    perBase: 3.2,
    perPortion: 3.2,
    foodCostPercent: 14.53,
    gaps: [{ kind: 'ingredient', id: ID(1), name: 'Saffron', reason: 'no_price' }],
  };

  it('shows the cost per portion, the selling price and the food cost %', () => {
    render(<DishCost cost={dish} sellPrice={24} />);
    expect(plain(screen.getByText('€3.20').textContent)).toBe('€3.20');
    expect(screen.getByText('€24.00')).toBeTruthy();
    expect(screen.getByText('14.5%')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('1 ingredient without a price: Saffron');
  });

  it('says when there is no selling price yet, and leaves out the food cost', () => {
    render(<DishCost cost={{ ...dish, foodCostPercent: null, gaps: [] }} sellPrice={null} />);
    expect(screen.getByText('No selling price yet')).toBeTruthy();
    expect(screen.queryByText('Food cost %')).toBeNull();
  });
});

describe('the cost of a menu', () => {
  it('gives each dish its cost per portion and food cost, and marks an incomplete one', () => {
    render(
      <MenuDishCostText
        cost={{ perPortion: 2.1, sellPrice: 9.5, foodCostPercent: 24.1, gaps: 1 }}
        currency="EUR"
      />,
    );
    expect(plain(screen.getByText(/per portion/).textContent)).toMatch(
      /^€2\.10 per portion · food cost 24\.1%/,
    );
    expect(screen.getByText('Cost so far')).toBeTruthy();
  });

  it('gives the menu’s averages, and says when they are too low', () => {
    render(
      <MenuCostSummary
        cost={{
          currency: 'EUR',
          averagePerPortion: 2.5,
          averageFoodCostPercent: 26,
          incomplete: true,
        }}
      />,
    );
    expect(plain(screen.getByText(/Menu average/).textContent)).toBe(
      'Menu average: €2.50 per portion · food cost 26%',
    );
    expect(screen.getByRole('note').textContent).toMatch(/too low/);
  });
});
