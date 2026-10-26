import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createStationSchema,
  createUserSchema,
  errorSchema,
  idSchema,
  kitchenSchema,
  reorderStationsSchema,
  stationSchema,
  updateKitchenSchema,
  updateStationSchema,
  updateUserSchema,
  userSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { createKitchenService, type KitchenFailure } from './service.js';

/**
 * Managing the brigade. Everything here is behind a role check: cooks can read
 * the station list, because the prep views need it, and nothing else.
 */

function failureToError(failure: KitchenFailure): ApiError {
  switch (failure.kind) {
    case 'not_found':
      return ApiError.notFound('That person');
    case 'last_admin':
      return ApiError.conflict(
        'This is the only administrator left. Promote somebody else first, or nobody will be able to manage this kitchen.',
      );
    case 'self_lockout':
      return ApiError.conflict('You cannot remove your own account.');
    case 'no_credential':
      return ApiError.badRequest(
        'That would leave them with no way to sign in. Give them a password or a PIN.',
      );
    case 'password_needs_email':
      return ApiError.badRequest('Password sign-in needs an email address.');
    case 'outranked':
      return new ApiError(
        403,
        'forbidden',
        'Only an administrator can manage staff at your rank or above.',
      );
    case 'email_taken':
      return ApiError.conflict('Someone already has that email address.');
    case 'admin_needs_password':
      return ApiError.badRequest('An administrator needs an email and password, not only a PIN.');
  }
}

/** Dates leave the API as ISO strings; the schemas expect nothing else. */
function serialiseUser(user: {
  id: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'head_chef' | 'sous_chef' | 'cook';
  defaultStationId: string | null;
  active: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  lockedUntil: Date | null;
}) {
  return { ...user, lockedUntil: user.lockedUntil?.toISOString() ?? null };
}

const kitchenRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const kitchen = createKitchenService(app.db);

  // --- stations -----------------------------------------------------------

  // Readable by anyone signed in: every prep view groups by station.
  r.get(
    '/stations',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(stationSchema), 401: errorSchema } },
    },
    async () => kitchen.listStations(),
  );

  r.post(
    '/stations',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createStationSchema,
        response: { 200: stationSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const station = await kitchen.createStation(request.body);
      if (!station) throw new ApiError(500, 'internal_error', 'Could not create that station.');
      return station;
    },
  );

  r.patch(
    '/stations/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateStationSchema,
        response: { 200: stationSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const station = await kitchen.updateStation(request.params.id, request.body);
      if (!station) throw ApiError.notFound('That station');
      return station;
    },
  );

  r.post(
    '/stations/reorder',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: reorderStationsSchema,
        response: { 200: z.array(stationSchema), 403: errorSchema },
      },
    },
    async (request) => {
      await kitchen.reorderStations(request.body.ids);
      return kitchen.listStations();
    },
  );

  r.delete(
    '/stations/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const removed = await kitchen.deleteStation(request.params.id);
      if (!removed) throw ApiError.notFound('That station');
      return reply.status(204).send(null);
    },
  );

  // --- staff --------------------------------------------------------------

  r.get(
    '/users',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: z.array(userSchema), 403: errorSchema } },
    },
    async () => (await kitchen.listUsers()).map(serialiseUser),
  );

  r.post(
    '/users',
    {
      onRequest: [app.requireRole('admin', 'head_chef')],
      schema: {
        body: createUserSchema,
        response: { 200: userSchema, 400: errorSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const result = await kitchen.createUser(request.body, request.user!);
      if (!result.ok) throw failureToError(result.error);
      return serialiseUser(result.user);
    },
  );

  r.patch(
    '/users/:id',
    {
      onRequest: [app.requireRole('admin', 'head_chef')],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateUserSchema,
        response: {
          200: userSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await kitchen.updateUser(request.params.id, request.body, request.user!);
      if (!result.ok) throw failureToError(result.error);
      // A new password or PIN lifts the lock wherever they were locked out.
      if (request.body.password || request.body.pin !== undefined) {
        app.auth.forgetFailures(request.params.id);
      }
      return serialiseUser(result.user);
    },
  );

  /** Removes someone for good. There is no list of former staff to tidy up. */
  r.delete(
    '/users/:id',
    {
      onRequest: [app.requireRole('admin', 'head_chef')],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await kitchen.deleteUser(request.params.id, request.user!);
      if (!result.ok) throw failureToError(result.error);
      return reply.status(204).send(null);
    },
  );

  // --- kitchen settings ---------------------------------------------------

  r.get(
    '/kitchen',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: kitchenSchema, 401: errorSchema } },
    },
    async () => {
      const row = await kitchen.getKitchen();
      if (!row) throw ApiError.notFound('This kitchen');
      return {
        id: row.id,
        name: row.name,
        unitSystem: row.unitSystem,
        language: row.language,
        tickedRetention: row.tickedRetention,
      };
    },
  );

  r.patch(
    '/kitchen',
    {
      onRequest: [app.requireRole('admin')],
      schema: {
        body: updateKitchenSchema,
        response: { 200: kitchenSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const row = await kitchen.updateKitchen(request.body);
      if (!row) throw ApiError.notFound('This kitchen');
      return {
        id: row.id,
        name: row.name,
        unitSystem: row.unitSystem,
        language: row.language,
        tickedRetention: row.tickedRetention,
      };
    },
  );
};

export default kitchenRoutes;
