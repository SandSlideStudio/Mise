// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isQueued, QUEUED, sendOrQueue, setOutboxUser } from './client.js';
import { dismissDropped, flush, keepMine } from './outbox.js';
import { entriesFor } from '../lib/outbox.js';
import { isReachable, markReachable } from '../lib/connectivity.js';

/**
 * Changes made while Mise can't be reached: kept on the device, sent in
 * order once it answers, each settled for good.
 */

const ME = 'user-1';
const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const noAnswer = () => Promise.reject(new TypeError('Failed to fetch'));

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  setOutboxUser(ME);
  markReachable();
  dismissDropped();
});
afterEach(() => vi.unstubAllGlobals());

const label = { key: 'offline.label.note' };

describe('sending a change', () => {
  it('goes straight through when Mise answers, with its own id', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { text: 'Fish at 10' }));
    const result = await sendOrQueue('PUT', '/running/note', { text: 'Fish at 10' }, { label });
    expect(result).toEqual({ text: 'Fish at 10' });
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-mise-write']).toMatch(/^[0-9a-f]{32}$/);
    expect(entriesFor(ME)).toHaveLength(0);
  });

  it('is kept on the device when there is no answer, and Mise counts as unreachable', async () => {
    fetchMock.mockImplementationOnce(noAnswer);
    const result = await sendOrQueue(
      'PUT',
      '/running/note',
      { text: 'Fish at 10' },
      { label, base: 'none' },
    );
    expect(isQueued(result)).toBe(true);
    expect(isReachable()).toBe(false);
    expect(entriesFor(ME)).toMatchObject([
      {
        userId: ME,
        method: 'PUT',
        path: '/running/note',
        body: { text: 'Fish at 10' },
        base: 'none',
      },
    ]);
  });

  it('counts a proxy answering for a Mise that is down as no answer', async () => {
    fetchMock.mockResolvedValueOnce(answer(502));
    expect(await sendOrQueue('POST', '/running/tasks', { description: 'Stock' }, { label })).toBe(
      QUEUED,
    );
  });

  it('waits behind changes already waiting, so nothing overtakes', async () => {
    fetchMock.mockImplementationOnce(noAnswer);
    await sendOrQueue('POST', '/running/tasks', { description: 'Stock' }, { label });
    markReachable();
    const second = await sendOrQueue('POST', '/running/tasks', { description: 'Jus' }, { label });
    expect(second).toBe(QUEUED);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      entriesFor(ME).map((entry) => (entry.body as { description: string }).description),
    ).toEqual(['Stock', 'Jus']);
  });

  it('is refused as usual when Mise answers no', async () => {
    fetchMock.mockResolvedValueOnce(answer(403, { error: { code: 'forbidden', message: 'No.' } }));
    await expect(
      sendOrQueue('PUT', '/running/note', { text: 'x' }, { label }),
    ).rejects.toMatchObject({
      status: 403,
    });
    expect(entriesFor(ME)).toHaveLength(0);
  });

  it('keeps each person’s changes as theirs', async () => {
    fetchMock.mockImplementation(noAnswer);
    await sendOrQueue('PUT', '/running/note', { text: 'Mine' }, { label });
    setOutboxUser('user-2');
    expect(entriesFor('user-2')).toHaveLength(0);
    expect(entriesFor(ME)).toHaveLength(1);
  });
});

