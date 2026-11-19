// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Ingredient } from '@mise/contracts';
import { markReachable } from '../lib/connectivity.js';
import { entriesFor } from '../lib/outbox.js';
import { INGREDIENTS, PESTO } from '../test/labelKitchen.js';
import { setOutboxUser } from './client.js';
import { useCheckLabel } from './labelChecks.js';

/**
 * A label checked with Mise out of reach: kept in the outbox like any other
 * change, and shown on the ingredient at once.
 */

const ME = 'user-1';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  vi.stubGlobal('fetch', fetchMock);
  setOutboxUser(ME);
  markReachable();
});
afterEach(() => vi.unstubAllGlobals());

function setUp() {
  const client = new QueryClient();
  client.setQueryData(['ingredients', ''], INGREDIENTS);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useCheckLabel(), { wrapper });
  const pesto = () =>
    client.getQueryData<Ingredient[]>(['ingredients', ''])!.find((i) => i.id === PESTO.id)!;
  return { result, pesto };
}

describe('a label checked offline', () => {
  it('waits in the outbox with when it was read, and a chef’s new allergens show at once', async () => {
    const { result, pesto } = setUp();
    act(() =>
      result.current.mutate({
        ingredient: PESTO,
        label: { allergens: ['milk', 'nuts'], mayContain: [] },
        note: ' Supplier B ',
        by: 'Ana',
        applies: true,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [entry] = entriesFor(ME);
    expect(entry).toMatchObject({
      method: 'POST',
      path: `/ingredients/${PESTO.id}/label-checks`,
      body: { allergens: ['milk', 'nuts'], mayContain: [], note: 'Supplier B' },
      label: { key: 'offline.label.labelCheck', vars: { name: 'Pesto' } },
    });
    expect(typeof (entry!.body as { checkedAt: string }).checkedAt).toBe('string');
    expect(pesto().allergens).toEqual(['milk', 'nuts']);
    expect(pesto().labelCheck).toMatchObject({ by: 'Ana', pending: false });
  });

  it('shows a cook’s difference as waiting for a chef, and leaves the allergens', async () => {
    const { result, pesto } = setUp();
    act(() =>
      result.current.mutate({
        ingredient: PESTO,
        label: { allergens: [], mayContain: [] },
        note: '',
        by: 'Ana',
        applies: false,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(entriesFor(ME)).toHaveLength(1);
    expect(pesto().allergens).toEqual(['milk']);
    expect(pesto().labelCheck).toMatchObject({ pending: true });
  });
});
