import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createStationSchema,
  createUserSchema,
  errorSchema,
  idSchema,
  kitchenSchema,
  pinOnlyStatusSchema,
  reorderStationsSchema,
  stationSchema,
  updateKitchenSchema,
  updateStationSchema,
  updateUserSchema,
  userSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { currencyOf } from '../recipes/costs.js';
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
      return new ApiError(
        409,
        'last_admin',
        'This is the only administrator left. Promote somebody else first, or nobody will be able to manage this kitchen.',
      );
    case 'self_lockout':
      return new ApiError(409, 'cannot_remove_self', 'You cannot remove your own account.');
    case 'no_credential':
      return new ApiError(
        400,
        'no_way_to_sign_in',
        'That would leave them with no way to sign in. Give them a password or a PIN.',
      );
    case 'password_needs_email':
      return new ApiError(400, 'password_needs_email', 'Password sign-in needs an email address.');
    case 'outranked':
      return new ApiError(
        403,
        'staff_rank',
        'Only an administrator can manage staff at your rank or above.',
      );
    case 'email_taken':
      return new ApiError(409, 'email_taken', 'Someone already has that email address.');
    case 'pin_taken':
      // Never whose: that would hand out someone's PIN.
      return new ApiError(409, 'pin_taken', 'Choose another PIN.');
    case 'pin_too_common':
      return new ApiError(400, 'pin_too_common', 'Pick a less obvious PIN.');
    case 'admin_needs_password':
      return new ApiError(
        400,
        'admin_needs_password',
        'An administrator needs an email and password, not only a PIN.',
      );
  }
}

/**
 * While PIN-only sign-in is on, "Choose another PIN" tells whoever sets one
 * that somebody already has it, and on a tablet that PIN signs in as them.
 * A run of bad luck handing PINs out is a few refusals; more is a search for
 * other people's, the administrator's included. So each person setting PINs
 * gets five refusals in 15 minutes, counting the tries still being checked,
 * and then waits.
 */
const PIN_TAKEN_LIMIT = 5;
const PIN_TAKEN_WINDOW_MS = 15 * 60_000;

function createPinTries(now: () => number = Date.now) {
  const tries = new Map<string, { refused: number[]; checking: number }>();
  return {
    /** Before the check, with no await in between. False: they wait. */
    hold(actorId: string): boolean {
      const state = tries.get(actorId) ?? { refused: [], checking: 0 };
      state.refused = state.refused.filter((at) => at > now() - PIN_TAKEN_WINDOW_MS);
      if (state.refused.length + state.checking >= PIN_TAKEN_LIMIT) return false;
      state.checking += 1;
      tries.set(actorId, state);
      return true;
    },
    release(actorId: string, taken: boolean): void {
      const state = tries.get(actorId);
      if (!state) return;
      state.checking -= 1;
      if (taken) state.refused.push(now());
      if (state.checking === 0 && state.refused.length === 0) tries.delete(actorId);
    },
  };
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
  const pinTries = createPinTries();

  /** Run a change that may set a PIN, counting it against whoever makes it. */
  async function withPinTry<T extends { ok: boolean; error?: KitchenFailure }>(
    actorId: string,
    setsPin: boolean,
    change: () => Promise<T>,
  ): Promise<T> {
    if (!setsPin) return change();
    if (!pinTries.hold(actorId)) {
      throw new ApiError(
        429,
        'pin_tries',
        'Too many PINs that were already taken. Try again in 15 minutes.',
      );
    }
    let taken = false;
    try {
      const result = await change();
      taken = !result.ok && result.error?.kind === 'pin_taken';
      return result;
    } finally {
      pinTries.release(actorId, taken);
    }
  }

  async function describeKitchen(row: NonNullable<Awaited<ReturnType<typeof kitchen.getKitchen>>>) {
    return {
      id: row.id,
      name: row.name,
      language: row.language,
      tickedRetention: row.tickedRetention,
      prepChecklist: row.prepChecklist,
      pinOnly: await kitchen.pinOnlyState(row),
      idleSignOutMinutes: row.idleSignOutMinutes,
      tickedKeepDays: row.tickedKeepDays,
      labelSize: row.labelSize,
      labelOnTick: row.labelOnTick,
      currency: currencyOf(row.currency),
      foodVatPercent: row.foodVatPercent,
    };
  }

  /** A PIN lock is kept in memory, not with the account: shown as the lock it is. */
  function withLock(user: Parameters<typeof serialiseUser>[0]) {
    const pin = app.auth.pinLockedUntil(user.id);
    const lockedUntil =
      pin && (!user.lockedUntil || pin > user.lockedUntil) ? pin : user.lockedUntil;
    return serialiseUser({ ...user, lockedUntil });
  }

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
    async () => (await kitchen.listUsers()).map(withLock),
  );

  r.post(
    '/users',
    {
      onRequest: [app.requireRole('admin', 'head_chef'), app.requirePassword],
      schema: {
        body: createUserSchema,
        response: {
          200: userSchema,
          400: errorSchema,
          403: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await withPinTry(request.user!.id, Boolean(request.body.pin), () =>
        kitchen.createUser(request.body, request.user!),
      );
      if (!result.ok) throw failureToError(result.error);
      return withLock(result.user);
    },
  );

  r.patch(
    '/users/:id',
    {
      onRequest: [app.requireRole('admin', 'head_chef'), app.requirePassword],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateUserSchema,
        response: {
          200: userSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await withPinTry(request.user!.id, Boolean(request.body.pin), () =>
        kitchen.updateUser(request.params.id, request.body, request.user!),
      );
      if (!result.ok) throw failureToError(result.error);
      // A new password or PIN lifts the lock wherever they were locked out.
      if (request.body.password || request.body.pin !== undefined) {
        app.auth.forgetFailures(request.params.id);
      }
      return withLock(result.user);
    },
  );

  /** Lift someone's lock, PIN and password alike, without changing either. */
  r.post(
    '/users/:id/unlock',
    {
      onRequest: [app.requireRole('admin', 'head_chef'), app.requirePassword],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: userSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const result = await kitchen.unlockUser(request.params.id, request.user!);
      if (!result.ok) throw failureToError(result.error);
      app.auth.forgetFailures(request.params.id);
      return withLock(result.user);
    },
  );

  /** Removes someone for good. There is no list of former staff to tidy up. */
  r.delete(
    '/users/:id',
    {
      onRequest: [app.requireRole('admin', 'head_chef'), app.requirePassword],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const result = await kitchen.deleteUser(request.params.id, request.user!);
      if (!result.ok) throw failureToError(result.error);
      app.auth.forgetFailures(request.params.id);
      // Their name is gone from the prep list and the handover note too.
      app.live.publish('prep');
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
      return describeKitchen(row);
    },
  );

  /**
   * Where PIN-only sign-in stands, and who still needs a new PIN: for the
   * administrator who chose it and the head chefs who hand the PINs out.
   */
  r.get(
    '/kitchen/pin-only',
    {
      onRequest: [app.requireRole('admin', 'head_chef')],
      schema: { response: { 200: pinOnlyStatusSchema, 403: errorSchema, 404: errorSchema } },
    },
    async () => {
      const row = await kitchen.getKitchen();
      if (!row) throw ApiError.notFound('This kitchen');
      const waiting = row.pinOnlySince ? await kitchen.waitingForNewPin(row.pinOnlySince) : [];
      return {
        state: !row.pinOnlySince ? 'off' : waiting.length > 0 ? 'waiting' : 'on',
        waiting,
      } as const;
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
      return describeKitchen(row);
    },
  );
};

export default kitchenRoutes;
