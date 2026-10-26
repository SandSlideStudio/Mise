import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { ServerResponse } from 'node:http';
import { SESSION_COOKIE } from './auth.js';

/**
 * Live updates: every open screen hears when the kitchen changes something.
 *
 * Deliberately a signal, not the data. The stream only says which part of the
 * kitchen moved ("prep", "kitchen", "staff"); the screen then asks for it again
 * over the ordinary API, through the same permission checks as always. So no
 * task, name or recipe ever travels down this connection, and a screen that
 * missed a signal loses nothing a refetch would not fix.
 *
 * Server-sent events rather than websockets: one-way is all this needs, it is
 * plain HTTP, and it passes through a reverse proxy like Caddy untouched.
 */

export type LiveTopic = 'prep' | 'kitchen' | 'staff';

type Listener = (topic: LiveTopic) => void;

declare module 'fastify' {
  interface FastifyInstance {
    live: {
      publish: (topic: LiveTopic) => void;
      /** Returns the function that stops listening. */
      subscribe: (listener: Listener) => () => void;
    };
  }
}

/** Which writes move which part of the kitchen. Matched against the route. */
const TOPIC_BY_ROUTE: [prefix: string, topic: LiveTopic][] = [
  ['/api/tasks', 'prep'],
  ['/api/running', 'prep'],
  ['/api/services', 'prep'],
  ['/api/kitchen', 'kitchen'],
  ['/api/stations', 'kitchen'],
  ['/api/dish-cards', 'kitchen'],
  ['/api/users', 'staff'],
];

const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/** Often enough that no proxy or tablet decides the connection is dead. */
const HEARTBEAT_MS = 25_000;

function topicFor(route: string | undefined): LiveTopic | null {
  if (!route) return null;
  for (const [prefix, topic] of TOPIC_BY_ROUTE) {
    if (route === prefix || route.startsWith(`${prefix}/`)) return topic;
  }
  return null;
}

const livePlugin: FastifyPluginAsync = async (app) => {
  const listeners = new Set<Listener>();
  const streams = new Set<ServerResponse>();

  app.decorate('live', {
    publish: (topic: LiveTopic) => {
      for (const listener of listeners) listener(topic);
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  });

  // Publishing from one hook instead of from every route means a new write
  // under these paths is live without anyone remembering to wire it up. Only a
  // write that succeeded changed anything.
  app.addHook('onResponse', async (request, reply) => {
    if (!WRITES.has(request.method) || reply.statusCode >= 400) return;
    const topic = topicFor(request.routeOptions.url);
    if (topic) app.live.publish(topic);
  });

  app.get('/api/events', { onRequest: [app.requireUser] }, (request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx, should someone put it in front, not to hold the stream back.
      'x-accel-buffering': 'no',
    });
    // How long a browser waits before reconnecting after the server restarts.
    raw.write('retry: 3000\n\n');

    const unsubscribe = app.live.subscribe((topic) => {
      raw.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`);
    });
    const token = request.cookies[SESSION_COOKIE];
    const heartbeat = setInterval(() => {
      void (async () => {
        const session = token
          ? await app.auth.resolveSession(token).catch(() => 'unknown' as const)
          : null;
        // Signed out, removed, or tablet revoked: end it. A database hiccup isn't.
        if (session === null) {
          raw.end();
          return;
        }
        raw.write(': still here\n\n');
      })();
    }, HEARTBEAT_MS);
    streams.add(raw);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(raw);
    });
  });

  // An open stream never goes idle, so shutting down would wait on it forever.
  // Browsers reconnect by themselves once the server is back.
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end();
  });
};

export default fp(livePlugin, { name: 'live', dependencies: ['auth'] });
