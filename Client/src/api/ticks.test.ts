// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPending, sendTick } from './ticks.js';
import { enqueue, pendingFor } from '../lib/retryQueue.js';
import { WAITING } from '../lib/outbox.js';
import { noteServerDate, resetServerClock, serverNow } from '../lib/serverClock.js';

/** Ticks: sent with the time they were made, made once, and waiting behind new lines. */

const ME = 'user-1';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetServerClock();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ok = () =>
  Promise.resolve(
    new Response(JSON.stringify({ id: 't1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('a tick', () => {
  it('says how long ago it was made, and carries its own id so it is made once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const entry = enqueue({
      userId: ME,
      taskId: 't1',
      listKey: 'running',
      patch: { status: 'done' },
    });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    fetchMock.mockImplementation(ok);
    await sendTick(entry);
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ status: 'done', doneMsAgo: 3 * 60_000 });
    expect((init.headers as Record<string, string>)['x-mise-write']).toBe(entry.id);
    expect(entry.id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('on a line added offline waits for that line, and is forgotten if the line is', async () => {
    enqueue({
      userId: ME,
      taskId: `${WAITING}gone`,
      listKey: 'running',
      patch: { status: 'done' },
    });
    await sendPending(ME);
    expect(fetchMock).not.toHaveBeenCalled();
    // No waiting line by that id: it was removed before it was sent.
    expect(pendingFor(ME)).toHaveLength(0);
  });
});

describe('the server clock', () => {
  it('follows the time the server answers with, not the tablet’s', () => {
    const sentAt = Date.now();
    // The server is an hour ahead of this tablet.
    noteServerDate(new Date(sentAt + 3_600_000).toUTCString(), sentAt, sentAt);
    expect(serverNow() - Date.now()).toBeGreaterThan(3_590_000);
    expect(serverNow() - Date.now()).toBeLessThan(3_610_000);
  });
});
