import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  accessRequestSchema,
  accessStatusSchema,
  approveRemoteDeviceSchema,
  errorSchema,
  idSchema,
  remoteDevicesSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { ACCESS_COOKIE, describeAgent } from './service.js';

/**
 * Asking for outside access, and answering. Asking is open to anyone; the
 * answer comes from a chef or an administrator, inside the kitchen or on a
 * device that was itself approved, and then with their password again.
 */
const accessRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/status',
    {
      // The request page asks every few seconds while it waits.
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: { response: { 200: accessStatusSchema } },
    },
    async (request) => {
      if (request.inside) return { status: 'inside' as const, name: null, code: null };
      return app.access.status(request.cookies[ACCESS_COOKIE]);
    },
  );

  r.post(
    '/request',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: accessRequestSchema,
        response: { 200: accessStatusSchema, 404: errorSchema, 409: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      if (await app.auth.needsSetup()) throw ApiError.notFound('This page');
      if (request.inside) {
        throw ApiError.conflict('This device is on the kitchen network and needs no approval.');
      }
      const current = await app.access.status(request.cookies[ACCESS_COOKIE]);
      if (current.status !== 'none') return current;

      const { token, code } = await app.access.ask({
        name: request.body.name,
        userAgent: request.headers['user-agent'] ?? null,
        address: request.ip,
      });
      app.setAccessCookie(reply, token);
      return { status: 'pending' as const, name: request.body.name, code };
    },
  );

  r.get(
    '/devices',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: remoteDevicesSchema, 403: errorSchema } },
    },
    async (request) => {
      const rows = await app.access.list();
      return {
        inside: request.inside,
        devices: rows.map(({ userAgent, ...row }) => ({
          ...row,
          browser: describeAgent(userAgent),
          code: row.status === 'pending' ? row.code : null,
          requestedAt: row.requestedAt.toISOString(),
          approvedAt: row.approvedAt?.toISOString() ?? null,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          thisDevice: row.id === request.remoteDevice?.id,
        })),
      };
    },
  );

  r.post(
    '/devices/:id/approve',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
      schema: {
        params: z.object({ id: idSchema }),
        body: approveRemoteDeviceSchema,
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      // From outside, a signed-in phone that went missing must not be enough.
      if (!request.inside) {
        const result = await app.auth.confirmPassword(
          user.id,
          request.body.password ?? '',
          request.ip,
        );
        if (result === 'no_password') {
          throw new ApiError(
            403,
            'password_needed',
            'Approving from outside needs a password, and this account has none. Approve it from inside the kitchen.',
          );
        }
        if (result === 'wrong') {
          throw new ApiError(403, 'wrong_password', 'That password is not right.');
        }
        if (typeof result === 'object') {
          throw new ApiError(429, 'account_locked', 'Too many wrong passwords. Try again later.', {
            lockedUntil: result.lockedUntil.toISOString(),
          });
        }
      }
      const approved = await app.access.approve(request.params.id, {
        userId: user.id,
        from: request.inside ? null : (request.remoteDevice?.name ?? null),
      });
      if (!approved) throw ApiError.notFound('That request');
      return reply.status(204).send(null);
    },
  );

  r.delete(
    '/devices/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { params: z.object({ id: idSchema }), response: { 204: z.null(), 403: errorSchema } },
    },
    async (request, reply) => {
      await app.access.remove(request.params.id);
      if (request.params.id === request.remoteDevice?.id) {
        reply.clearCookie(ACCESS_COOKIE, { path: '/' });
      }
      return reply.status(204).send(null);
    },
  );
};

export default accessRoutes;
