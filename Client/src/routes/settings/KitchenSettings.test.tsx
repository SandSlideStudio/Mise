// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Kitchen } from '@mise/contracts';
import { KitchenSettings } from './KitchenSettings.js';

/**
 * A shorter "Keep them for" deletes older ticked lines within the hour, with
 * no way back, so it is asked first.
 */

const kitchen = {
  id: 'k-1',
  name: 'De Proefkeuken',
  language: 'en',
  tickedRetention: 'keep',
  prepChecklist: false,
  pinOnly: 'off',
  idleSignOutMinutes: null,
  tickedKeepDays: null,
  labelSize: '62x29',
  labelOnTick: false,
  currency: 'EUR',
  foodVatPercent: 9,
} satisfies Kitchen;

let patches: Record<string, unknown>[];

beforeEach(() => {
  patches = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') patches.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify(kitchen), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function showForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <KitchenSettings />
    </QueryClientProvider>,
  );
  return (await screen.findByLabelText(/keep them for/i)) as HTMLSelectElement;
}

it('asks before a shorter time, and saves nothing when told no', async () => {
  const keepFor = await showForm();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.change(keepFor, { target: { value: '30' } });
  fireEvent.submit(keepFor.form!);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('30 days'));
  expect(patches).toEqual([]);
});

it('saves once told yes', async () => {
  const keepFor = await showForm();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  fireEvent.change(keepFor, { target: { value: '30' } });
  fireEvent.submit(keepFor.form!);
  await waitFor(() => expect(patches[0]).toMatchObject({ tickedKeepDays: 30 }));
});

it('does not ask when nothing is shortened', async () => {
  const keepFor = await showForm();
  const confirm = vi.spyOn(window, 'confirm');
  fireEvent.submit(keepFor.form!);
  expect(confirm).not.toHaveBeenCalled();
  await waitFor(() => expect(patches).toHaveLength(1));
});
