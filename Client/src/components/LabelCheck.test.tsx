// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LabelCheck } from '@mise/contracts';
import type * as LabelApi from '../api/labelChecks.js';
import { causeText, createTranslator } from '../i18n/index.js';
import { DISHES, INGREDIENTS, LEAVES, PESTO, RECIPES } from '../test/labelKitchen.js';
import { DeliveryCheck } from './DeliveryCheck.js';
import { LabelCheckForm, labelCheckAge } from './LabelCheck.js';
import { PendingLabelChecks } from './PendingLabelChecks.js';

/**
 * Checking a label: the consequences before saving, one tap for "no change",
 * a cook's difference sent to a chef, a delivery label by label, and the
 * chef's list of what waits.
 */

const state = vi.hoisted(() => ({
  role: 'head_chef' as 'head_chef' | 'cook',
  check: vi.fn(),
  decide: vi.fn(),
  pending: [] as LabelCheck[],
}));

vi.mock('../api/session.js', () => ({
  useCurrentUser: () => ({ data: { id: 'u1', role: state.role, displayName: 'Ana' } }),
}));
vi.mock('../api/recipes.js', () => ({
  useRecipes: () => ({ data: RECIPES, isPending: false }),
}));
vi.mock('../api/dishcards.js', () => ({ useDishes: () => ({ data: DISHES }) }));
vi.mock('../api/labelChecks.js', async (actual) => ({
  ...(await actual<typeof LabelApi>()),
  useCheckLabel: () => ({ mutate: state.check, isPending: false, error: null }),
  useDecideLabelCheck: () => ({ mutate: state.decide, isPending: false, error: null }),
  usePendingLabelChecks: () => ({ data: state.pending }),
}));

let client: QueryClient;
beforeEach(() => {
  state.role = 'head_chef';
  state.check.mockReset();
  state.decide.mockReset();
  state.pending = [];
  // Every recipe is on the device, as the offline bundle leaves it.
  client = new QueryClient();
  for (const recipe of RECIPES) client.setQueryData(['recipe', recipe.id], recipe);
});
afterEach(cleanup);

