// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AllergenNotice } from './AllergenNotice.js';

/** What the notice for guests says, and in which languages. */

afterEach(cleanup);

describe('the allergen notice', () => {
  it('asks in the kitchen’s language first, then in English, under the kitchen’s name', () => {
    const { container } = render(<AllergenNotice kitchenName="De Kas" language="nl" />);
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Allergieën of intoleranties?',
      'Allergies or intolerances?',
    ]);
    expect(screen.getByText(/Vraag het onze medewerkers/)).toBeTruthy();
    expect(
      screen.getByText('Ask our staff. We can tell you exactly which allergens are in every dish.'),
    ).toBeTruthy();
    // Each part says which language it is in, for a screen reader.
    const parts = [...container.querySelectorAll('[lang]')].map((el) => el.getAttribute('lang'));
    expect(parts).toEqual(['nl', 'en']);
    expect(screen.getByText('De Kas')).toBeTruthy();
  });

  it('says it once for an English kitchen', () => {
    render(<AllergenNotice kitchenName="The Pass" language="en" />);
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getByRole('article').getAttribute('aria-label')).toBe('Allergen notice');
  });

  it('speaks to the guest as each language does', () => {
    render(<AllergenNotice kitchenName="K" language="fr" />);
    expect(screen.getByText(/Nous pouvons vous dire/)).toBeTruthy();
    cleanup();
    render(<AllergenNotice kitchenName="K" language="es" />);
    expect(screen.getByText(/Podemos decirte/)).toBeTruthy();
  });
});
