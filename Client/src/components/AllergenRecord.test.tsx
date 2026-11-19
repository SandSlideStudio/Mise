// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AllergenChange } from '@mise/contracts';
import { AllergenRecordView, diffAllergens } from './AllergenRecord.js';

/** A dish's allergen record: the date it last changed, and each change as what came and went. */

afterEach(cleanup);

let counter = 0;
const entry = (over: Partial<AllergenChange>): AllergenChange => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  changedAt: '2026-11-01T09:00:00.000Z',
  contains: [],
  mayContain: [],
  cause: null,
  changedBy: null,
  ...over,
});

// Newest first, as the server sends it.
const history = [
  entry({
    changedAt: '2026-11-12T15:30:00.000Z',
    contains: ['milk', 'nuts'],
    mayContain: ['sesame'],
    cause: 'Praline',
    changedBy: 'Ana',
  }),
  entry({ changedAt: '2026-11-05T10:00:00.000Z', contains: ['milk'], mayContain: ['nuts'] }),
  entry({ changedAt: '2026-11-01T09:00:00.000Z', contains: ['milk', 'gluten'] }),
];

describe('the allergen record', () => {
  it('tells what was added and what was taken away', () => {
    expect(diffAllergens(history[1]!, history[0]!)).toEqual({
      added: ['nuts'],
      removed: [],
      mayAdded: ['sesame'],
      mayRemoved: ['nuts'],
    });
    expect(diffAllergens(history[2]!, history[1]!)).toMatchObject({ removed: ['gluten'] });
  });

  it('dates the last change and lists each one under History', () => {
    render(<AllergenRecordView history={history} />);
    expect(screen.getByText('Allergens last changed on 12 November 2026')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
    expect(screen.getByText(/^Now contains: /)).toBeTruthy();
    // Sesame on the latest; nuts a week before, as a trace first.
    expect(screen.getAllByText(/^Now may contain: /)).toHaveLength(2);
    expect(screen.getByText(/^No longer “may contain”: /)).toBeTruthy();
    expect(screen.getByText(/After a change to Praline · By Ana/)).toBeTruthy();
    expect(screen.getByText(/Changed on the dish itself/)).toBeTruthy();
    expect(screen.getByText(/^No longer contains: /)).toBeTruthy();
    // Where the record starts: everything the dish had then.
    expect(screen.getByText(/First recorded/)).toBeTruthy();
    expect(screen.getByText(/^Contains: /)).toBeTruthy();
  });

  it('says a first entry with nothing in it has no allergens', () => {
    render(<AllergenRecordView history={[entry({})]} />);
    expect(screen.getByText('No allergens')).toBeTruthy();
  });
});
