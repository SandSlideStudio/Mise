import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  deviceSchema,
  enrollDeviceRequestSchema,
  enrollDeviceResponseSchema,
  errorSchema,
  idSchema,
  loginRequestSchema,
  pinLoginRequestSchema,
  rosterEntrySchema,
  sessionUserSchema,
  updateMeSchema,
  type Language,
  type Role,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { DEVICE_COOKIE, MANAGERS } from '../../plugins/auth.js';
import { DEVICE_TOKEN_DAYS, type AuthFailure } from './service.js';

/**
 * Two ways in, one session table.
 *
 * Managers sign in with email and password from anywhere. Line cooks tap their
 * name and a PIN, but only on a tablet an administrator enrolled, because four
 * digits exposed to an open network would not survive an afternoon.
 */

function failureToError(failure: AuthFailure): ApiError {
  switch (failure.kind) {
    case 'locked':
      return new ApiError(
        429,
        'account_locked',
        `Too many failed attempts. Try again after ${failure.until.toLocaleTimeString()}.`,
        { until: failure.until.toISOString() },
      );
    case 'inactive':
      return new ApiError(403, 'account_inactive', 'That account is no longer active.');
    case 'device_not_enrolled':
      return new ApiError(
        403,
        'device_not_enrolled',
        'PIN sign-in only works on an enrolled tablet.',
      );
    case 'invalid_credentials':
      // Deliberately vague: never confirm which half was wrong.
      return new ApiError(401, 'invalid_credentials', 'That did not match. Try again.');
  }
}

/** Who is signed in, as every route that answers with a person describes them. */
function describeUser(
  user: {
    id: string;
    displayName: string;
    email: string | null;
    role: Role;
    defaultStationId: string | null;
    language: Language | null;
    tourSeen: boolean;
    deviceId: string | null;
  },
  kitchen: { name: string; language: Language } | null,
) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    defaultStationId: user.defaultStationId,
    kitchenName: kitchen?.name ?? 'Mise',
    language: user.language,
    kitchenLanguage: kitchen?.language ?? 'en',
    tourSeen: user.tourSeen,
    onTablet: user.deviceId !== null,
  };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Both sign-in routes end the same way: set the cookie, then describe who
   * just signed in.
   */
  async function completeSignIn(reply: FastifyReply, result: { token: string; expiresAt: Date }) {
    app.setSessionCookie(reply, result.token, result.expiresAt);
    const session = await app.auth.resolveSession(result.token);
    if (!session) throw new ApiError(500, 'internal_error', 'Could not start a session.');
    const kitchen = await app.auth.kitchen();
    return {
      user: describeUser(
        { ...session, id: session.userId, tourSeen: session.tourSeenAt !== null },
        kitchen,
      ),
    };
  }

  r.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
      schema: {
        body: loginRequestSchema,
        response: {
          200: z.object({ user: sessionUserSchema }),
          401: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await app.auth.loginWithPassword(
        request.body.email,
        request.body.password,
        request.headers['user-agent'] ?? null,
      );
      if (!result.ok) throw failureToError(result.error);
      return completeSignIn(reply, result.session);
    },
  );

  /**
   * The names a shared tablet offers. Only staff who actually have a PIN
   * appear, and only on an enrolled device, so this is not a staff directory
   * anyone on the network can read.
   */
  r.get(
    '/roster',
    {
      onRequest: [app.requireDevice],
      schema: { response: { 200: z.array(rosterEntrySchema), 403: errorSchema } },
    },
    async () => app.auth.roster(),
  );

  r.post(
    '/pin-login',
    {
      onRequest: [app.requireDevice],
      config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
      schema: {
        body: pinLoginRequestSchema,
        response: {
          200: z.object({ user: sessionUserSchema }),
          401: errorSchema,
          403: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const deviceId = request.deviceId;
      if (!deviceId) throw failureToError({ kind: 'device_not_enrolled' });

      const result = await app.auth.loginWithPin(
        request.body.userId,
        request.body.pin,
        deviceId,
        request.headers['user-agent'] ?? null,
      );
      if (!result.ok) throw failureToError(result.error);
      return completeSignIn(reply, result.session);
    },
  );

  r.post('/logout', { schema: { response: { 204: z.null() } } }, async (request, reply) => {
    const token = request.cookies['mise_session'];
    if (token) await app.auth.revokeSession(token);
    app.clearSessionCookie(reply);
    return reply.status(204).send(null);
  });

  r.get(
    '/me',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.object({ user: sessionUserSchema }), 401: errorSchema } },
    },
    async (request) => ({ user: describeUser(request.user!, await app.auth.kitchen()) }),
  );

  /**
   * What anyone may change about themselves: which language the interface
   * speaks to them (null goes back to following the kitchen), and that they
   * have been offered the tour.
   */
  r.patch(
    '/me',
    {
      onRequest: [app.requireUser],
      schema: {
        body: updateMeSchema,
        response: { 200: z.object({ user: sessionUserSchema }), 401: errorSchema },
      },
    },
    async (request) => {
      const user = request.user!;
      const { language, tourSeen } = request.body;
      if (language !== undefined) await app.auth.setLanguage(user.id, language);
      if (tourSeen) await app.auth.markTourSeen(user.id);
      const kitchen = await app.auth.kitchen();
      return {
        user: describeUser(
          {
            ...user,
            language: language !== undefined ? language : user.language,
            tourSeen: user.tourSeen || tourSeen === true,
          },
          kitchen,
        ),
      };
    },
  );

  // --- device enrollment --------------------------------------------------

  /**
   * An administrator signs in on the tablet and enrols it from there, so the
   * token goes straight into a cookie on the device that needs it and never
   * has to be read out or typed in.
   */
  r.post(
    '/devices',
    {
      onRequest: [app.requireRole('admin')],
      schema: {
        body: enrollDeviceRequestSchema,
        response: { 200: enrollDeviceResponseSchema, 403: errorSchema },
      },
    },
    async (request, reply) => {
      const device = await app.auth.enrollDevice(request.body.name);
      reply.setCookie(DEVICE_COOKIE, device.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: app.config.COOKIE_SECURE,
        path: '/',
        expires: new Date(Date.now() + DEVICE_TOKEN_DAYS * 86_400_000),
      });
      return { id: device.id, name: request.body.name, token: device.token };
    },
  );

  r.get(
    '/devices',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: z.array(deviceSchema), 403: errorSchema } },
    },
    async () => {
      const rows = await app.auth.listDevices();
      return rows.map((d) => ({
        id: d.id,
        name: d.name,
        enrolledAt: d.enrolledAt.toISOString(),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
      }));
    },
  );

  r.delete(
    '/devices/:id',
    {
      onRequest: [app.requireRole('admin')],
      schema: { params: z.object({ id: idSchema }), response: { 204: z.null(), 403: errorSchema } },
    },
    async (request, reply) => {
      await app.auth.revokeDevice(request.params.id);
      return reply.status(204).send(null);
    },
  );
};

export default authRoutes;
