// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createTranslator } from '../i18n/index.js';
import { PrepLabel, shortName, useByNote, type LabelContent } from './PrepLabel.js';

/** What a label on a container of prep says, on the smallest roll and the largest. */

afterEach(cleanup);

const made = new Date(2027, 3, 5, 14, 30); // Monday 5 April 2027, 14:30 on the tablet

const figGel: LabelContent = {
  name: 'Fig gel',
  made,
  by: 'Marco Rossi',
  kitchenName: 'Brasserie Noord',
  recipe: { shelfLifeHours: null, kept: 'chilled_7', storage: 'Koelcel' },
  allergens: { contains: ['milk', 'gluten'], mayContain: ['nuts'] },
};

function text(container: HTMLElement) {
  return container.textContent ?? '';
}

describe('a label on the smallest roll', () => {
  it('keeps what matters at the fridge door, and leaves the rest off', () => {
    const { container } = render(<PrepLabel label={figGel} size="54x25" />);
    const label = container.querySelector('article')!;
    expect(label.dataset.tier).toBe('small');
    expect(label.style.width).toBe('54mm');
    expect(label.style.height).toBe('25mm');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Fig gel');
    // The default for chilled prep: made Monday, good until Wednesday.
    expect(screen.getByTestId('use-by').textContent).toMatch(/Wed.*7 Apr/);
    expect(text(container)).toMatch(/Made Mon.*5 Apr 14:30/);
    expect(text(container)).toContain('Marco R.');
    expect(text(container)).toContain('Contains: Milk, Gluten');
    expect(text(container)).toContain('May contain: Tree nuts');
    // Room for none of these at 25 mm.
    expect(text(container)).not.toContain('Brasserie Noord');
    expect(text(container)).not.toContain('Chilled');
  });

  it('uses the larger type set for small rolls', () => {
    const { container } = render(<PrepLabel label={figGel} size="54x25" />);
    const label = container.querySelector('article')!;
    expect(label.style.fontSize).toBe('7.5pt');
    expect(screen.getByRole('heading', { level: 2 }).getAttribute('style')).toContain('11pt');
  });

  it('grows that type to fill a taller small roll', () => {
    const { container } = render(<PrepLabel label={figGel} size="62x29" />);
    const label = container.querySelector('article')!;
    expect(label.style.fontSize).toBe('8.7pt');
    expect(screen.getByRole('heading', { level: 2 }).getAttribute('style')).toContain('12.8pt');
  });

  it('prints black on white only', () => {
    const { container } = render(<PrepLabel label={figGel} size="54x25" />);
    const label = container.querySelector('article')!;
    expect(label.className).toContain('text-black');
    expect(label.className).toContain('bg-white');
    expect(container.innerHTML).not.toMatch(/text-(ink|accent|brand|danger)|bg-(ink|accent)/);
  });
});

describe('how it is kept', () => {
  it('goes by the choice on the recipe, whatever the note says', () => {
    const { container } = render(
      <PrepLabel
        label={{
          ...figGel,
          recipe: { shelfLifeHours: null, kept: 'chilled_4', storage: 'Labelled tubs' },
        }}
        size="89x36"
      />,
    );
    // A day more at 4 °C, though the note says nothing about it.
    expect(screen.getByTestId('use-by').textContent).toMatch(/Thu.*8 Apr/);
    expect(text(container)).toContain('Chilled ≤4 °C · Labelled tubs');
  });

  it('gives a date to chilled prep that has no storage note at all', () => {
    render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: null, kept: 'chilled_7', storage: null } }}
        size="54x25"
      />,
    );
    expect(screen.getByTestId('use-by').textContent).toMatch(/Wed.*7 Apr/);
  });

  it('still reads the note on a recipe nobody has chosen for', () => {
    const { container } = render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: null, kept: null, storage: 'Fridge, 3 °C' } }}
        size="89x36"
      />,
    );
    expect(screen.getByTestId('use-by').textContent).toMatch(/Thu.*8 Apr/);
    // What the note says, once.
    expect(text(container)).toContain('Chilled ≤4 °C');
    expect(text(container)).not.toContain('Fridge');
  });
});

