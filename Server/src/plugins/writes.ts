import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, eq, lt } from 'drizzle-orm';
import { ApiError } from '../lib/errors.js';
import { writeReceipts } from '../db/schema.js';

/**
 * Changes made offline, sent later, made exactly once.
 *
 * A device that saved a change while the server couldn't be reached sends it
 * with its own id in X-Mise-Write. The first time, the change is made and the
 * answer kept. If that answer never reached the device (the connection dropped
 * again mid-send) it sends the same change again, and gets the kept answer
 * back instead of the change happening twice: no double prep line, no second
 * copy of a new recipe.
 *
 * Only successful answers are kept. A refusal or a conflict is answered fresh
 * each time, so a change resent after a conflict is settled goes through.
 * The id is claimed before the change is made, so two sends at the same
 * moment (two tabs, or a resend while the first is still being handled)
 * make it once: the second is asked to try again, and then gets the answer.
 */

declare module 'fastify' {
  interface FastifyInstance {
    /** Forget answers older than a week. */
    purgeWriteReceipts: () => Promise<void>;
  }
  interface FastifyRequest {
    writeKey: string | null;
  }
}

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEEP_DAYS = 7;
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;

function writeId(request: FastifyRequest): string | null {
  const value = request.headers['x-mise-write'];
  return typeof value === 'string' && VALID_ID.test(value) ? value : null;
}

/** A claim still being made. A real answer always has a status of 100 or more. */
const PENDING = 0;
/** A claim older than this was left by a request that never finished: take it over. */
const ABANDONED_MS = 2 * 60 * 1000;

const writesPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('writeKey', null);

  /** Claim the id for this request. False when someone else holds it. */
  async function claim(key: string): Promise<boolean> {
    const claimed = await app.db
      .insert(writeReceipts)
      .values({ key, status: PENDING })
      .onConflictDoNothing()
      .returning({ key: writeReceipts.key });
    return claimed.length > 0;
  }

  // After sign-in is known, before the route runs. The id is claimed first,
  // so the same change sent twice at once runs once: the second waits.
  app.addHook('preHandler', async (request, reply) => {
    if (!WRITES.has(request.method) || !request.user) return;
    const id = writeId(request);
    if (!id) return;
    const key = `${request.user.id}:${id}`;
    if (await claim(key)) {
      request.writeKey = key;
      return;
    }
    const [kept] = await app.db
      .select()
      .from(writeReceipts)
      .where(eq(writeReceipts.key, key))
      .limit(1);
    if (kept && kept.status !== PENDING) {
      reply.code(kept.status).header('x-mise-replayed', '1');
      if (kept.contentType) reply.type(kept.contentType);
      return reply.send(kept.body ?? undefined);
    }
    // Left behind by a request that never finished: this one makes the change.
    if (kept && kept.createdAt.getTime() < Date.now() - ABANDONED_MS) {
      await app.db
        .delete(writeReceipts)
        .where(and(eq(writeReceipts.key, key), eq(writeReceipts.status, PENDING)));
      if (await claim(key)) {
        request.writeKey = key;
        return;
      }
    }
    // The same change is being made right now: the device asks again shortly,
    // and gets that answer.
    reply.header('retry-after', '2');
    throw new ApiError(503, 'write_in_progress', 'That change is being saved. Try again.');
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const key = request.writeKey;
    if (!key) return payload;
    const kept =
      reply.statusCode < 300 &&
      (payload === null || payload === undefined || typeof payload === 'string');
    if (kept) {
      const contentType = reply.getHeader('content-type');
      await app.db
        .update(writeReceipts)
        .set({
          status: reply.statusCode,
          contentType: typeof contentType === 'string' ? contentType : null,
          body: payload ?? null,
          createdAt: new Date(),
        })
        .where(eq(writeReceipts.key, key));
    } else {
      // Refused, or an answer that can't be kept: the next try runs afresh.
      await app.db
        .delete(writeReceipts)
        .where(and(eq(writeReceipts.key, key), eq(writeReceipts.status, PENDING)));
    }
    return payload;
  });

  app.decorate('purgeWriteReceipts', async () => {
    await app.db
      .delete(writeReceipts)
      .where(lt(writeReceipts.createdAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
  });
};

export default fp(writesPlugin, { name: 'writes', dependencies: ['db', 'auth'] });
