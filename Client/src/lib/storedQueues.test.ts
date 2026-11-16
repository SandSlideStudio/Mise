// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as OutboxModule from './outbox.js';
import type * as TicksModule from './retryQueue.js';

/**
 * The outbox and the tick queue are shared by every tab on a tablet. Each
 * tab is simulated by loading its own copy of the modules over the same
 * localStorage.
 */

type Outbox = typeof OutboxModule;
type Ticks = typeof TicksModule;

async function openTab(): Promise<{ outbox: Outbox; ticks: Ticks }> {
  vi.resetModules();
  return { outbox: await import('./outbox.js'), ticks: await import('./retryQueue.js') };
}

const change = (id: string, userId = 'u1') => ({
  id,
  userId,
  method: 'PATCH' as const,
  path: `/recipes/${id}`,
  label: { key: 'offline.label.recipe' },
});

const tick = (taskId: string, userId = 'u1') => ({
  userId,
  taskId,
  listKey: 'running',
  patch: { status: 'done' as const },
});

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('the outbox with two tabs', () => {
  it('keeps a change from each tab, added at the same instant', async () => {
    vi.useFakeTimers({ now: 1_000 });
    const a = await openTab();
    const b = await openTab();
    // Both tabs have read the (empty) list before either one adds.
    expect(a.outbox.entriesFor('u1')).toEqual([]);
    expect(b.outbox.entriesFor('u1')).toEqual([]);
    a.outbox.add(change('from-a'));
    b.outbox.add(change('from-b'));
    expect(a.outbox.entriesFor('u1').map((e) => e.id)).toEqual(['from-a', 'from-b']);
    expect(b.outbox.entriesFor('u1').map((e) => e.id)).toEqual(['from-a', 'from-b']);
  });

  it('does not bring back a change another tab has sent, when this tab updates it', async () => {
    const a = await openTab();
    const b = await openTab();
    a.outbox.add(change('one'));
    b.outbox.remove('one');
    a.outbox.update('one', { failures: 1 });
    expect(a.outbox.entriesFor('u1')).toEqual([]);
  });

  it('puts them in the order they were made, even within one millisecond', async () => {
    vi.useFakeTimers({ now: 5_000 });
    const { outbox } = await openTab();
    const ids = ['z', 'a', 'm', 'b'];
    for (const id of ids) outbox.add(change(id));
    expect(outbox.entriesFor('u1').map((e) => e.id)).toEqual(ids);
  });

  it('puts changes from two tabs made in the same millisecond in the order of their ids', async () => {
    vi.useFakeTimers({ now: 5_000 });
    const a = await openTab();
    const b = await openTab();
    b.outbox.add(change('b'));
    a.outbox.add(change('a'));
    expect(a.outbox.entriesFor('u1').map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('keeps each person own changes apart', async () => {
    const { outbox } = await openTab();
    outbox.add(change('x', 'u1'));
    outbox.add(change('y', 'u2'));
    expect(outbox.entriesFor('u1').map((e) => e.id)).toEqual(['x']);
    expect(outbox.entriesFor('u2').map((e) => e.id)).toEqual(['y']);
  });

  it('updates only its own change', async () => {
    const { outbox } = await openTab();
    outbox.add(change('x'));
    outbox.add(change('y'));
    outbox.update('x', { failures: 2 });
    const [x, y] = outbox.entriesFor('u1');
    expect(x?.failures).toBe(2);
    expect(y?.failures).toBeUndefined();
  });

  it('moves changes kept under the old single key over, losing none', async () => {
    const old = [
      { ...change('old-1'), queuedAt: 1, conflict: { current: { name: 'Theirs' } } },
      { ...change('old-2', 'u2'), queuedAt: 2 },
      { id: '', userId: 'u1' },
    ];
    localStorage.setItem('mise.outbox', JSON.stringify(old));
    const { outbox } = await openTab();
    expect(outbox.entriesFor('u1').map((e) => e.id)).toEqual(['old-1']);
    expect(outbox.entriesFor('u1')[0]?.conflict).toEqual({ current: { name: 'Theirs' } });
    expect(outbox.entriesFor('u2').map((e) => e.id)).toEqual(['old-2']);
    expect(localStorage.getItem('mise.outbox')).toBeNull();
    expect(localStorage.getItem('mise.outbox.old-1')).not.toBeNull();
  });

  it('does not overwrite a change already moved over when the old key shows up again', async () => {
    const entry = { ...change('same'), queuedAt: 1 };
    localStorage.setItem('mise.outbox', JSON.stringify([entry]));
    const a = await openTab();
    a.outbox.update('same', { failures: 3 });
    // A tab still running the old version writes the old list again.
    localStorage.setItem(
      'mise.outbox',
      JSON.stringify([entry, { ...change('more'), queuedAt: 2 }]),
    );
    const b = await openTab();
    const list = b.outbox.entriesFor('u1');
    expect(list.map((e) => e.id)).toEqual(['same', 'more']);
    expect(list[0]?.failures).toBe(3);
  });

  it('survives garbage in the old key and in its own keys', async () => {
    localStorage.setItem('mise.outbox', '{not json');
    localStorage.setItem('mise.outbox.broken', '{nope');
    const { outbox } = await openTab();
    expect(outbox.entriesFor('u1')).toEqual([]);
  });

  it('tells the screen when another tab changes it', async () => {
    const { outbox } = await openTab();
    const listener = vi.fn();
    outbox.subscribe(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: 'mise.outbox.zzz' }));
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something.else' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('says so when storage will not take the change', async () => {
    const { outbox } = await openTab();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => outbox.add(change('x'))).toThrow('outbox_unavailable');
    spy.mockRestore();
  });
});

