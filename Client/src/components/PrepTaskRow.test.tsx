// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PrepTask } from '@mise/contracts';
import { PrepTaskRow } from './PrepTaskRow.js';

/** A ticked line offers a label for the container, in the place Start was. */

afterEach(cleanup);

const task = (status: PrepTask['status']): PrepTask => ({
  id: 't1',
  stationId: null,
  recipeId: null,
  description: 'Fig gel',
  quantity: null,
  status,
  assignedUserId: null,
  assignedUserName: null,
  completedByName: status === 'done' ? 'Marco' : null,
  completedAt: status === 'done' ? new Date().toISOString() : null,
  sortOrder: 0,
  createdByName: null,
  fromChecklist: false,
});

function row(status: PrepTask['status'], onLabel = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(['me'], null);
  render(
    <QueryClientProvider client={queryClient}>
      <ul>
        <PrepTaskRow
          task={task(status)}
          onToggle={() => {}}
          onProgress={() => {}}
          onLabel={onLabel}
        />
      </ul>
    </QueryClientProvider>,
  );
  return onLabel;
}

describe('the label button on a line', () => {
  it('is there once the line is done, and names the line', () => {
    const onLabel = row('done');
    const button = screen.getByRole('button', { name: 'Print a label for Fig gel' });
    expect(button.textContent).toBe('Label');
    fireEvent.click(button);
    expect(onLabel).toHaveBeenCalledOnce();
  });

  it('is not there while the line is still to do', () => {
    row('open');
    expect(screen.queryByRole('button', { name: /label/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start: Fig gel' })).toBeTruthy();
  });
});
