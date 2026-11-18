// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { add } from '../lib/outbox.js';
import { OfflineStatus } from './OfflineStatus.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('takes no room in the page while a queued change is going out', () => {
  add({
    id: 'tick-000000001',
    userId: 'user-1',
    method: 'POST',
    path: '/checklist/add',
    body: { ids: ['a'] },
    label: { key: 'offline.label.checklistAdd' },
  });
  const client = new QueryClient();
  client.setQueryData(['me'], { id: 'user-1', displayName: 'Ana', role: 'cook' });
  const { container } = render(
    <QueryClientProvider client={client}>
      <OfflineStatus />
    </QueryClientProvider>,
  );
  expect(container.innerHTML).toBe('');
});
