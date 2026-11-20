// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionUser } from '@mise/contracts';
import { IdleSignOut } from './IdleSignOut.js';

/** The notice before a shared tablet signs out, and the sign-out itself. */

const kitchen = vi.hoisted(() => ({ data: { idleSignOutMinutes: 5 as number | null } }));
const mutate = vi.hoisted(() => vi.fn());
const ping = vi.hoisted(() => vi.fn());
vi.mock('../api/kitchen.js', () => ({ useKitchen: () => kitchen }));
vi.mock('../api/session.js', () => ({
  useLogout: () => ({ mutate }),
  useActivityPing: () => ping,
}));

const user = (onTablet: boolean) => ({ id: 'u1', onTablet }) as SessionUser;
const MIN = 60_000;

beforeEach(() => {
  localStorage.clear();
  mutate.mockReset();
  ping.mockReset();
  kitchen.data.idleSignOutMinutes = 5;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('signing out a shared tablet', () => {
  it('shows a calm notice, and tapping to stay takes it away', () => {
    render(<IdleSignOut user={user(true)} />);
    expect(screen.queryByText(/Signing out in/)).toBeNull();
    act(() => void vi.advanceTimersByTime(5 * MIN - 20_000));
    expect(screen.getByText(/Signing out in 20 seconds/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(screen.queryByText(/Signing out in/)).toBeNull();
    act(() => void vi.advanceTimersByTime(MIN));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('signs out the way the button does, covering the screen meanwhile', () => {
    render(<IdleSignOut user={user(true)} />);
    act(() => void vi.advanceTimersByTime(5 * MIN));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Signing out…')).toBeTruthy();
  });

  it('does nothing when the kitchen has not chosen a time', () => {
    kitchen.data.idleSignOutMinutes = null;
    render(<IdleSignOut user={user(true)} />);
    act(() => void vi.advanceTimersByTime(600 * MIN));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('leaves a signed-in phone or laptop alone', () => {
    render(<IdleSignOut user={user(false)} />);
    act(() => void vi.advanceTimersByTime(600 * MIN));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('uncovers the screen and tries again later when signing out fails', () => {
    render(<IdleSignOut user={user(true)} />);
    act(() => void vi.advanceTimersByTime(5 * MIN));
    const options = mutate.mock.calls[0]![1] as { onError: () => void };
    act(() => options.onError());
    expect(screen.queryByText('Signing out…')).toBeNull();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('tells the server the tablet is in use whenever it is touched', () => {
    render(<IdleSignOut user={user(true)} />);
    fireEvent.pointerDown(window);
    expect(ping).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(5 * MIN - 20_000));
    fireEvent.click(screen.getByRole('button', { name: 'Stay signed in' }));
    expect(ping.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
