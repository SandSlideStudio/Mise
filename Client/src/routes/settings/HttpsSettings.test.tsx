// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Connection } from '@mise/contracts';

/**
 * A kitchen authority from before 2.2.2 may vouch for any website. Settings
 * says so and offers to replace it, asking first, since every tablet then
 * trusts the new one again; a limited authority shows nothing of this.
 */

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/trust">{children}</a>,
}));

const { HttpsSettings } = await import('./HttpsSettings.js');

function connection(constrained: boolean): Connection {
  return {
    outsideDomain: null,
    trustedProxy: null,
    seenProxy: null,
    containerGateway: null,
    trustContainerGateway: false,
    https: {
      port: 3443,
      httpPort: 3000,
      kitchen: {
        enabled: true,
        names: ['192.168.1.50'],
        expiresAt: '2027-11-01T00:00:00.000Z',
        fingerprint: constrained ? 'BB:BB' : 'AA:AA',
        authority: { constrained, createdAt: '2025-03-01T00:00:00.000Z' },
      },
      domain: { enabled: false, domain: null, expiresAt: null, error: null },
    },
    currentHost: '192.168.1.50',
    inside: true,
  };
}

let posted: string[];

beforeEach(() => {
  posted = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(constrained: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(String(url));
      const now = init?.method === 'POST' ? true : constrained;
      return new Response(JSON.stringify(connection(now)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <HttpsSettings />
    </QueryClientProvider>,
  );
}

it('says nothing more for an authority limited to the kitchen network', async () => {
  serve(true);
  await screen.findByText('On the kitchen network');
  expect(screen.queryByText(/can vouch for any website/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Replace the kitchen certificate' })).toBeNull();
});

it('explains an old authority, asks before replacing it, then shows the steps', async () => {
  serve(false);
  await screen.findByText('This kitchen certificate can vouch for any website');
  expect(screen.getByText(/such as a bank’s/)).toBeTruthy();
  expect(screen.getByText(/every tablet and phone shows a warning/)).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Replace the kitchen certificate' }));
  expect(posted).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, replace it' }));

  await screen.findByText(/^Replaced\./);
  expect(posted).toEqual(['/api/connection/kitchen-https/replace-authority']);
  expect(screen.getByText(/open this page on each one/)).toBeTruthy();
  expect(screen.getByText('BB:BB')).toBeTruthy();
  expect(screen.queryByText('This kitchen certificate can vouch for any website')).toBeNull();
});
