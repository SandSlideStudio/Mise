// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSettled } from './useSettled.js';

/** A notice for something that is usually over in a split second. */

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const run = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useSettled', () => {
  it('stays off for a tick that is sent straight away', () => {
    const { result, rerender } = renderHook(({ on }) => useSettled(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    run(300);
    rerender({ on: false });
    run(3000);
    expect(result.current).toBe(false);
  });

  it('comes on once it has lasted a second', () => {
    const { result, rerender } = renderHook(({ on }) => useSettled(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    run(999);
    expect(result.current).toBe(false);
    run(1);
    expect(result.current).toBe(true);
  });

  it('stays on for at least a second and a half, then goes', () => {
    const { result, rerender } = renderHook(({ on }) => useSettled(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    run(1000);
    expect(result.current).toBe(true);
    // Over almost at once: still shown, so it doesn't blink.
    run(200);
    rerender({ on: false });
    run(1299);
    expect(result.current).toBe(true);
    run(1);
    expect(result.current).toBe(false);
  });

  it('goes straight away when it has been shown longer than that', () => {
    const { result, rerender } = renderHook(({ on }) => useSettled(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    run(5000);
    rerender({ on: false });
    run(0);
    expect(result.current).toBe(false);
  });

  it('keeps showing when it comes back before it went', () => {
    const { result, rerender } = renderHook(({ on }) => useSettled(on), {
      initialProps: { on: false },
    });
    rerender({ on: true });
    run(1000);
    rerender({ on: false });
    run(500);
    rerender({ on: true });
    run(5000);
    expect(result.current).toBe(true);
  });
});
