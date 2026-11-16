// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Roster } from '@mise/contracts';

/** The tablet's sign-in screen when the kitchen signs in by PIN alone. */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/login">{children}</a>,
  useNavigate: () => () => Promise.resolve(),
}));

const { Line } = await import('./Line.js');

let roster: Roster;
let sent: { url: string; body: unknown }[];
let answer: () => Response;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  localStorage.clear();
  sent = [];
  answer = () => json(200, { user: { displayName: 'Marco' } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/roster')) return json(200, roster);
      if (url.endsWith('/setup/status')) {
        return json(200, { needsSetup: false, language: 'en', kitchenName: 'Test' });
      }
      sent.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return answer();
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function show(next: Roster) {
  roster = next;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Line />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: '5' });
}

async function press(...keys: string[]) {
  for (const key of keys) {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: key }));
    });
  }
}

describe('PIN-only sign-in on the tablet', () => {
  it('shows only the keypad, with no names, and waits for OK', async () => {
    await show({ mode: 'pin', people: [], pinLength: null });
    expect(screen.queryByText('Not me')).toBeNull();
    expect(screen.getByText('Type your PIN, then press OK.')).toBeTruthy();

    await press('4', '8', '2', '1');
    expect(sent).toEqual([]);
    await press('9', '3', 'OK');
    expect(sent).toEqual([{ url: '/api/auth/pin-only-login', body: { pin: '482193' } }]);
    expect(await screen.findByText('Welcome, Marco.')).toBeTruthy();
  });

  it('signs in on the last digit when every PIN has the same length', async () => {
    await show({ mode: 'pin', people: [], pinLength: 4 });
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    await press('4', '8', '2', '1');
    expect(sent).toEqual([{ url: '/api/auth/pin-only-login', body: { pin: '4821' } }]);
  });

  it('shakes its head at a wrong PIN and starts again', async () => {
    answer = () =>
      json(401, { error: { code: 'invalid_credentials', message: 'That did not match.' } });
    await show({ mode: 'pin', people: [], pinLength: 4 });
    await press('5', '0', '5', '0');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That didn’t match. Try again.');
    expect(screen.getByRole('status').className).toContain('shake');
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('0 digits entered');
  });

  it('says how long a locked tablet waits', async () => {
    const until = new Date(Date.now() + 15 * 60_000).toISOString();
    answer = () =>
      json(429, { error: { code: 'tablet_locked', message: 'Too many.', details: { until } } });
    await show({ mode: 'pin', people: [], pinLength: 4 });
    await press('5', '0', '5', '0');
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /^Too many wrong PINs on this tablet\. Try again after .+, or ask a head chef to lift the lock\.$/,
    );
  });

  it('still shows the names when the kitchen signs in that way', async () => {
    roster = {
      mode: 'names',
      pinLength: null,
      people: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          displayName: 'Anna',
          role: 'cook',
          defaultStationId: null,
          stationName: 'Pastry',
          pinLength: 4,
        },
      ],
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Line />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Anna')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '5' })).toBeNull();
  });
});
