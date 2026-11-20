// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { AddFromChecklist, ChecklistItem, PrepTask, Station } from '@mise/contracts';
import { groupChecklist, newItemId } from './checklist.js';
import { applyWaiting, isWaitingChecklistLine } from './running.js';
import { WAITING, type OutboxEntry } from '../lib/outbox.js';
import { createTranslator } from '../i18n/index.js';
import { addedNote, parNote } from '../components/PrepTaskRow.js';

/** The checklist offline: lines show as waiting, the way the server will make them. */

const HOT = 'hot';
const items: ChecklistItem[] = [
  { id: 'i-stock', stationId: HOT, name: 'Chicken stock', recipeId: 'r-stock' },
  { id: 'i-slaw', stationId: 'cold', name: 'Slaw', recipeId: null },
  { id: 'i-mop', stationId: null, name: 'Chicken stock', recipeId: null },
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

describe('items with a par ticked while Mise could not be reached', () => {
  const translator = createTranslator('en');
  const withPar: ChecklistItem[] = [
    { id: 'i-gel', stationId: HOT, name: 'Fig gel', recipeId: null, par: { value: 3, unit: 'l' } },
    {
      id: 'i-eggs',
      stationId: HOT,
      name: 'Eggs',
      recipeId: null,
      par: { value: 40, unit: 'each' },
    },
  ];
  const counted = (onHand: AddFromChecklist['onHand']): OutboxEntry => ({
    ...entry(['i-gel', 'i-eggs']),
    body: { ids: ['i-gel', 'i-eggs'], onHand },
  });

  it('show what is short of the par, and why, the way the server will', () => {
    const list = applyWaiting([], counted({ 'i-gel': { value: 1200, unit: 'ml' } }), {
      me: null,
      items: withPar,
    });
    expect(list.map((l) => [l.description, l.quantity])).toEqual([
      ['Fig gel', { value: 1.8, unit: 'l' }],
      ['Eggs', { value: 40, unit: 'each' }],
    ]);
    expect(parNote(translator, list[0]!)).toBe('Par 3 l, 1.2 l there');
    expect(parNote(translator, list[1]!)).toBe('Par 40, none there');
  });

  it('leave out what there is enough of', () => {
    const list = applyWaiting([], counted({ 'i-eggs': { value: 48, unit: 'each' } }), {
      me: null,
      items: withPar,
    });
    expect(list.map((l) => l.description)).toEqual(['Fig gel']);
  });

  it('say nothing about a par on a line without one', () => {
    expect(parNote(translator, line({ quantity: { value: 2000, unit: 'ml' } }))).toBeNull();
  });
});