describe('sending what waited', () => {
  async function waiting(
    ...changes: [method: 'POST' | 'PUT' | 'PATCH', path: string, body: object, base?: string][]
  ) {
    fetchMock.mockImplementation(noAnswer);
    for (const [method, path, body, base] of changes)
      await sendOrQueue(method, path, body, { label, base });
    fetchMock.mockReset();
    markReachable();
  }

  it('sends oldest first, with the same ids, and empties the list', async () => {
    await waiting(
      ['POST', '/running/tasks', { description: 'Stock' }],
      ['POST', '/running/tasks', { description: 'Jus' }],
    );
    const ids = entriesFor(ME).map((entry) => entry.id);
    fetchMock.mockImplementation(() => Promise.resolve(answer(200, {})));
    expect(await flush(ME)).toBe(true);
    const sent = fetchMock.mock.calls.map(([, init]) => [
      JSON.parse(init!.body as string).description,
      (init!.headers as Record<string, string>)['x-mise-write'],
    ]);
    expect(sent).toEqual([
      ['Stock', ids[0]],
      ['Jus', ids[1]],
    ]);
    expect(entriesFor(ME)).toHaveLength(0);
  });

  it('tries a change Mise fails on again later, then sets it aside, and sends the rest meanwhile', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await waiting(
        ['PATCH', '/recipes/r1', { name: 'Tart' }],
        ['PATCH', '/recipes/r1', { name: 'Tart, again' }],
        ['POST', '/running/tasks', { description: 'Stock' }],
      );
      fetchMock.mockImplementation((url) =>
        Promise.resolve(String(url).includes('/recipes/') ? answer(500, {}) : answer(200, {})),
      );
      await flush(ME);
      // The recipe waits to be tried again, its later change behind it; the line went out.
      expect(entriesFor(ME).map((entry) => entry.path)).toEqual(['/recipes/r1', '/recipes/r1']);
      expect(entriesFor(ME)[0]).toMatchObject({ failures: 1 });

      // Not again before its time.
      fetchMock.mockClear();
      await flush(ME);
      expect(fetchMock).not.toHaveBeenCalled();

      for (let round = 0; round < 4; round++) {
        vi.setSystemTime(Date.now() + 10 * 60 * 1000);
        await flush(ME);
      }
      expect(entriesFor(ME)[0]).toMatchObject({ setAside: { status: 500 } });

      // Set aside, it holds up nothing else.
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(answer(200, {}));
      expect(isQueued(await sendOrQueue('PUT', '/running/note', { text: 'x' }, { label }))).toBe(
        false,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops at no answer and keeps the rest for next time', async () => {
    await waiting(
      ['POST', '/running/tasks', { description: 'Stock' }],
      ['POST', '/running/tasks', { description: 'Jus' }],
    );
    fetchMock.mockResolvedValueOnce(answer(200, {})).mockImplementationOnce(noAnswer);
    await flush(ME);
    expect(
      entriesFor(ME).map((entry) => (entry.body as { description: string }).description),
    ).toEqual(['Jus']);
  });

  it('keeps a conflict with what is there now, holds back later changes to the same thing, and sends the rest', async () => {
    await waiting(
      ['PATCH', '/recipes/r1', { name: 'Poached pear tart' }, '2026-01-01T00:00:00.000Z'],
      ['PATCH', '/recipes/r1', { name: 'Poached pear tart, again' }],
      ['POST', '/running/tasks', { description: 'Stock' }],
    );
    fetchMock
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: 'changed_meanwhile',
            message: 'x',
            details: { current: { name: 'Pear and almond tart' } },
          },
        }),
      )
      .mockResolvedValueOnce(answer(200, {}));
    await flush(ME);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const left = entriesFor(ME);
    expect(left).toHaveLength(2);
    expect(left[0]!.conflict).toEqual({ current: { name: 'Pear and almond tart' } });
    expect(left[1]!.conflict).toBeUndefined();

    // Keep mine: sent again without the version it started from.
    keepMine(left[0]!);
    fetchMock.mockReset().mockImplementation(() => Promise.resolve(answer(200, {})));
    await flush(ME);
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-mise-base']).toBeUndefined();
    expect(headers['x-mise-write']).toBe(left[0]!.id);
    expect(entriesFor(ME)).toHaveLength(0);
  });

  it('drops a change refused for good, and says so', async () => {
    await waiting(['PATCH', '/tasks/gone', { description: 'Stock' }]);
    fetchMock.mockResolvedValueOnce(
      answer(404, { error: { code: 'not_found', message: 'Gone.' } }),
    );
    await flush(ME);
    expect(entriesFor(ME)).toHaveLength(0);
  });

  it('keeps everything when signed out, to send after signing in again', async () => {
    await waiting(['POST', '/running/tasks', { description: 'Stock' }]);
    fetchMock.mockResolvedValueOnce(
      answer(401, { error: { code: 'not_authenticated', message: 'x' } }),
    );
    await flush(ME);
    expect(entriesFor(ME)).toHaveLength(1);
  });
});

describe('settling a conflict while sending', () => {
  it('sends "keep mine" straight after the send that was going on', async () => {
    fetchMock.mockImplementation(noAnswer);
    await sendOrQueue(
      'PATCH',
      '/recipes/r1',
      { name: 'Mine' },
      { label, base: '2026-01-01T00:00:00.000Z' },
    );
    await sendOrQueue('POST', '/running/tasks', { description: 'Stock' }, { label });
    markReachable();
    fetchMock.mockReset();

    let release: () => void = () => undefined;
    fetchMock
      .mockResolvedValueOnce(
        answer(409, {
          error: {
            code: 'changed_meanwhile',
            message: 'x',
            details: { current: { name: 'Theirs' } },
          },
        }),
      )
      // The second change is slow to answer; "keep mine" is chosen meanwhile.
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (release = () => resolve(answer(200, {})))),
      )
      .mockImplementation(() => Promise.resolve(answer(200, {})));

    const first = flush(ME);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    keepMine(entriesFor(ME).find((entry) => entry.conflict)!);
    expect(await flush(ME)).toBe(false);
    release();
    await first;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(entriesFor(ME)).toHaveLength(0);
  });
});
