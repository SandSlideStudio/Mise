import { describe, expect, it } from 'vitest';
import type { PersonData } from '@mise/contracts';
import { createTranslator } from '../i18n/index.js';
import { readablePersonData } from './personData.js';

const data: PersonData = {
  exportedAt: '2026-11-18T10:00:00.000Z',
  kitchen: 'De Kas',
  person: {
    id: '00000000-0000-4000-8000-000000000002',
    displayName: 'Marco',
    email: null,
    role: 'cook',
    station: 'Sauce',
    active: true,
    language: 'nl',
    hasPassword: false,
    hasPin: true,
    pinSetAt: '2026-11-01T09:00:00.000Z',
    tourSeenAt: null,
    lockedUntil: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
  },
  prepLines: [
    {
      id: '00000000-0000-4000-8000-000000000003',
      description: 'Chicken stock',
      station: 'Sauce',
      status: 'done',
      addedAt: '2026-11-17T08:00:00.000Z',
      completedAt: '2026-11-17T11:00:00.000Z',
      fromChecklist: false,
      added: false,
      onIt: true,
      ticked: true,
    },
  ],
  recipes: [],
  allergenChanges: [
    { dish: 'Kroket', changedAt: '2026-11-16T14:00:00.000Z', cause: 'Panko' },
    { dish: 'Pasta', changedAt: '2026-11-18T07:00:00.000Z', cause: 'label check: Pesto' },
  ],
  labelChecks: [
    {
      ingredient: 'Pesto',
      checkedAt: '2026-11-18T07:00:00.000Z',
      changed: true,
      status: 'pending',
      note: 'Batch 12',
    },
  ],
  handoverNote: { text: 'Fond staat op.', at: '2026-11-17T22:00:00.000Z' },
  sessions: [],
  approvedDevices: [],
};

describe('one person’s data, to read', () => {
  it('says what was kept, in the reader’s language, with nothing left untranslated', () => {
    const text = readablePersonData(createTranslator('nl'), data);
    expect(text).toContain('Wat Mise over Marco bewaart');
    expect(text).toContain('Chicken stock (Sauce)');
    expect(text).toContain('Hun naam staat erbij · Vinkte hem af');
    expect(text).toContain('Fond staat op.');
    expect(text).toContain('Nederlands');
    expect(text).toMatch(/• Kroket \(.*\) · Na een wijziging in Panko/);
    expect(text).toMatch(/• Pasta \(.*\) · Na controle van het etiket van Pesto/);
    expect(text).toContain('Etiketten gecontroleerd bij levering');
    expect(text).toMatch(/• Pesto \(.*\) · Etiket gewijzigd · Wacht op een chef · Batch 12/);
    expect(text).not.toMatch(/personData\.|\{[a-z]+\}/);
  });
});
