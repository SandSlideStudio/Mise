import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import {
  errorSchema,
  onedriveStatusSchema,
  sessionUserSchema,
  setupRequestSchema,
  setupStatusSchema,
  testBackupDestinationSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { safeEqual } from '../../lib/crypto.js';
import { PASSWORD_SESSION_DAYS } from '../auth/service.js';
import { failed } from '../backups/routes.js';
import { validTimeZone } from '../backups/service.js';

/**
 * First run.
 *
 * A freshly deployed server has no users, so there is nobody who could be
 * authorised to create the first one. These two routes exist to close that
 * gap, and they stop existing the moment an account is created: once the user
 * table is not empty, both return 404 for the life of the deployment.
 */
const setupRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Only while nobody has set the kitchen up, and with the setup code when
   * this request needs one. The setup screens send it in the body, or as
   * x-setup-token on the steps before it.
   */
  async function allowed(request: FastifyRequest, given: string | undefined): Promise<void> {
    if (!(await app.auth.needsSetup())) throw ApiError.notFound('This page');
    if (app.setupCodeNeeded(request) && !safeEqual(given ?? '', app.setupToken ?? '')) {
      throw new ApiError(
        403,
        'setup_token',
        'That setup code is wrong. It is SETUP_TOKEN in the settings, or the code Mise printed in its log.',
      );
    }
  }
  const headerToken = (request: FastifyRequest) => {
    const value = request.headers['x-setup-token'];
    return typeof value === 'string' ? value : undefined;
  };

  // --- backups, connected during setup ------------------------------------
  // The same steps as Settings → Backups, open only until the kitchen exists.

  r.post(
    '/backups/test',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
      schema: {
        body: testBackupDestinationSchema,
        response: { 204: z.null(), 400: errorSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      await allowed(request, headerToken(request));
      await app.backups
        .testWebdav({
          url: request.body.webdavUrl,
          username: request.body.webdavUsername ?? null,
          password: request.body.webdavPassword ?? null,
        })
        .catch(failed);
      return reply.status(204).send(null);
    },
  );

  r.get(
    '/onedrive',
    {
      config: { rateLimit: { max: 200, timeWindow: '5 minutes' } },
      schema: { response: { 200: onedriveStatusSchema, 403: errorSchema, 404: errorSchema } },
    },
    async (request) => {
      await allowed(request, headerToken(request));
      return (await app.backups.status()).onedrive;
    },
  );

  r.post(
    '/onedrive',
    {
      config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
      schema: {
        response: {
          200: onedriveStatusSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      await allowed(request, headerToken(request));
      await app.backups.connectOnedrive().catch(failed);
      return (await app.backups.status()).onedrive;
    },
  );

  r.delete(
    '/onedrive',
    {
      schema: { response: { 200: onedriveStatusSchema, 403: errorSchema, 404: errorSchema } },
    },
    async (request) => {
      await allowed(request, headerToken(request));
      await app.backups.disconnectOnedrive();
      return (await app.backups.status()).onedrive;
    },
  );

  // Public on purpose: the sign-in screens need the kitchen's language and name
  // before anyone has signed in, and neither is a secret.
  r.get('/status', { schema: { response: { 200: setupStatusSchema } } }, async (request) => {
    const kitchen = await app.auth.kitchen();
    return {
      needsSetup: await app.auth.needsSetup(),
      language: kitchen?.language ?? 'en',
      kitchenName: kitchen?.name ?? null,
      setupTokenRequired: app.setupCodeNeeded(request),
    };
  });

  r.post(
    '/',
    {
      // Setup is unauthenticated by necessity, so it gets its own tight limit.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: setupRequestSchema,
        response: {
          200: z.object({ user: sessionUserSchema }),
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      await allowed(request, request.body.setupToken);
      const backups = request.body.backups;
      const onedrive = (await app.backups.status()).onedrive;
      if (backups?.destination === 'onedrive' && !onedrive.account) {
        throw ApiError.badRequest('Connect OneDrive first.');
      }

      const result = await app.auth.runSetup(request.body);
      if (!result.ok) {
        throw ApiError.conflict('This server has already been set up.');
      }
      await app.backups.update({
        ...(request.body.timeZone && validTimeZone(request.body.timeZone)
          ? { timeZone: request.body.timeZone }
          : {}),
        ...(backups
          ? {
              destination: backups.destination,
              webdavUrl: backups.webdavUrl ?? null,
              webdavUsername: backups.webdavUsername ?? null,
              ...(backups.webdavPassword ? { webdavPassword: backups.webdavPassword } : {}),
            }
          : {}),
      });
      // Connected on the way, then another choice made: don't keep the sign-in.
      if (onedrive.account && backups?.destination !== 'onedrive') {
        await app.backups.disconnectOnedrive();
      }

      // Sign the new administrator straight in; making them log in again
      // immediately after choosing a password is pointless friction.
      const session = await app.auth.issueSession(result.userId, {
        expiresAt: new Date(Date.now() + PASSWORD_SESSION_DAYS * 86_400_000),
        userAgent: request.headers['user-agent'] ?? null,
      });
      app.setSessionCookie(reply, session.token, session.expiresAt);

      return {
        user: {
          id: result.userId,
          displayName: request.body.displayName,
          email: request.body.email,
          role: 'admin' as const,
          defaultStationId: null,
          kitchenName: request.body.kitchenName,
          language: null,
          kitchenLanguage: request.body.language ?? 'en',
          // Brand new, so the tour is offered once they land in the app.
          tourSeen: false,
          onTablet: false,
        },
      };
    },
  );
};

export default setupRoutes;
