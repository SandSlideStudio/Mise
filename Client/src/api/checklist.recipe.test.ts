// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@mise/contracts';
import { applyWaiting } from './running.js';
import type { OutboxEntry } from '../lib/outbox.js';

/** A checklist line linked to a recipe, ticked while Mise can't be reached. */

const items: ChecklistItem[] = [
  { id: 'i-gel', stationId: 'hot', name: 'Fig gel', recipeId: 'r-gel' },
  { id: 'i-jus', stationId: 'hot', name: 'Jus', recipeId: null },
];

const entry: OutboxEntry = {
  id: 'abc123',
  userId: 'u1',
  method: 'POST',
  path: '/checklist/add',
  body: { ids: ['i-gel', 'i-jus'] },
  label: { key: 'offline.label.checklistAdd' },
  queuedAt: 0,
};

describe('a waiting line from the checklist', () => {
  it('carries the recipe link, so it shows the Recipe link before it is sent', () => {
    const list = applyWaiting([], entry, { me: 'Marco', items });
    expect(list.map((l) => [l.description, l.recipeId])).toEqual([
      ['Fig gel', 'r-gel'],
      ['Jus', null],
    ]);
  });
});
