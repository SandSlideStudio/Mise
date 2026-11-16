// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ChecklistItem, PrepTask, Station } from '@mise/contracts';
import { groupChecklist, newItemId } from './checklist.js';
import { applyWaiting, isWaitingChecklistLine } from './running.js';
import { WAITING, type OutboxEntry } from '../lib/outbox.js';
import { createTranslator } from '../i18n/index.js';
import { addedNote } from '../components/PrepTaskRow.js';

/** The checklist offline: lines show as waiting, the way the server will make them. */

const HOT = 'hot';
const items: ChecklistItem[] = [
  { id: 'i-stock', stationId: HOT, name: 'Chicken stock' },
  { id: 'i-slaw', stationId: 'cold', name: 'Slaw' },
  { id: 'i-mop', stationId: null, name: 'Chicken stock' },
];

const entry = (ids: string[]): OutboxEntry => ({
  id: 'abc123',
  userId: 'u1',
  method: 'POST',
  path: '/checklist/add',
  body: { ids },
  label: { key: 'offline.label.checklistAdd' },
  queuedAt: 0,
});

const line = (over: Partial<PrepTask>): PrepTask => ({
  id: 'l1',
  stationId: HOT,
  recipeId: null,
  description: 'x',
  quantity: null,
  status: 'open',
  assignedUserId: null,
  assignedUserName: null,
  completedByName: null,
  completedAt: null,
  sortOrder: 0,
  createdByName: null,
  fromChecklist: false,
  ...over,
});

describe('items ticked while Mise could not be reached', () => {
  it('show on the list as waiting, from the checklist, in the signed-in person’s name', () => {
    const list = applyWaiting([], entry(['i-stock', 'i-slaw']), { me: 'Marco', items });
    expect(list.map((l) => l.description)).toEqual(['Chicken stock', 'Slaw']);
    expect(list[0]).toMatchObject({
      id: `${WAITING}abc123:i-stock`,
      stationId: HOT,
      status: 'open',
      createdByName: 'Marco',
      fromChecklist: true,
    });
    expect(list.every((l) => isWaitingChecklistLine(l.id))).toBe(true);
  });

  it('leaves out what is already open on that station, ignoring capitals and spaces', () => {
    const there = line({ description: '  chicken STOCK ' });
    const list = applyWaiting([there], entry(['i-stock', 'i-mop']), { me: 'Marco', items });
    // Same station: skipped. No station: a different line.
    expect(list.map((l) => l.id)).toEqual(['l1', `${WAITING}abc123:i-mop`]);
  });

  it('adds again when the earlier line is already ticked off', () => {
    const done = line({ description: 'Chicken stock', status: 'done' });
    expect(applyWaiting([done], entry(['i-stock']), { me: null, items })).toHaveLength(2);
  });

  it('is not mistaken for a line typed in while waiting', () => {
    expect(isWaitingChecklistLine(`${WAITING}abc123`)).toBe(false);
    expect(isWaitingChecklistLine('real-id')).toBe(false);
  });
});

describe('who added a line', () => {
  const { t } = createTranslator('en');
  it('says it quietly, and says nothing when nobody is known', () => {
    expect(addedNote(t, line({ createdByName: 'Marco' }))).toBe('Added by Marco');
    expect(addedNote(t, line({ createdByName: 'Marco', fromChecklist: true }))).toBe(
      'From the checklist, by Marco',
    );
    expect(addedNote(t, line({ fromChecklist: true }))).toBe('From the checklist');
    expect(addedNote(t, line({}))).toBeNull();
  });
});

describe('the checklist as drawn', () => {
  const stations = [
    { id: HOT, name: 'Hot' },
    { id: 'cold', name: 'Cold' },
  ] as Station[];

  it('groups by station in the kitchen’s order, with no station last', () => {
    const groups = groupChecklist(items, [...stations].reverse());
    expect(groups.map((g) => g.station?.name ?? null)).toEqual(['Cold', 'Hot', null]);
  });

  it('makes ids the server accepts', () => {
    expect(newItemId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
