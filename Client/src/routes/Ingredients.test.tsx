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

const { IngredientForm, Ingredients } = await import('./Ingredients.js');
const { I18nProvider } = await import('../i18n/index.js');

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

  /**
   * Found walking through the app: the price box was the browser's number
   * box, and an English browser read "9,80" as 980. Butter then cost
   * € 980 a kilo and every food cost was a hundred times out, unseen.
   */
  it('reads "9,80" as nine eighty, whatever language the browser speaks', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Purchase price'), { target: { value: '9,80' } });
    fireEvent.change(screen.getByLabelText('For'), { target: { value: '2,5' } });
    await save();
    expect(sent[0]).toMatchObject({
      price: { amount: 9.8, quantity: { value: 2.5, unit: 'kg' } },
    });
  });

  it('takes a price pasted with its currency sign', async () => {
    open();
    fireEvent.change(screen.getByLabelText('Purchase price'), { target: { value: '€ 9.80' } });
    await save();
    expect(sent[0]).toMatchObject({ price: { amount: 9.8 } });
  });

  it('says so, and saves nothing, when the price can’t be read', async () => {
    open();
    const price = screen.getByLabelText('Purchase price');
    fireEvent.change(price, { target: { value: '1.250,50' } });
    fireEvent.blur(price);
    await save();
    expect(sent).toHaveLength(0);
    expect(price.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/thousands separator/);
    // The browser holds the form back too.
    expect((price as HTMLInputElement).validity.valid).toBe(false);
  });

  it('holds the trim yield to a percentage', async () => {
    open();
    const yieldBox = screen.getByLabelText('Trim yield, per cent');
    fireEvent.change(yieldBox, { target: { value: '120' } });
    await save();
    expect(sent).toHaveLength(0);
    expect(screen.getByRole('alert').textContent).toBe('At most 100.');
    fireEvent.change(yieldBox, { target: { value: '85,5 %' } });
    await save();
    expect(sent[0]).toMatchObject({ yieldPercent: 85.5 });
  });

  it('shows the price it has the way this kitchen writes it, and tidies what was typed', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], { id: 'u1', displayName: 'Teun', role: 'admin', language: 'nl' });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <IngredientForm
            ingredient={{ ...butter, price: { ...butter.price, amount: 9.8 } }}
            onDone={() => {}}
            onCancel={() => {}}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const price = screen.getByLabelText<HTMLInputElement>('Inkoopprijs');
    expect(price.value).toBe('9,80');
    fireEvent.change(price, { target: { value: '12.5' } });
    fireEvent.blur(price);
    expect(price.value).toBe('12,50');
  });
});

/**
 * Found by the browser tests: searching the list asked Mise for each search,
 * and those answers are not kept on the tablet, so with Mise out of reach a
 * search said it couldn't load, and a label at the back door couldn't be
 * found to check. The list the tablet has is searched instead.
 */
describe('searching the ingredients', () => {
  it('finds them in the list the tablet has, with Mise out of reach', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(['me'], {
      id: 'u1',
      displayName: 'Teun',
      role: 'admin',
      language: 'en',
      kitchenName: 'Test Kitchen',
    });
    const shallots = { ...butter, id: 'i-shallots', name: 'Shallots', allergens: [] };
    client.setQueryData(['ingredients', ''], [butter, shallots]);
    render(
      <QueryClientProvider client={client}>
        <Ingredients />
      </QueryClientProvider>,
    );
    await act(async () => {
      fireEvent.change(screen.getAllByLabelText('Search ingredients')[0]!, {
        target: { value: 'shal' },
      });
    });
    expect(screen.getByText('Shallots')).toBeTruthy();
    expect(screen.queryByText('Butter')).toBeNull();
    expect(screen.queryByText(/Couldn’t load this/)).toBeNull();
  });
});
