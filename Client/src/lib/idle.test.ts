// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearActivity, watchIdle, type IdleWatch } from './idle.js';

/** A shared tablet left alone: warned, then signed out, however it was woken. */

const MIN = 60_000;
const START = 1_000_000;

let watch: IdleWatch | undefined;
const onWarning = vi.fn<(seconds: number | null) => void>();
const onExpire = vi.fn<() => void>();

function start(userId = 'u1', limitMin = 5) {
  watch = watchIdle({ userId, limitMs: limitMin * MIN, warnMs: 30_000, onWarning, onExpire });
}

const touch = (type: string = 'pointerdown') => window.dispatchEvent(new Event(type));

beforeEach(() => {
  localStorage.clear();
  onWarning.mockReset();
  onExpire.mockReset();
  vi.useFakeTimers({ now: START });
});
afterEach(() => {
  watch?.stop();
  watch = undefined;
  vi.useRealTimers();
});

describe('signing out a tablet left alone', () => {
  it('warns 30 seconds before the limit, then signs out', () => {
    start();
    vi.advanceTimersByTime(5 * MIN - 31_000);
    expect(onWarning).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(1_000);
    expect(onWarning).toHaveBeenLastCalledWith(30);
    vi.advanceTimersByTime(10_000);
    expect(onWarning).toHaveBeenLastCalledWith(20);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenLastCalledWith(null);
  });

  it('signs out only once', () => {
    start();
    vi.advanceTimersByTime(20 * MIN);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerdown', 'keydown', 'touchstart', 'wheel'])(
    'counts %s as someone being there',
    (type) => {
      start();
      vi.advanceTimersByTime(4 * MIN);
      touch(type);
      vi.advanceTimersByTime(4 * MIN);
      expect(onExpire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(MIN);
      expect(onExpire).toHaveBeenCalledTimes(1);
    },
  );

  it('does not count what the page does by itself', async () => {
    start();
    vi.advanceTimersByTime(2 * MIN);
    // A background refetch, a mouse that only moves, a page that scrolls itself.
    touch('pointermove');
    touch('scroll');
    await Promise.resolve(fetch('/api/running').catch(() => undefined));
    vi.advanceTimersByTime(3 * MIN);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('takes the warning away when someone touches the tablet', () => {
    start();
    vi.advanceTimersByTime(5 * MIN - 10_000);
    expect(onWarning).toHaveBeenLastCalledWith(10);
    touch();
    expect(onWarning).toHaveBeenLastCalledWith(null);
    vi.advanceTimersByTime(MIN);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('lets "tap to stay" count even within the same second as an earlier touch', () => {
    start();
    touch();
    vi.advanceTimersByTime(5 * MIN - 10_000);
    watch!.stay();
    vi.advanceTimersByTime(MIN);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('stops when told to', () => {
    start();
    watch!.stop();
    vi.advanceTimersByTime(20 * MIN);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

describe('several tabs', () => {
  it('agree: touching one keeps the other signed in', () => {
    start();
    vi.advanceTimersByTime(4 * MIN);
    // The other tab saw a touch now.
    localStorage.setItem('mise.lastActivity', JSON.stringify({ userId: 'u1', at: Date.now() }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'mise.lastActivity' }));
    vi.advanceTimersByTime(4 * MIN);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN + 1_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('writes the time of a touch where the other tabs can see it', () => {
    start();
    vi.advanceTimersByTime(2 * MIN);
    touch();
    expect(JSON.parse(localStorage.getItem('mise.lastActivity')!)).toEqual({
      userId: 'u1',
      at: START + 2 * MIN,
    });
  });
});

describe('waking up', () => {
  it('signs out at once when the tablet slept past the limit, before any timer runs', () => {
    start();
    // Asleep: the clock moved on, no timer fired.
    vi.setSystemTime(START + 2 * 60 * MIN);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('signs out on opening when the last touch was long ago', () => {
    localStorage.setItem(
      'mise.lastActivity',
      JSON.stringify({ userId: 'u1', at: START - 60 * MIN }),
    );
    start();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('warns on opening when the limit is nearly up', () => {
    localStorage.setItem(
      'mise.lastActivity',
      JSON.stringify({ userId: 'u1', at: START - 5 * MIN + 12_000 }),
    );
    start();
    expect(onWarning).toHaveBeenLastCalledWith(12);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('does not hold someone else’s old touch against the person who just signed in', () => {
    localStorage.setItem(
      'mise.lastActivity',
      JSON.stringify({ userId: 'someone-else', at: START - 60 * MIN }),
    );
    start('u2');
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5 * MIN);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('starts afresh after the record is cleared by a sign-out', () => {
    localStorage.setItem(
      'mise.lastActivity',
      JSON.stringify({ userId: 'u1', at: START - 60 * MIN }),
    );
    clearActivity();
    start();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('does not wait longer when the clock was set back', () => {
    start();
    vi.setSystemTime(START - 10 * MIN);
    touch('keydown');
    // A touch at the earlier time is the last touch; the limit runs from it.
    vi.advanceTimersByTime(5 * MIN);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('still works with storage blocked', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    start();
    vi.advanceTimersByTime(5 * MIN);
    expect(onExpire).toHaveBeenCalledTimes(1);
    get.mockRestore();
    set.mockRestore();
  });
});