function show(node: ReactNode) {
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

/** Answer the last check the way the server would. */
function saved() {
  const [, options] = state.check.mock.calls.at(-1) as [unknown, { onSuccess: () => void }];
  act(() => options.onSuccess());
}

describe('checking a label', () => {
  it('records "no change" in one tap', () => {
    const done = vi.fn();
    show(<LabelCheckForm ingredient={PESTO} ingredients={INGREDIENTS} onDone={done} />);
    expect(screen.getByText(/The label says what Mise has/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No change' }));
    expect(state.check.mock.calls[0]![0]).toMatchObject({
      ingredient: PESTO,
      label: { allergens: ['milk'], mayContain: [] },
      applies: true,
    });
    saved();
    expect(done).toHaveBeenCalledWith('same');
  });

  it('shows which dishes and menus change before a chef saves it', () => {
    const done = vi.fn();
    show(<LabelCheckForm ingredient={PESTO} ingredients={INGREDIENTS} onDone={done} />);
    const contains = screen.getByRole('group', { name: 'Allergens' });
    fireEvent.click(within(contains, 'Tree nuts'));

    expect(screen.getByText('1 dish changes:')).toBeTruthy();
    expect(screen.getByText('Pasta pesto')).toBeTruthy();
    expect(screen.getByText('On Lunch')).toBeTruthy();
    expect(screen.getByText('Now contains: Tree nuts')).toBeTruthy();
    expect(screen.queryByText('Salad')).toBeNull();
    expect(screen.queryByRole('button', { name: 'No change' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Supplier or product code (optional)'), {
      target: { value: 'Supplier B' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the new label' }));
    expect(state.check.mock.calls[0]![0]).toMatchObject({
      label: { allergens: ['milk', 'nuts'], mayContain: [] },
      note: 'Supplier B',
    });
    saved();
    expect(done).toHaveBeenCalledWith('applied');
  });

  it('says a cook’s difference goes to a chef, and that nothing changes until then', () => {
    state.role = 'cook';
    const done = vi.fn();
    show(<LabelCheckForm ingredient={PESTO} ingredients={INGREDIENTS} onDone={done} />);
    fireEvent.click(within(screen.getByRole('group', { name: /^May contain/ }), 'Peanuts'));
    expect(screen.getByText('Now may contain: Peanuts')).toBeTruthy();
    expect(screen.getByText('A chef approves this before the allergens change.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send to a chef' }));
    expect(state.check.mock.calls[0]![0]).toMatchObject({ applies: false });
    saved();
    expect(done).toHaveBeenCalledWith('pending');
  });

  it('starts again from what Mise has', () => {
    show(<LabelCheckForm ingredient={PESTO} ingredients={INGREDIENTS} onDone={() => {}} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Allergens' }), 'Milk'));
    expect(screen.getByText('No longer contains: Milk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(screen.getByRole('button', { name: 'No change' })).toBeTruthy();
  });
});

function within(group: HTMLElement, name: string): HTMLElement {
  const button = [...group.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!button) throw new Error(`No ${name} in the group`);
  return button;
}

describe('checking a delivery', () => {
  it('goes through the ticked labels in turn, a skip included', () => {
    const close = vi.fn();
    show(<DeliveryCheck ingredients={INGREDIENTS} onClose={close} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search ingredients' }), {
      target: { value: 'pes' },
    });
    expect(screen.queryByRole('checkbox', { name: 'Leaves' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesto' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search ingredients' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Leaves' }));
    fireEvent.click(screen.getByRole('button', { name: 'Check 2 labels' }));

    expect(screen.getByText('Label 1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check the label: Pesto' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'No change' }));
    saved();

    expect(screen.getByText('Label 2 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: `Check the label: ${LEAVES.name}` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(screen.getByRole('status').textContent).toBe('Delivery checked: 1 label.');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(close).toHaveBeenCalled();
  });

  it('brings each label into view from its top', () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    show(<DeliveryCheck ingredients={INGREDIENTS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pesto' }));
    expect(scrolled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check 1 label' }));
    expect(scrolled).toHaveBeenCalledWith({ block: 'start' });
  });
});

describe('label changes waiting for a chef', () => {
  it('lists each with what it changes, approved or rejected in one tap', () => {
    state.pending = [
      {
        id: 'lc-1',
        ingredientId: PESTO.id,
        ingredientName: 'Pesto',
        checkedAt: '2026-11-18T07:30:00.000Z',
        checkedBy: 'Ana',
        changed: true,
        before: { allergens: ['milk'], mayContain: [] },
        after: { allergens: ['milk', 'nuts'], mayContain: [] },
        note: 'Batch 12',
        status: 'pending',
      },
    ];
    show(<PendingLabelChecks ingredients={INGREDIENTS} />);
    expect(screen.getByRole('heading', { name: '1 label change waiting' })).toBeTruthy();
    expect(screen.getByText(/Checked by Ana/)).toBeTruthy();
    // What the cook read, and what that does to the menu.
    expect(screen.getAllByText('Now contains: Tree nuts')).toHaveLength(2);
    expect(screen.getByText('On Lunch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve: Pesto' }));
    expect(state.decide).toHaveBeenCalledWith({ id: 'lc-1', approve: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reject: Pesto' }));
    expect(state.decide).toHaveBeenLastCalledWith({ id: 'lc-1', approve: false });
  });

  it('shows nothing when nothing waits', () => {
    const { container } = show(<PendingLabelChecks ingredients={INGREDIENTS} />);
    expect(container.textContent).toBe('');
  });
});

describe('saying when a label was checked', () => {
  const en = createTranslator('en');
  const now = new Date('2026-11-19T12:00:00');

  it('by whom and how long ago, or never', () => {
    expect(labelCheckAge(en, null, now)).toBe('Label never checked');
    expect(labelCheckAge(en, { at: '2026-11-16T09:00:00', by: 'Ana', pending: false }, now)).toBe(
      'Label checked 3 days ago by Ana',
    );
    expect(labelCheckAge(en, { at: '2026-11-19T06:00:00', by: null, pending: false }, now)).toBe(
      'Label checked today',
    );
    expect(
      labelCheckAge(
        createTranslator('nl'),
        { at: '2026-11-18T22:00:00', by: 'Ana', pending: false },
        now,
      ),
    ).toBe('Etiket gisteren gecontroleerd door Ana');
  });

  it('reads a label check well in a dish’s allergen record', () => {
    expect(causeText(en.t, 'label check: Pesto')).toBe('After the label of Pesto was checked');
    expect(causeText(en.t, 'Pesto')).toBe('After a change to Pesto');
  });
});