describe('the tick queue with two tabs', () => {
  it('keeps a tick from each tab, made at the same instant', async () => {
    const a = await openTab();
    const b = await openTab();
    a.ticks.enqueue(tick('t1'));
    b.ticks.enqueue(tick('t2'));
    expect(
      a.ticks
        .pendingFor('u1')
        .map((e) => e.taskId)
        .sort(),
    ).toEqual(['t1', 't2']);
    expect(b.ticks.pendingFor('u1')).toHaveLength(2);
  });

  it('still replaces an older tick on the same line', async () => {
    const { ticks } = await openTab();
    ticks.enqueue(tick('t1'));
    const newest = ticks.enqueue({ ...tick('t1'), patch: { status: 'open' } });
    expect(ticks.pendingFor('u1')).toEqual([newest]);
  });

  it('moves ticks to the real line and forgets them with it', async () => {
    const { ticks } = await openTab();
    ticks.enqueue(tick('waiting:abc'));
    ticks.retarget('waiting:abc', 'real-1');
    expect(ticks.pendingFor('u1').map((e) => e.taskId)).toEqual(['real-1']);
    ticks.removeForTask('real-1');
    expect(ticks.pendingFor('u1')).toEqual([]);
  });

  it('moves ticks kept under the old single key over, losing none', async () => {
    const old = [
      {
        id: 'a',
        userId: 'u1',
        taskId: 't1',
        listKey: 'running',
        patch: { status: 'done' },
        queuedAt: 1,
      },
      {
        id: 'b',
        userId: 'u1',
        taskId: 't2',
        listKey: 'running',
        patch: { status: 'done' },
        queuedAt: 2,
      },
      { id: 'c', taskId: 't3', listKey: 'running', patch: { status: 'done' }, queuedAt: 3 },
    ];
    localStorage.setItem('mise.pendingTicks', JSON.stringify(old));
    const { ticks } = await openTab();
    expect(ticks.pendingFor('u1').map((e) => e.id)).toEqual(['a', 'b']);
    expect(localStorage.getItem('mise.pendingTicks')).toBeNull();
    ticks.remove('a');
    expect(ticks.pendingFor('u1').map((e) => e.id)).toEqual(['b']);
  });

  it('tells the screen when another tab changes it', async () => {
    const { ticks } = await openTab();
    const before = ticks.queueVersion();
    window.dispatchEvent(new StorageEvent('storage', { key: 'mise.pendingTicks.abc' }));
    expect(ticks.queueVersion()).toBe(before + 1);
  });
});
