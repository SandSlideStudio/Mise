import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createTranslator } from '../i18n/index.js';
import { fieldName, namingFrom, showValue } from './conflictValues.js';

function naming() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(['stations'], [{ id: 's-pastry', name: 'Pastry' }]);
  queryClient.setQueryData(['ingredients', ''], [{ id: 'i-butter', name: 'Butter' }]);
  queryClient.setQueryData(
    ['dishes'],
    [{ id: 'd-tart', name: 'Pear tart', course: 'dessert', status: 'published' }],
  );
  return namingFrom(queryClient);
}

describe('the conflict dialog, side by side', () => {
  const en = createTranslator('en');
  const nl = createTranslator('nl');

  it('names fields in the kitchen’s language', () => {
    expect(fieldName(en, 'shelfLifeHours')).toBe('Keeps');
    expect(fieldName(nl, 'stationId')).toBe('Post');
    expect(fieldName(nl, 'yield')).toBe('Opbrengst');
  });

  it('shows stations, amounts, steps and allergens the way a chef reads them', () => {
    const names = naming();
    const show = (key: string, value: unknown) => showValue(en, 'recipes', key, value, names);
    expect(show('stationId', 's-pastry')).toBe('Pastry');
    expect(show('yield', { value: 1500, unit: 'g' })).toBe('1.5 kg');
    expect(show('shelfLifeHours', 72)).toBe('3 days');
    expect(show('prepMinutes', 35)).toBe('35 min');
    expect(show('status', 'published')).not.toBe('published');
    expect(show('mayContain', ['nuts'])).toMatch(/nut/i);
    expect(show('method', [{ text: 'Melt.' }, { text: 'Brown.' }])).toBe('1. Melt.\n2. Brown.');
    expect(
      show('components', [
        {
          quantity: { value: 250, unit: 'g' },
          ref: { kind: 'ingredient', ingredientId: 'i-butter' },
        },
      ]),
    ).toBe('250 g Butter');
  });

  it('shows a menu’s dishes by name, whether sent as ids or come back as dishes', () => {
    const names = naming();
    expect(showValue(en, 'menus', 'dishes', ['d-tart'], names)).toBe('Pear tart');
    expect(
      showValue(en, 'menus', 'dishes', [{ recipeId: 'd-tart', name: 'Pear tart' }], names),
    ).toBe('Pear tart');
    expect(showValue(nl, 'menus', 'status', 'active', names)).not.toBe('active');
  });
});
