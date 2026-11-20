import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_UNPACKED_LINES,
  OFFLINE_BUNDLE_FORMAT,
  unpackOfflineBundle,
  type OfflineBundle,
  type Recipe,
} from '@mise/contracts';
import { MAX_LINES } from '@mise/domain';
import { breather, unpack } from './unpack.js';

/**
 * Unpacking the offline bundle in a worker, and on the page's own thread
 * whenever the worker can't be had or doesn't answer.
 */

const recipe = {
  id: 'r1',
  name: 'Base',
  type: 'prep',
  status: 'published',
  stationId: null,
  yield: { value: 1, unit: 'kg' },
  portions: null,
  prepMinutes: null,
  cookMinutes: null,
  shelfLifeHours: null,
  kept: null,
  storage: null,
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
  updatedAt: '2026-01-01T00:00:00.000Z',
} satisfies Recipe;

const bundle: OfflineBundle = {
  format: OFFLINE_BUNDLE_FORMAT,
  version: 'v1',
  stations: [],
  checklist: { enabled: false, items: [], updatedAt: '2026-01-01T00:00:00.000Z' },
  dishes: [],
  menus: [],
  dishCardSettings: { access: 'everyone' } as OfflineBundle['dishCardSettings'],
  kitchenName: null,
  ingredients: [],
  recipeEntries: [{ recipe, allergenHistory: null }],
  menuEntries: [],
};

/** A stand-in for the browser's Worker; `answer` decides what it does with the bundle. */
function fakeWorker(answer: (worker: EventTarget, bundle: OfflineBundle) => void) {
  const made: { url: string; options?: WorkerOptions; terminated: boolean }[] = [];
  class FakeWorker extends EventTarget {
    seen: (typeof made)[number];
    constructor(url: URL | string, options?: WorkerOptions) {
      super();
      this.seen = { url: String(url), options, terminated: false };
      made.push(this.seen);
    }
    postMessage(message: OfflineBundle) {
      // What crossing to a worker does to it.
      answer(this, structuredClone(message));
    }
    terminate() {
      this.seen.terminated = true;
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return made;
}

const reply = (worker: EventTarget, data: unknown) =>
  setTimeout(() => worker.dispatchEvent(new MessageEvent('message', { data })), 0);

afterEach(() => vi.unstubAllGlobals());

describe('unpacking off the page', () => {
  it('takes the worker’s answer, and ends the worker', async () => {
    const made = fakeWorker((worker, sent) =>
      reply(worker, { entries: [[['from-worker'], sent.version]] }),
    );
    expect(await unpack(bundle)).toEqual([[['from-worker'], 'v1']]);
    expect(made).toHaveLength(1);
    expect(made[0]!.url).toContain('unpack.worker');
    expect(made[0]!.options).toEqual({ type: 'module' });
    expect(made[0]!.terminated).toBe(true);
  });

  it('works it out on the page where there is no worker', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await unpack(bundle)).toEqual(unpackOfflineBundle(bundle));
  });

  it('works it out on the page when the worker can not be started', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('blocked');
        }
      },
    );
    expect(await unpack(bundle)).toEqual(unpackOfflineBundle(bundle));
  });

  it('works it out on the page when the worker’s file did not load', async () => {
    const made = fakeWorker((worker) =>
      setTimeout(() => worker.dispatchEvent(new Event('error')), 0),
    );
    expect(await unpack(bundle)).toEqual(unpackOfflineBundle(bundle));
    expect(made[0]!.terminated).toBe(true);
  });

  it('works it out on the page when the worker says it failed', async () => {
    fakeWorker((worker) => reply(worker, { failed: true }));
    expect(await unpack(bundle)).toEqual(unpackOfflineBundle(bundle));
  });

  it('works it out on the page when the worker does not answer in time', async () => {
    const made = fakeWorker(() => undefined);
    expect(await unpack(bundle, 10)).toEqual(unpackOfflineBundle(bundle));
    expect(made[0]!.terminated).toBe(true);
  });

  it('gives the page a breather with or without idle callbacks', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    await breather();
    const idle = vi.fn((done: () => void) => setTimeout(done, 0));
    vi.stubGlobal('requestIdleCallback', idle);
    await breather();
    expect(idle).toHaveBeenCalledWith(expect.any(Function), { timeout: 100 });
  });
});

describe('a bundle of very large specs', () => {
  it('stops working out specs once they come to more lines than a tablet can hold', () => {
    // Each prep uses the next twice, so the second lists about 8,000 lines,
    // under the limit for one recipe; and three hundred dishes use it.
    const line = (id: string, ref: number) => ({
      id,
      sortOrder: 0,
      section: null,
      note: null,
      quantity: { value: 1, unit: 'each' as const },
      ref,
    });
    const preps = Array.from({ length: 14 }, (_, level) => ({
      recipe: {
        ...recipe,
        id: `p${level}`,
        name: `Prep ${level}`,
        yield: { value: 1, unit: 'each' as const },
        // A recipe is sent as minus one minus its place in the entries.
        components:
          level === 13 ? [] : [line(`a${level}`, -2 - level), line(`b${level}`, -2 - level)],
      },
      allergenHistory: null,
    }));
    const dishes = Array.from({ length: 300 }, (_, i) => ({
      recipe: {
        ...recipe,
        id: `d${i}`,
        name: `Dish ${i}`,
        type: 'dish' as const,
        yield: { value: 1, unit: 'each' as const },
        components: [line(`c${i}`, -2)],
      },
      allergenHistory: [],
    }));
    const big = { ...bundle, recipeEntries: [...preps, ...dishes] };

    const started = Date.now();
    const entries = unpackOfflineBundle(big);
    expect(Date.now() - started).toBeLessThan(5_000);
    const expanded = entries.filter(([key]) => key[0] === 'recipe-expanded');
    const lines = expanded.reduce(
      (sum, [, data]) => sum + (data as { lines: unknown[] }).lines.length,
      0,
    );
    expect(lines).toBeLessThanOrEqual(MAX_UNPACKED_LINES + MAX_LINES);
    expect(expanded.length).toBeLessThan(big.recipeEntries.length);
    // The rest is still there to read offline; only the long spec waits to be opened online.
    const last = (kind: string) => entries.some(([key]) => key[0] === kind && key[1] === 'd299');
    expect(last('recipe')).toBe(true);
    expect(last('recipe-allergens')).toBe(true);
    expect(last('recipe-expanded')).toBe(false);
  });
});

describe('the worker itself', () => {
  it('answers a bundle with exactly what the page would work out', async () => {
    let listener: ((event: MessageEvent) => void) | undefined;
    const posted = vi.fn();
    vi.stubGlobal('addEventListener', (type: string, handler: (event: MessageEvent) => void) => {
      if (type === 'message') listener = handler;
    });
    vi.stubGlobal('postMessage', posted);
    await import('./unpack.worker.js');

    listener!(new MessageEvent('message', { data: structuredClone(bundle) }));
    expect(posted).toHaveBeenCalledWith({ entries: unpackOfflineBundle(bundle) });
    // And it survives the trip back as it is.
    expect(structuredClone(posted.mock.calls[0]![0])).toEqual({
      entries: unpackOfflineBundle(bundle),
    });

    posted.mockClear();
    listener!(new MessageEvent('message', { data: { ...bundle, recipeEntries: null } }));
    expect(posted).toHaveBeenCalledWith({ failed: true });
  });
});
