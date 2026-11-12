// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { add } from '../lib/outbox.js';
import { OfflineStatus } from './OfflineStatus.js';

/** The conflict dialog, used with a keyboard and a screen reader. */

const ME = { id: 'user-1', displayName: 'Ana', role: 'chef' };

function showConflict() {
  add({
    id: 'edit-0000000001',
    userId: ME.id,
    method: 'PATCH',
    path: '/recipes/r1',
    body: { name: 'Poached pear tart' },
    label: { key: 'offline.label.recipe', vars: { name: 'Pear tart' } },
    conflict: { current: { name: 'Pear and almond tart' } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(['me'], ME);
  return render(
    <QueryClientProvider client={client}>
      <button type="button">Behind</button>
      <OfflineStatus />
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('the conflict dialog', () => {
  it('takes the focus when it opens', () => {
    showConflict();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 }));
    expect(screen.getByRole('dialog')).toHaveProperty('ariaModal', 'true');
  });

  it('keeps Tab inside', () => {
    showConflict();
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('[role="dialog"]'));
    buttons.at(-1)!.focus();
    fireEvent.keyDown(buttons.at(-1)!, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('puts the choice off with Escape, and brings it back from the notice', () => {
    showConflict();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
