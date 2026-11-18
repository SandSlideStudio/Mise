// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChecklistItem, Station } from '@mise/contracts';
import { ChecklistPrint } from './ChecklistPrint.js';

/** What the checklist prints: a box per line, by station, with the kitchen and the day. */

afterEach(cleanup);

const stations = [
  { id: 'hot', name: 'Hot' },
  { id: 'cold', name: 'Cold' },
] as Station[];

const items: ChecklistItem[] = [
  { id: '1', stationId: 'cold', name: 'Slaw', recipeId: null },
  { id: '2', stationId: 'hot', name: 'Chicken stock', recipeId: 'r1' },
  { id: '3', stationId: 'hot', name: 'Jus', recipeId: null },
  { id: '4', stationId: null, name: 'Mop', recipeId: null },
];

describe('the printed checklist', () => {
  it('names the kitchen and the day', () => {
    render(
      <ChecklistPrint
        kitchenName="Brasserie Noord"
        items={items}
        stations={stations}
        date={new Date(2026, 10, 18)}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Prep checklist');
    expect(screen.getByText(/Brasserie Noord · .*18/)).toBeTruthy();
  });

  it('groups the lines by station, anywhere last, each with a box to tick', () => {
    const { container } = render(
      <ChecklistPrint kitchenName="K" items={items} stations={stations} />,
    );
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Hot', 'Cold', 'Anywhere']);
    const lines = [...container.querySelectorAll('section p')].map((p) => p.textContent);
    expect(lines).toEqual(['Chicken stock', 'Jus', 'Slaw', 'Mop']);
    expect(container.querySelectorAll('section p > span[aria-hidden]')).toHaveLength(4);
  });

  it('says so when there is nothing on the checklist', () => {
    render(<ChecklistPrint kitchenName="K" items={[]} stations={stations} />);
    expect(screen.getByText('The checklist is empty.')).toBeTruthy();
  });
});
