import Fastify, { LogController, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { mkdir } from 'node:fs/promises';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import path from 'node:path';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import configPlugin from './plugins/config.js';
import dbPlugin from './plugins/db.js';
import authPlugin from './plugins/auth.js';
import errorsPlugin from './plugins/errors.js';
import livePlugin from './plugins/live.js';
import securityPlugin from './plugins/security.js';
import { VERSION } from './lib/version.js';
import { generateToken } from './lib/crypto.js';
import setupRoutes from './modules/setup/routes.js';
import authRoutes from './modules/auth/routes.js';
import kitchenRoutes from './modules/kitchen/routes.js';
import prepRoutes from './modules/prep/routes.js';
import ingredientRoutes from './modules/ingredients/routes.js';
import recipeRoutes from './modules/recipes/routes.js';
import photoRoutes from './modules/recipes/photos.js';
import backupRoutes from './modules/backups/routes.js';
import dishCardRoutes from './modules/dishcards/routes.js';
import { createBackupService, type BackupService } from './modules/backups/service.js';
import { createOnedrive } from './modules/backups/onedrive.js';

/**
 * The server is one deployable unit: it answers the API under /api and serves
 * the built client for everything else. Same origin means no CORS, no server
 * address to configure in the browser, and one thing for an admin to run.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** The code first-run setup must be given, or null when none is needed. */
    setupToken: string | null;
    backups: BackupService;
  }
}

export interface BuildAppOptions {
  /** Supply a database handle instead of opening one. Used by the test suite. */
  db?: Database;
  /** Skip serving the built client. Used by the test suite. */
  serveClient?: boolean;
  /** Where Microsoft's sign-in and Graph live. Pointed at a stand-in by the test suite. */
  microsoft?: { login: string; graph: string; chunkBytes?: number };
}

function trustedHops(hops: number | false) {
  return hops === false ? false : (_address: string, hop: number) => hop < hops;
}

export async function buildApp(
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'test' ? 'silent' : 'info',
      transport:
        config.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    // Only believe X-Forwarded-For when the admin says a proxy is in front,
    // and then only as many hops as there are proxies.
    trustProxy: trustedHops(config.TRUST_PROXY),
    // Errors are still logged. A line for every request is noise in a kitchen,
    // and on a Raspberry Pi's SD card each one is a write.
    logController: new LogController({ disableRequestLogging: config.NODE_ENV === 'production' }),
    bodyLimit: 2 * 1024 * 1024,
  });

  // Production setup needs a one-time code; development and tests don't.
  app.decorate(
    'setupToken',
    config.NODE_ENV === 'production' ? (config.SETUP_TOKEN ?? generateToken(18)) : null,
  );

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(configPlugin, { config });
  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });
  await app.register(dbPlugin, { db: options.db });
  await app.register(authPlugin);
  await app.register(livePlugin);
  app.decorate(
    'backups',
    createBackupService({
      db: app.db,
      uploadDir: path.resolve(config.UPLOAD_DIR),
      backupDir: path.resolve(config.BACKUP_DIR),
      log: app.log,
      onedrive: createOnedrive({ clientId: config.ONEDRIVE_CLIENT_ID, ...options.microsoft }),
    }),
  );
  app.addHook('onClose', async () => app.backups.close());

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    version: VERSION,
    time: new Date().toISOString(),
  }));

  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(kitchenRoutes, { prefix: '/api' });
  await app.register(prepRoutes, { prefix: '/api' });
  await app.register(ingredientRoutes, { prefix: '/api' });
  await app.register(multipart);
  await app.register(recipeRoutes, { prefix: '/api' });
  await app.register(photoRoutes, { prefix: '/api' });
  await app.register(dishCardRoutes, { prefix: '/api' });
  await app.register(backupRoutes, { prefix: '/api' });
  await registerUploads(app, config);

  if (options.serveClient === false) {
    setApiNotFoundHandler(app);
  } else {
    await registerClient(app, config);
  }

  return app;
}

/**
 * Serve uploaded photographs off the mounted volume.
 *
 * Behind the same session check as everything else, because a plating photo is
 * a kitchen's own work and there is no reason for it to be public. The route
 * only ever joins a single generated filename onto the upload directory, so a
 * path from the URL can never climb out of it.
 */
async function registerUploads(app: FastifyInstance, config: Config): Promise<void> {
  const uploadDir = path.resolve(config.UPLOAD_DIR);
  await mkdir(uploadDir, { recursive: true });

  app.get<{ Params: { name: string } }>(
    '/api/uploads/:name',
    { onRequest: [app.requireUser] },
    async (request, reply) => {
      const name = path.basename(request.params.name);
      const absolute = path.join(uploadDir, name);
      if (!existsSync(absolute)) {
        return reply
          .status(404)
          .send({ error: { code: 'not_found', message: 'That file is not here.' } });
      }
      return reply.type(contentTypeFor(name)).send(createReadStream(absolute));
    },
  );
}

function contentTypeFor(name: string): string {
  switch (path.extname(name).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    default:
      return 'image/jpeg';
  }
}

/**
 * Serve the built client, falling back to index.html so the router can handle
 * deep links. Skipped when the bundle is absent, which is the normal state
 * during development because Vite serves it instead.
 */
async function registerClient(app: FastifyInstance, config: Config): Promise<void> {
  const clientDir = findClientDir(config.CLIENT_DIR);

  if (!clientDir) {
    app.log.warn(
      { hint: config.CLIENT_DIR },
      'No built client found. Run the Vite dev server, or build the client before deploying.',
    );
    setApiNotFoundHandler(app);
    return;
  }

  await app.register(fastifyStatic, { root: clientDir, wildcard: false });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({
        error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
      });
    }
    return reply.sendFile('index.html');
  });
}

/** Plain JSON for anything unrouted. Used when no client bundle is served. */
function setApiNotFoundHandler(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
    }),
  );
}

/**
 * Locate the built client.
 *
 * An absolute CLIENT_DIR is taken at its word. A relative one is searched for
 * by walking up from this module, because the same code runs from Server/src
 * during development and from Server/dist inside the image, and those two
 * layouts are different distances from the bundle.
 */
function findClientDir(hint: string): string | null {
  const isBuilt = (dir: string) => existsSync(path.join(dir, 'index.html'));

  if (path.isAbsolute(hint)) return isBuilt(hint) ? hint : null;

  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.resolve(dir, hint);
    if (isBuilt(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
