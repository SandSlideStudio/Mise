// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AddFromChecklistResponse, ChecklistItem } from '@mise/contracts';
import type * as ChecklistApi from '../api/checklist.js';
import { PrepChecklist, typedAmount } from './PrepChecklist.js';

/**
 * Adding from the checklist with pars: a cook says how much is there of what
 * has a par, and the list is asked for the rest. A chef sets the par.
 */

const state = vi.hoisted(() => ({
  role: 'cook' as 'cook' | 'chef',
  items: [] as ChecklistItem[],
  add: vi.fn(),
  save: vi.fn(),
}));

vi.mock('../api/kitchen.js', () => ({
  useKitchen: () => ({ data: { prepChecklist: true } }),
  useStations: () => ({ data: [{ id: 'hot', name: 'Hot' }] }),
}));
vi.mock('../api/session.js', () => ({
  useCurrentUser: () => ({ data: { id: 'u1', role: state.role, kitchenName: 'K' } }),
}));
vi.mock('../api/recipes.js', () => ({
  useRecipes: () => ({
    data: [
      { id: 'r-gel', name: 'Vijgen gel', status: 'published', yield: { value: 1, unit: 'l' } },
    ],
  }),
}));
vi.mock('../api/checklist.js', async (actual) => ({
  ...(await actual<typeof ChecklistApi>()),
  useChecklist: () => ({ data: { enabled: true, items: state.items, updatedAt: 'v1' } }),
  useAddFromChecklist: () => ({ mutate: state.add, isPending: false, error: null }),
  useSaveChecklist: () => ({ mutate: state.save, isPending: false, error: null }),
}));

const GEL = 'i-gel';
const JUS = 'i-jus';

beforeEach(() => {
  state.role = 'cook';
  state.items = [
    { id: GEL, stationId: 'hot', name: 'Fig gel', recipeId: 'r-gel', par: { value: 3, unit: 'l' } },
    { id: JUS, stationId: 'hot', name: 'Jus', recipeId: null, par: null },
  ];
  state.add.mockReset();
  state.save.mockReset();
});
afterEach(cleanup);

function openAndTick(...names: string[]) {
  render(<PrepChecklist />);
  fireEvent.click(screen.getByRole('button', { name: /^Prep checklist/ }));
  for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name }));
}

/** Answer the add the way the server would. */
function answer(result: AddFromChecklistResponse) {
  const [, options] = state.add.mock.calls.at(-1) as [
    unknown,
    { onSuccess: (r: AddFromChecklistResponse) => void },
  ];
  act(() => options.onSuccess(result));
}

describe('adding lines with a par', () => {
  it('asks how much is there, in the par’s unit, and sends it with the ids', () => {
    openAndTick('Fig gel', 'Jus');
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (2)' }));
    expect(state.add).not.toHaveBeenCalled();

    expect(screen.getByRole('heading', { name: 'How much is there?' })).toBeTruthy();
    expect(screen.getByText('par 3 l')).toBeTruthy();
    // Only the line with a par is asked about.
    const box = screen.getByRole('spinbutton', { name: 'How much Fig gel is there, in l' });
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    fireEvent.change(box, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (2)' }));

    expect(state.add.mock.calls[0]![0]).toEqual({
      ids: [GEL, JUS],
      onHand: { [GEL]: { value: 1, unit: 'l' } },
    });
  });

  it('counts an empty box as nothing there', () => {
    openAndTick('Fig gel');
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (1)' }));
    expect(state.add.mock.calls[0]![0]).toEqual({ ids: [GEL], onHand: {} });
  });

  it('goes straight on, as before, when nothing ticked has a par', () => {
    openAndTick('Jus');
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (1)' }));
    expect(state.add.mock.calls[0]![0]).toEqual({ ids: [JUS] });
  });

  it('goes back to the ticks without adding anything', () => {
    openAndTick('Fig gel');
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(state.add).not.toHaveBeenCalled();
    expect((screen.getByRole('checkbox', { name: 'Fig gel' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('says which lines were left off because there is enough', () => {
    openAndTick('Fig gel', 'Jus');
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (2)' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to prep list (2)' }));
    answer({ added: 1, alreadyThere: 0, enough: ['Fig gel'] });
    expect(screen.getByRole('status').textContent).toBe(
      '1 line added to the prep list. Fig gel: enough there.',
    );
  });
});

describe('setting a par', () => {
  beforeEach(() => {
    state.role = 'chef';
    state.items = [
      { id: GEL, stationId: 'hot', name: 'Fig gel', recipeId: 'r-gel', par: null },
      { id: JUS, stationId: 'hot', name: 'Jus', recipeId: null, par: { value: 2, unit: 'kg' } },
    ];
  });

  function edit() {
    render(<PrepChecklist />);
    fireEvent.click(screen.getByRole('button', { name: /^Prep checklist/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist' }));
  }

  it('starts in the unit the linked recipe yields, and keeps a par already set', () => {
    edit();
    expect(
      (screen.getByRole('combobox', { name: 'Unit of the par for Fig gel' }) as HTMLSelectElement)
        .value,
    ).toBe('l');
    expect(
      (screen.getByRole('spinbutton', { name: 'Par for Jus' }) as HTMLInputElement).value,
    ).toBe('2');
  });

  it('saves what was typed, and an emptied par as none', () => {
    edit();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Par for Fig gel' }), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Par for Jus' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save checklist' }));
    const [{ items }] = state.save.mock.calls[0] as [{ items: ChecklistItem[] }];
    expect(items.map((item) => [item.name, item.par])).toEqual([
      ['Fig gel', { value: 3, unit: 'l' }],
      ['Jus', null],
    ]);
  });
});

describe('a number typed on a tablet', () => {
  it('takes a comma or a point, and nothing else', () => {
    expect(typedAmount('1,5')).toBe(1.5);
    expect(typedAmount(' 2 ')).toBe(2);
    expect(typedAmount('')).toBeNull();
    expect(typedAmount('abc')).toBeNull();
    expect(typedAmount('-1')).toBeNull();
  });
});
