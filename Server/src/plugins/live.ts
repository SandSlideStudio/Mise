import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { SESSION_COOKIE } from './auth.js';

/**
 * Live updates: every open screen hears when the kitchen changes something.
 *
 * Deliberately a signal, not the data. The stream only says which part of the
 * kitchen moved ("prep", "recipes", "staff"); the screen then asks for it again
 * over the ordinary API, through the same permission checks as always. So no
 * task, name or recipe ever travels down this connection, and a screen that
 * missed a signal loses nothing a refetch would not fix.
 *
 * Server-sent events rather than websockets: one-way is all this needs, it is
 * plain HTTP, and it passes through a reverse proxy like Caddy untouched.
 */

export type LiveTopic = 'prep' | 'kitchen' | 'staff' | 'menus' | 'recipes';

type Listener = (topic: LiveTopic) => void;

declare module 'fastify' {
  interface FastifyInstance {
    live: {
      publish: (topic: LiveTopic) => void;
      /** Returns the function that stops listening. */
      subscribe: (listener: Listener) => () => void;
      /**
       * A cheap stamp of everything a tablet loads ahead for offline use. It
       * differs after any write to those parts of the kitchen and after a
       * restart, and is the same otherwise. Only ever compared for equality.
       */
      dataVersion: () => string;
    };
  }
}

/** Which writes move which part of the kitchen. Matched against the route. */
const TOPIC_BY_ROUTE: [prefix: string, topic: LiveTopic][] = [
  ['/api/tasks', 'prep'],
  ['/api/running', 'prep'],
  ['/api/checklist', 'prep'],
  ['/api/kitchen', 'kitchen'],
  ['/api/stations', 'kitchen'],
  ['/api/dish-cards', 'kitchen'],
  ['/api/menus', 'menus'],
  // Recipes, ingredients and photos: allergens and dish cards follow from them,
  // so an open card never shows yesterday's allergens.
  ['/api/recipes', 'recipes'],
  ['/api/ingredients', 'recipes'],
  ['/api/photos', 'recipes'],
  ['/api/users', 'staff'],
  // A device asking for outside access, and the answer.
  ['/api/access', 'staff'],
];

/**
 * Writes that change what is loaded ahead for offline use: recipes, menus,
 * dishes, stations, the checklist and card settings. Deliberately not prep
 * ticks or sign-ins, which happen all day and are kept current by the live
 * signals above. Backups and setup are here because a restore or a first-run
 * replaces the lot.
 */
const BUNDLE_ROUTES = [
  '/api/recipes',
  '/api/ingredients',
  '/api/photos',
  '/api/menus',
  '/api/kitchen',
  '/api/stations',
  '/api/dish-cards',
  '/api/checklist',
  '/api/backups',
  '/api/setup',
];

/** Under these, only the listed writes change what is loaded ahead. */
const BUNDLE_ONLY: Record<string, string[]> = {
  // Saving the list itself; adding from it only puts lines on the prep list.
  '/api/checklist': ['PUT /api/checklist'],
};

function movesBundle(method: string, route: string | undefined): boolean {
  if (!route) return false;
  const prefix = BUNDLE_ROUTES.find((p) => route === p || route.startsWith(`${p}/`));
  if (!prefix) return false;
  const only = BUNDLE_ONLY[prefix];
  return !only || only.includes(`${method} ${route}`);
}

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

  // The random part makes a restart look like a change, so tablets load once.
  const boot = randomBytes(4).toString('hex');
  let changes = 0;

  app.decorate('live', {
    dataVersion: () => `${boot}-${changes}`,
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
    const route = request.routeOptions.url;
    if (movesBundle(request.method, route)) changes += 1;
    const topic = topicFor(route);
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
