// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { OfflineBundle } from '@mise/contracts';
import { markReachable } from '../lib/connectivity.js';
import { add } from '../lib/outbox.js';
import { forgetKept, loadAhead } from './offline.js';

// No IndexedDB in the test browser; the store is not what is under test.
vi.mock('idb-keyval', () => ({
  del: () => Promise.resolve(),
  get: () => Promise.resolve(undefined),
  set: () => Promise.resolve(),
}));

/**
 * Loading ahead: nothing when the kitchen's data is as it was at the last
 * complete load, one request for all of it when it changed.
 */

const fetchMock = vi.fn<typeof fetch>();
let version = 'boot-1-chef';

const settings = { access: 'everyone' } as OfflineBundle['dishCardSettings'];
const recipe = { id: 'r1', name: 'Base' } as OfflineBundle['recipeEntries'][number]['recipe'];

function bundle(): OfflineBundle {
  return {
    version,
    stations: [],
    checklist: { enabled: false, items: [], updatedAt: '2026-01-01T00:00:00.000Z' },
    dishes: [],
    menus: [],
    dishCardSettings: settings,
    recipes: [{ id: 'r1' }] as OfflineBundle['recipes'],
    recipeEntries: [
      {
        recipe,
        usedBy: [],
        allergens: {
          contains: [],
          mayContain: [],
        } as unknown as OfflineBundle['recipeEntries'][number]['allergens'],
        expanded: { factor: 1, lines: [] },
        card: null,
        allergenHistory: null,
      },
    ],
    menuEntries: [],
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const asked = () => fetchMock.mock.calls.map(([url]) => String(url).replace('/api', ''));

beforeEach(() => {
  localStorage.clear();
  version = 'boot-1-chef';
  fetchMock.mockReset();
  fetchMock.mockImplementation((input) => {
    const url = String(input);
    if (url.endsWith('/offline/version')) return Promise.resolve(json({ version }));
    if (url.endsWith('/offline/bundle')) return Promise.resolve(json(bundle()));
    if (url.endsWith('/running/tasks')) return Promise.resolve(json([]));
    if (url.endsWith('/running/note')) return Promise.resolve(json({ text: null }));
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  markReachable();
});
afterEach(() => vi.unstubAllGlobals());

describe('loading ahead', () => {
  it('loads once in one request and fills the keys the screens read', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);

    expect(asked().filter((path) => path.startsWith('/offline/'))).toEqual([
      '/offline/version',
      '/offline/bundle',
    ]);
    // Not one request per recipe.
    expect(asked().some((path) => path.startsWith('/recipes'))).toBe(false);

    expect(queryClient.getQueryData(['recipes', {}])).toEqual([{ id: 'r1' }]);
    expect(queryClient.getQueryData(['recipe', 'r1'])).toEqual(recipe);
    expect(queryClient.getQueryData(['recipe-expanded', 'r1', {}])).toEqual({
      recipe,
      factor: 1,
      lines: [],
      allergens: { contains: [], mayContain: [] },
    });
    expect(queryClient.getQueryData(['recipe-allergens', 'r1'])).toBeDefined();
    expect(queryClient.getQueryData(['recipe-used-by', 'r1'])).toEqual([]);
    expect(queryClient.getQueryData(['dish-card-settings'])).toEqual(settings);
    expect(queryClient.getQueryData(['stations'])).toEqual([]);
    expect(queryClient.getQueryData(['checklist'])).toBeDefined();
    expect(queryClient.getQueryData(['dishes'])).toEqual([]);
    expect(queryClient.getQueryData(['menus'])).toEqual([]);
    expect(queryClient.getQueryData(['tasks', 'running'])).toEqual([]);
  });

  it('skips when nothing changed since the last complete load', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);
    fetchMock.mockClear();

    await loadAhead(queryClient);
    expect(asked()).toEqual(['/offline/version']);
  });

  it('loads again when the version changed, and then rests again', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);
    fetchMock.mockClear();

    version = 'boot-1-chef-changed';
    await loadAhead(queryClient);
    expect(asked()).toContain('/offline/bundle');

    fetchMock.mockClear();
    await loadAhead(queryClient);
    expect(asked()).toEqual(['/offline/version']);
  });

  it('does not count a load that failed as complete', async () => {
    const queryClient = new QueryClient();
    fetchMock.mockImplementationOnce(() => Promise.resolve(json({ version })));
    fetchMock.mockImplementationOnce(() => Promise.resolve(new Response('no', { status: 500 })));
    await loadAhead(queryClient);
    expect(queryClient.getQueryData(['recipes', {}])).toBeUndefined();

    fetchMock.mockClear();
    await loadAhead(queryClient);
    expect(asked()).toContain('/offline/bundle');
  });

  it('loads again when the saved answers are gone, whatever the version says', async () => {
    await loadAhead(new QueryClient());
    fetchMock.mockClear();

    const fresh = new QueryClient();
    await loadAhead(fresh);
    expect(asked()).toContain('/offline/bundle');
    expect(fresh.getQueryData(['recipes', {}])).toBeDefined();
  });

  it('forgets the version with everything else on signing out', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);
    // What signing out does: the kept copy goes, and the answers with it.
    await forgetKept();
    queryClient.removeQueries();
    fetchMock.mockClear();

    await loadAhead(queryClient);
    expect(asked()).toContain('/offline/bundle');
  });

  it('keeps the version in the cache it describes, so they are saved together', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);
    expect(queryClient.getQueryData(['loaded-version'])).toBe(version);
  });

  it('leaves an edit waiting to be sent as it is, and loads again later', async () => {
    const queryClient = new QueryClient();
    await loadAhead(queryClient);
    queryClient.setQueryData(['recipe', 'r1'], { id: 'r1', name: 'Edited offline' });
    add({
      id: 'recipe-000000001',
      userId: 'user-1',
      method: 'PATCH',
      path: '/recipes/r1',
      body: { name: 'Edited offline' },
      label: { key: 'offline.label.recipe' },
    });
    version = 'boot-1-chef-changed';
    await loadAhead(queryClient, 'user-1');
    expect(queryClient.getQueryData(['recipe', 'r1'])).toEqual({
      id: 'r1',
      name: 'Edited offline',
    });
    expect(queryClient.getQueryData(['loaded-version'])).not.toBe(version);
  });

  it('does not paint over a save that finished while the bundle was on its way', async () => {
    const queryClient = new QueryClient();
    let release = () => {};
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/offline/version')) return Promise.resolve(json({ version }));
      if (url.endsWith('/offline/bundle')) {
        return new Promise((resolve) => {
          release = () => resolve(json(bundle()));
        });
      }
      return Promise.resolve(json([]));
    });
    const loading = loadAhead(queryClient);
    await vi.waitFor(() => expect(asked()).toContain('/offline/bundle'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    queryClient.setQueryData(['recipe', 'r1'], { id: 'r1', name: 'Saved online' });
    release();
    await loading;
    expect(queryClient.getQueryData(['recipe', 'r1'])).toEqual({ id: 'r1', name: 'Saved online' });
    // Not counted as complete: the next round loads what it missed.
    expect(queryClient.getQueryData(['loaded-version'])).toBeUndefined();
  });

  it('lets go of cards and recipes the bundle no longer holds', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['dish-card', 'gone'], { name: 'Old card' });
    queryClient.setQueryData(['recipe', 'gone'], { id: 'gone' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await loadAhead(queryClient);
    expect(queryClient.getQueryData(['dish-card', 'gone'])).toBeUndefined();
    expect(queryClient.getQueryData(['recipe', 'gone'])).toBeUndefined();
    expect(queryClient.getQueryData(['recipe', 'r1'])).toEqual(recipe);
  });
});
