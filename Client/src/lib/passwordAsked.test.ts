import { describe, expect, it } from 'vitest';
import { passwordAsked } from './passwordAsked.js';

const ME = 'me';
const rosa = { id: 'rosa', email: 'rosa@example.com', role: 'sous_chef' as const };
const myself = { id: ME, email: 'chef@example.com', role: 'admin' as const };
const unchanged = (person: typeof rosa | typeof myself) => ({
  email: person.email,
  password: '',
  pin: '',
  role: person.role,
});

describe('when the staff screen asks for your password again', () => {
  it('asks nothing inside the kitchen, for adding someone or setting their password', () => {
    expect(
      passwordAsked({ person: undefined, meId: ME, outside: false, edit: unchanged(rosa) }),
    ).toBe(null);
    expect(
      passwordAsked({
        person: rosa,
        meId: ME,
        outside: false,
        edit: { ...unchanged(rosa), password: 'a-new-password', role: 'head_chef' },
      }),
    ).toBe(null);
  });

  it('asks for your current one when you change your own password or email, inside too', () => {
    const mine = unchanged(myself);
    expect(
      passwordAsked({ person: myself, meId: ME, outside: false, edit: { ...mine, password: 'x' } }),
    ).toBe('self');
    expect(
      passwordAsked({
        person: myself,
        meId: ME,
        outside: false,
        edit: { ...mine, email: 'new@example.com' },
      }),
    ).toBe('self');
    expect(passwordAsked({ person: myself, meId: ME, outside: false, edit: mine })).toBe(null);
  });

  it('from outside, asks before adding anyone or changing how they sign in or their role', () => {
    const theirs = unchanged(rosa);
    expect(passwordAsked({ person: undefined, meId: ME, outside: true, edit: theirs })).toBe(
      'outside',
    );
    for (const change of [
      { password: 'a-new-password' },
      { pin: '7356' },
      { email: 'other@example.com' },
      { email: null },
      { role: 'cook' as const },
    ]) {
      expect(
        passwordAsked({ person: rosa, meId: ME, outside: true, edit: { ...theirs, ...change } }),
      ).toBe('outside');
    }
    // A name or a station is no way in.
    expect(passwordAsked({ person: rosa, meId: ME, outside: true, edit: theirs })).toBe(null);
  });
});