describe('a label on a larger roll', () => {
  it('also says how it is kept and in which kitchen', () => {
    const { container } = render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: null, storage: 'Fridge, 3 °C' } }}
        size="89x36"
      />,
    );
    expect(container.querySelector('article')!.dataset.tier).toBe('medium');
    expect(text(container)).toContain('Chilled ≤4 °C');
    expect(text(container)).toContain('Brasserie Noord');
    // A day more at 4 °C.
    expect(screen.getByTestId('use-by').textContent).toMatch(/Thu.*8 Apr/);
  });

  it("prints the recipe's own shelf life with the time it ends", () => {
    render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: 12, storage: 'Koelcel' } }}
        size="102x51"
      />,
    );
    expect(screen.getByTestId('use-by').textContent).toMatch(/Tue.*6 Apr 02:30/);
  });

  it('prints the time with a shelf life of days too, not only the day it ends', () => {
    render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: 48, storage: 'Koelcel' } }}
        size="102x51"
      />,
    );
    expect(screen.getByTestId('use-by').textContent).toMatch(/Wed.*7 Apr 14:30/);
  });
});

describe('a label with something missing', () => {
  it('leaves lines to write on for a line not made from a recipe', () => {
    const { container } = render(
      <PrepLabel
        label={{ ...figGel, name: 'Pickled shallots', recipe: null, allergens: null }}
        size="54x25"
      />,
    );
    expect(screen.queryByTestId('use-by')).toBeNull();
    expect(text(container)).toContain('Use by');
    expect(text(container)).toContain('Allergens');
    // Two lines to write on: the use-by and the allergens.
    expect(container.querySelectorAll('span[aria-hidden].border-b-\\[0\\.6pt\\]')).toHaveLength(2);
    expect(text(container)).toContain('Marco R.');
  });

  it('leaves the use-by to write on for frozen stock without a shelf life', () => {
    render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: null, kept: 'frozen', storage: null } }}
        size="62x29"
      />,
    );
    expect(screen.queryByTestId('use-by')).toBeNull();
  });

  it('leaves the use-by to write on for food kept hot, which goes by the hour', () => {
    const { container } = render(
      <PrepLabel
        label={{ ...figGel, recipe: { shelfLifeHours: null, kept: 'hot', storage: 'Bain-marie' } }}
        size="89x36"
      />,
    );
    expect(screen.queryByTestId('use-by')).toBeNull();
    expect(text(container)).toContain('Kept hot ≥60 °C · Bain-marie');
  });

  it('leaves a line for who made it when nobody is known', () => {
    const { container } = render(<PrepLabel label={{ ...figGel, by: null }} size="62x29" />);
    expect(text(container)).toContain('By');
    expect(container.querySelectorAll('span[aria-hidden].border-b-\\[0\\.6pt\\]')).toHaveLength(1);
  });

  it('says so when there are no allergens at all, rather than leaving it blank', () => {
    const { container } = render(
      <PrepLabel label={{ ...figGel, allergens: { contains: [], mayContain: [] } }} size="54x25" />,
    );
    expect(text(container)).toContain('None of the 14 allergens');
  });
});

describe('what the person printing is told', () => {
  const { t } = createTranslator('en');

  it('that the date is the default, and how to change it', () => {
    expect(useByNote(t, figGel)).toMatch(/Hygiënecode default.*plus 2 days.*shelf life/);
  });

  it('nothing when the recipe has its own shelf life', () => {
    expect(useByNote(t, { ...figGel, recipe: { shelfLifeHours: 72, storage: null } })).toBeNull();
  });

  it('why there is no date to print', () => {
    expect(
      useByNote(t, { ...figGel, recipe: { shelfLifeHours: null, kept: 'hot', storage: null } }),
    ).toMatch(/kept hot.*hours/);
    expect(
      useByNote(t, { ...figGel, recipe: { shelfLifeHours: null, kept: null, storage: null } }),
    ).toMatch(/nor how it is kept/);
    expect(
      useByNote(t, { ...figGel, recipe: { shelfLifeHours: null, storage: 'Freezer' } }),
    ).toMatch(/frozen/);
    expect(
      useByNote(t, { ...figGel, recipe: { shelfLifeHours: null, storage: 'Dry store' } }),
    ).toMatch(/dry/);
    expect(useByNote(t, { ...figGel, recipe: { shelfLifeHours: null, storage: null } })).toMatch(
      /neither/,
    );
    expect(useByNote(t, { ...figGel, recipe: null })).toMatch(/Not made from a recipe/);
  });
});

describe('who made it, briefly', () => {
  it('is a first name and an initial', () => {
    expect(shortName('Marco Rossi')).toBe('Marco R.');
    expect(shortName('Anne-Marie van den Berg')).toBe('Anne-Marie B.');
    expect(shortName('Kim')).toBe('Kim');
    expect(shortName('  ')).toBe('');
  });
});
