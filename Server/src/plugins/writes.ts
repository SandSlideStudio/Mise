import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { eq, lt } from 'drizzle-orm';
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

const writesPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('writeKey', null);

  // After sign-in is known, before the route runs.
  app.addHook('preHandler', async (request, reply) => {
    if (!WRITES.has(request.method) || !request.user) return;
    const id = writeId(request);
    if (!id) return;
    const key = `${request.user.id}:${id}`;
    const [kept] = await app.db
      .select()
      .from(writeReceipts)
      .where(eq(writeReceipts.key, key))
      .limit(1);
    if (kept) {
      reply.code(kept.status).header('x-mise-replayed', '1');
      if (kept.contentType) reply.type(kept.contentType);
      return reply.send(kept.body ?? undefined);
    }
    request.writeKey = key;
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const key = request.writeKey;
    if (!key || reply.statusCode >= 300) return payload;
    if (payload !== null && payload !== undefined && typeof payload !== 'string') return payload;
    const contentType = reply.getHeader('content-type');
    await app.db
      .insert(writeReceipts)
      .values({
        key,
        status: reply.statusCode,
        contentType: typeof contentType === 'string' ? contentType : null,
        body: payload ?? null,
      })
      .onConflictDoNothing();
    return payload;
  });

  app.decorate('purgeWriteReceipts', async () => {
    await app.db
      .delete(writeReceipts)
      .where(lt(writeReceipts.createdAt, new Date(Date.now() - KEEP_DAYS * 86_400_000)));
  });
};

export default fp(writesPlugin, { name: 'writes', dependencies: ['db', 'auth'] });
