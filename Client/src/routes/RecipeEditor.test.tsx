// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Recipe } from '@mise/contracts';

/** How a prep is kept, chosen in the editor beside its shelf life. */

const params = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => () => Promise.resolve(),
  useParams: () => params.value,
  useRouterState: () => '/recipes/r1/edit',
}));
// The editor alone, without the navigation around it.
vi.mock('../components/AppShell.js', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <>{children}</>,
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { RecipeEditor } = await import('./RecipeEditor.js');

const user = {
  id: 'u1',
  displayName: 'Teun',
  role: 'admin',
  language: 'en',
  kitchenName: 'De Kas',
};

const figGel = {
  id: 'r1',
  name: 'Fig gel',
  type: 'prep',
  status: 'published',
  stationId: null,
  yield: { value: 1, unit: 'kg' },
  portions: null,
  prepMinutes: null,
  cookMinutes: null,
  shelfLifeHours: null,
  kept: null,
  storage: 'Labelled tubs, walk-in',
  method: [],
  tags: [],
  declaredAllergens: [],
  mayContain: [],
  flavourProfile: [],
  servingTemperature: null,
  course: null,
  drinkPairings: [],
  cutlery: [],
  components: [],
  photos: [],
  version: 1,
  updatedAt: '2027-04-05T10:00:00.000Z',
} satisfies Recipe;

let sent: { method: string; url: string; body: unknown }[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json(200, url.includes('allergens') ? null : []);
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      sent.push({ method, url, body });
      return json(200, { ...figGel, ...(body as object) });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(recipe: Recipe) {
  params.value = { recipeId: recipe.id };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(['me'], user);
  client.setQueryData(['recipe', recipe.id], recipe);
  client.setQueryData(['stations'], []);
  render(
    <QueryClientProvider client={client}>
      <RecipeEditor />
    </QueryClientProvider>,
  );
}

describe('how it is kept, in the editor', () => {
  it('is a choice of its own, with the storage text kept as a note', () => {
    open(figGel);
    const kept = screen.getByLabelText<HTMLSelectElement>('How it is kept');
    // Never chosen for this recipe: it says so rather than guess.
    expect(kept.value).toBe('');
    expect(Array.from(kept.options).map((option) => option.textContent)).toEqual([
      'Not set',
      'Chilled, 7 °C or colder',
      'Chilled, 4 °C or colder',
      'Frozen, −18 °C or colder',
      'Dry / room temperature',
      'Kept hot, 60 °C or hotter',
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Where / notes').value).toBe(
      'Labelled tubs, walk-in',
    );
  });

  it('is saved with the recipe, beside the note', async () => {
    open(figGel);
    fireEvent.change(screen.getByLabelText('How it is kept'), { target: { value: 'chilled_4' } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText('How it is kept').closest('form')!);
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      method: 'PATCH',
      url: '/api/recipes/r1',
      body: { kept: 'chilled_4', storage: 'Labelled tubs, walk-in' },
    });
  });

  it('shows what was chosen, and saves no choice when none is made', async () => {
    open({ ...figGel, kept: 'frozen' });
    const kept = screen.getByLabelText<HTMLSelectElement>('How it is kept');
    expect(kept.value).toBe('frozen');
    fireEvent.change(kept, { target: { value: '' } });
    await act(async () => {
      fireEvent.submit(kept.closest('form')!);
    });
    expect(sent[0]!.body).toMatchObject({ kept: null });
  });
});
