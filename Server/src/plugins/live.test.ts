import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTopic } from './live.js';
import { setUpKitchen, useTestContext } from '../test/harness.js';

const ctx = useTestContext();
let admin: string;

beforeEach(async () => {
  admin = await setUpKitchen(ctx.app);
});

async function addLine(description: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/running/tasks',
    payload: { description },
    cookies: { mise_session: admin },
  });
  return response.json().task.id;
}

function listen(): LiveTopic[] {
  const heard: LiveTopic[] = [];
  ctx.app.live.subscribe((topic) => heard.push(topic));
  return heard;
}

describe('live updates', () => {
  it('tells everyone when a prep line changes', async () => {
    const id = await addLine('Chicken stock');
    const heard = listen();

    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { status: 'in_progress' },
      cookies: { mise_session: admin },
    });

    await vi.waitFor(() => expect(heard).toContain('prep'));
  });

  it('tells everyone when the kitchen settings change', async () => {
    const heard = listen();
    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/kitchen',
      payload: { tickedRetention: 'delete' },
      cookies: { mise_session: admin },
    });
    await vi.waitFor(() => expect(heard).toContain('kitchen'));
  });

  it('stays quiet about reads and refused writes', async () => {
    const id = await addLine('Chicken stock');
    const heard = listen();

    await ctx.app.inject({
      method: 'GET',
      url: '/api/running/tasks',
      cookies: { mise_session: admin },
    });
    await ctx.app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: { status: 'done' } });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toEqual([]);
  });

  it('only streams to someone signed in', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/events' });
    expect(response.statusCode).toBe(401);
  });

  it('streams the change to an open screen', async () => {
    const id = await addLine('Chicken stock');
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.server.address() as { port: number };

    const abort = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
      headers: { cookie: `mise_session=${admin}` },
      signal: abort.signal,
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    async function readUntil(text: string) {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`Stream ended before "${text}"`);
        received += decoder.decode(value, { stream: true });
      }
    }

    await readUntil('retry:');
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${id}`,
      payload: { status: 'done' },
      cookies: { mise_session: admin },
    });
    await readUntil('event: change');
    expect(received).toContain('data: {"topic":"prep"}');

    abort.abort();
  });
});
