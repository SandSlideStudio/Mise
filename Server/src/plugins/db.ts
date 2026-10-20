import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { createDatabase, type Database } from '../db/client.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

/**
 * Opens the pool on boot and closes it on shutdown. Tests pass their own
 * handle instead, so the suite can run against an in-process Postgres without
 * anyone needing a database installed.
 */
const dbPlugin: FastifyPluginAsync<{ db?: Database }> = async (app, opts) => {
  if (opts.db) {
    app.decorate('db', opts.db);
    return;
  }
  const { db, sql } = createDatabase(app.config.DATABASE_URL);
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await sql.end({ timeout: 5 });
  });
};

export default fp(dbPlugin, { name: 'db', dependencies: ['config'] });
