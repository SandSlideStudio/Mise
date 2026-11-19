import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { PrepTask, SessionUser } from '@mise/contracts';
import { markReachable, markUnreachable } from '../lib/connectivity.js';
import { labelForLine, labelSettingsOf } from './labels.js';

/** A label prints from what the tablet already has, with Mise out of reach. */

afterEach(() => markReachable());

const user = {
  id: 'u1',
  displayName: 'Sam Okafor',
  kitchenName: 'De Kas',
  labels: { size: '89x36', onTick: true },
} as SessionUser;

const line = (overrides: Partial<PrepTask> = {}): PrepTask => ({
  id: 't1',
  stationId: null,
  recipeId: 'r1',
  description: 'Fig gel',
  quantity: null,
  status: 'done',
  assignedUserId: null,
  assignedUserName: null,
  completedByName: 'Marco Rossi',
  completedAt: '2027-04-05T12:30:00.000Z',
  sortOrder: 0,
  createdByName: null,
  fromChecklist: false,
  ...overrides,
});

describe('a label for a ticked line', () => {
  it('takes the recipe and its allergens from what was loaded ahead, offline', async () => {
    markUnreachable();
    const queryClient = new QueryClient();
    queryClient.setQueryData(['recipe', 'r1'], {
      id: 'r1',
      shelfLifeHours: 72,
      kept: 'chilled_4',
      storage: 'Koelcel',
    });
    queryClient.setQueryData(['recipe-allergens', 'r1'], { contains: ['milk'], mayContain: [] });

    const label = await labelForLine(queryClient, line(), user);
    expect(label).toEqual({
      name: 'Fig gel',
      made: new Date('2027-04-05T12:30:00.000Z'),
      by: 'Marco Rossi',
      kitchenName: 'De Kas',
      recipe: { shelfLifeHours: 72, kept: 'chilled_4', storage: 'Koelcel' },
      allergens: { contains: ['milk'], mayContain: [] },
    });
  });

  it('finds them in the expanded recipe too', async () => {
    markUnreachable();
    const queryClient = new QueryClient();
    // Saved by an older version, before a recipe said how it is kept: the
    // label then reads the storage note.
    queryClient.setQueryData(['recipe-expanded', 'r1', {}], {
      recipe: { id: 'r1', shelfLifeHours: null, storage: 'Freezer' },
      allergens: { contains: [], mayContain: ['sesame'] },
    });
    const label = await labelForLine(queryClient, line(), user);
    expect(label.recipe).toEqual({ shelfLifeHours: null, storage: 'Freezer' });
    expect(label.allergens).toEqual({ contains: [], mayContain: ['sesame'] });
  });

  it('prints blanks rather than wait when it has never seen the recipe', async () => {
    markUnreachable();
    const label = await labelForLine(new QueryClient(), line(), user);
    expect(label.recipe).toBeNull();
    expect(label.allergens).toBeNull();
  });

  it('is made now, by whoever is here, while the tick is still waiting to be sent', async () => {
    const before = Date.now();
    const label = await labelForLine(
      new QueryClient(),
      line({ recipeId: null, completedAt: null, completedByName: null }),
      user,
    );
    expect(label.made.getTime()).toBeGreaterThanOrEqual(before);
    expect(label.by).toBe('Sam Okafor');
    expect(label.recipe).toBeNull();
  });
});

describe('the label settings', () => {
  it('come with whoever is signed in, and fall back on the small roll', () => {
    expect(labelSettingsOf(user)).toEqual({ size: '89x36', onTick: true });
    expect(labelSettingsOf(null)).toEqual({ size: '62x29', onTick: false });
  });
});
