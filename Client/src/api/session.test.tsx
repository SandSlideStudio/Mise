// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ACTIVITY_PING_MS } from '@mise/contracts';
import { RequestFailed } from './client.js';
import { useActivityPing } from './session.js';

/** A shared tablet in use telling the server so, now and then. */

const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => json(200, { user: { id: 'u1' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setUp() {
  const errors: unknown[] = [];
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: (error) => void errors.push(error) }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useActivityPing(), { wrapper });
  return { ping: () => result.current(), errors };
}

const asked = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'));

describe('telling the server a tablet is in use', () => {
  it('asks at most once a minute, however much it is touched', async () => {
    const { ping } = setUp();
    ping();
    ping();
    ping();
    await waitFor(() => expect(asked()).toHaveLength(1));
    vi.setSystemTime(Date.now() + ACTIVITY_PING_MS);
    ping();
    await waitFor(() => expect(asked()).toHaveLength(2));
  });

  it('hands an ended session to the same handling as any other', async () => {
    fetchMock.mockImplementation(() =>
      json(401, { error: { code: 'not_authenticated', message: 'Sign in to continue.' } }),
    );
    const { ping, errors } = setUp();
    ping();
    await waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBeInstanceOf(RequestFailed);
    expect((errors[0] as RequestFailed).isUnauthenticated).toBe(true);
  });
});
