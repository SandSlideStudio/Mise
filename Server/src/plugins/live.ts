import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { ApiError } from '../lib/errors.js';
import { ACCESS_COOKIE } from '../modules/access/service.js';
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
 * replaces the lot. Staff, because the bundle names who changed a dish's
 * allergens: someone renamed or removed for good must not stay named in it.
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
  '/api/users',
];

/** Under these, only the listed writes change what is loaded ahead. */
const BUNDLE_ONLY: Record<string, string[]> = {
  // Saving the list itself; adding from it only puts lines on the prep list.
  '/api/checklist': ['PUT /api/checklist'],
  // Someone new isn't named anywhere yet, and a lock lifted names no one.
  '/api/users': ['PATCH /api/users/:id', 'DELETE /api/users/:id'],
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

/**
 * Open streams one person may hold. A browser opens at most six connections
 * to a server, so this is far more than their phone, tablet and laptop
 * together need. Each stream stays open for hours and asks the database
 * about its sign-in every heartbeat: without a limit, one account could
 * open thousands and wear a Raspberry Pi down.
 */
export const MAX_STREAMS_PER_PERSON = 20;

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
  /** Open streams by whose they are. */
  const open = new Map<string, number>();

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
    const person = request.user!.id;
    const held = open.get(person) ?? 0;
    if (held >= MAX_STREAMS_PER_PERSON) {
      // The screen tries again by itself a few seconds later.
      throw new ApiError(429, 'too_many_streams', 'Too many screens open. Close a few.');
    }
    open.set(person, held + 1);
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
    // Let in from outside as an approved device: that approval has to last too.
    const device = request.remoteDevice ? request.cookies[ACCESS_COOKIE] : undefined;
    const heartbeat = setInterval(() => {
      void (async () => {
        const session = token
          ? await app.auth.resolveSession(token).catch(() => 'unknown' as const)
          : null;
        const approved = device
          ? await app.access.approved(device).catch(() => 'unknown' as const)
          : 'inside';
        // Signed out, removed, tablet revoked, or the outside device taken off
        // the list (a lost phone, say): end it. A database hiccup isn't.
        if (session === null || approved === null) {
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
      const left = (open.get(person) ?? 1) - 1;
      if (left > 0) open.set(person, left);
      else open.delete(person);
    });
  });

  // An open stream never goes idle, so shutting down would wait on it forever.
  // Browsers reconnect by themselves once the server is back.
  app.addHook('preClose', async () => {
    for (const stream of streams) stream.end();
  });
};

export default fp(livePlugin, { name: 'live', dependencies: ['auth', 'access'] });
