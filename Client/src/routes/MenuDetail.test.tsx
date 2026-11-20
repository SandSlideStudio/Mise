// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Menu } from '@mise/contracts';

/**
 * Found walking through the app: an active menu with dishes still marked
 * draft printed cards saying so, and nothing on the menu page said why. It
 * now says how many, with one tap to publish them for those who may.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
  useNavigate: () => () => Promise.resolve(),
  useParams: () => ({ menuId: 'm-autumn' }),
}));

const { DraftDishes } = await import('./MenuDetail.js');

function dish(recipeId: string, status: 'draft' | 'published') {
  return { recipeId, name: recipeId, course: null, status, changedSinceCards: false };
}

const autumn: Menu = {
  id: 'm-autumn',
  name: 'Autumn',
  description: null,
  status: 'active',
  dishCount: 3,
  draftCount: 2,
  updatedAt: '2027-03-01T08:00:00.000Z',
  cardsPrintedAt: null,
  dishes: [dish('Oyster', 'draft'), dish('Tatin', 'published'), dish('Squab', 'draft')],
};

let sent: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      sent.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(init.body as string) : null,
      });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(menu: Menu, canPublish: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DraftDishes menu={menu} canPublish={canPublish} />
    </QueryClientProvider>,
  );
}

describe('draft dishes on an active menu', () => {
  it('are counted, and published in one tap', async () => {
    show(autumn, true);
    expect(screen.getByText('2 dishes are still drafts — their cards say so.')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Publish them' }));
    });
    const patches = sent.filter((call) => call.method === 'PATCH');
    expect(patches.map((call) => call.url)).toEqual([
      expect.stringContaining('/recipes/Oyster'),
      expect.stringContaining('/recipes/Squab'),
    ]);
    expect(patches.map((call) => call.body)).toEqual([
      { status: 'published' },
      { status: 'published' },
    ]);
  });

  it('are only offered for publishing to those who may', () => {
    show(autumn, false);
    expect(screen.getByText('2 dishes are still drafts — their cards say so.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('say nothing when every dish is published', () => {
    show({ ...autumn, dishes: [dish('Tatin', 'published')] }, true);
    expect(screen.queryByText(/draft/)).toBeNull();
  });
});
