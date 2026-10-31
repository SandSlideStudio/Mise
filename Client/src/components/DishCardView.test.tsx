// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DISH_CARD_ALLERGEN_ORDER } from '@mise/domain';
import { createTranslator, cardAllergenName } from '../i18n/index.js';
import { sampleCard } from '../test/cards.js';
import { DishCardView } from './DishCardView.js';

/**
 * The card on screen has to say exactly what the printed card says: the same
 * marks in the same cells, and nothing the kitchen has switched off.
 */

afterEach(cleanup);
const { t } = createTranslator('en');

function cellsOf(table: HTMLElement) {
  const headers = within(table).getAllByRole('columnheader').slice(1);
  const columns = headers.map((th) => th.textContent ?? '');
  const result = new Map<string, Map<string, string>>();
  for (const row of within(table).getAllByRole('row').slice(1)) {
    const [nameCell, ...cells] = [...row.querySelectorAll('th, td')];
    const marks = new Map<string, string>();
    cells.forEach((cell, i) => {
      const mark = cell.textContent?.trim();
      if (mark === 'X' || mark === '(X)') marks.set(columns[i]!, mark);
    });
    result.set(nameCell!.textContent ?? '', marks);
  }
  return result;
}

describe('the dish card on screen', () => {
  it('marks every allergen in the same row and column as the card data', () => {
    const card = sampleCard();
    render(<DishCardView card={card} />);
    const table = screen.getByRole('table');
    const label = (a: string) => cardAllergenName(t, a);
    const expected = new Map<string, Map<string, string>>();
    const rows = [
      ...card.rows.map((r) => ({ name: r.name, f: r })),
      { name: t('card.other'), f: card.other! },
    ];
    for (const row of rows) {
      const marks = new Map<string, string>();
      for (const a of DISH_CARD_ALLERGEN_ORDER) {
        if (row.f.contains.includes(a)) marks.set(label(a), 'X');
        else if (row.f.mayContain.includes(a)) marks.set(label(a), '(X)');
      }
      expected.set(row.name, marks);
    }
    expect(cellsOf(table)).toEqual(expected);
  });

  it('shows the dish, its menu, components, pairings and cutlery', () => {
    render(<DishCardView card={sampleCard()} />);
    expect(screen.getAllByText('Pear tart, hazelnut praline').length).toBeGreaterThan(0);
    expect(screen.getByText('Autumn menu')).toBeTruthy();
    expect(screen.getByText('Late harvest riesling')).toBeTruthy();
    expect(screen.getByText('Dessert spoon')).toBeTruthy();
    expect(screen.getAllByText('Hazelnut praline').length).toBeGreaterThan(0);
  });

  it('leaves out every part the kitchen has switched off', () => {
    const card = sampleCard();
    card.settings.hidden = ['drinks', 'cutlery', 'menu', 'mayContain'];
    render(<DishCardView card={card} />);
    expect(screen.queryByText('Late harvest riesling')).toBeNull();
    expect(screen.queryByText('Dessert spoon')).toBeNull();
    expect(screen.queryByText('Autumn menu')).toBeNull();
    expect(screen.queryByText('(X)')).toBeNull();
  });
});
