// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Ingredient } from '@mise/contracts';

/**
 * The price in the ingredient editor. A new price alone keeps the
 * ingredient's version, so the editor sends one only when it was changed
 * here, and then with the price it replaces.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => () => Promise.resolve(),
  useRouterState: () => '/ingredients',
}));
vi.mock('../components/AppShell.js', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { IngredientForm } = await import('./Ingredients.js');

const butter = {
  id: 'i-butter',
  name: 'Butter',
  category: null,
  baseUnit: 'g',
  allergens: ['milk'],
  mayContain: [],
  vegan: false,
  allergenDetails: { gluten: [], nuts: [] },
  notes: null,
  densityGPerMl: null,
  itemWeightG: null,
  yieldPercent: 100,
  price: {
    amount: 5,
    quantity: { value: 1, unit: 'kg' },
    updatedAt: '2027-04-01T08:00:00.000Z',
    perBase: 0.005,
  },
  labelCheck: null,
  updatedAt: '2027-03-01T08:00:00.000Z',
} satisfies Ingredient;

let sent: Record<string, unknown>[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) sent.push(JSON.parse(init.body as string) as Record<string, unknown>);
      return new Response(JSON.stringify(butter), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], { id: 'u1', displayName: 'Teun', role: 'admin', language: 'en' });
  render(
    <QueryClientProvider client={client}>
      <IngredientForm ingredient={butter} onDone={() => {}} onCancel={() => {}} />
    </QueryClientProvider>,
  );
}

async function save() {
  await act(async () => {
    fireEvent.submit(screen.getByLabelText('Purchase price').closest('form')!);
  });
}

describe('the price in the ingredient editor', () => {
  it('is not sent again when it was left as it was', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Salted butter' } });
    await save();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: 'Salted butter' });
    expect(sent[0]).not.toHaveProperty('price');
    expect(sent[0]).not.toHaveProperty('priceBase');
  });

  it('is sent with the price it replaces when changed', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Purchase price'), { target: { value: '6' } });
    await save();
    expect(sent[0]).toMatchObject({
      price: { amount: 6, quantity: { value: 1, unit: 'kg' } },
      priceBase: '2027-04-01T08:00:00.000Z',
    });
  });
});
