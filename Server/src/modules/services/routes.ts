import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  addRunningTaskResponseSchema,
  addServiceDishSchema,
  carryOverRequestSchema,
  carryOverResponseSchema,
  createPrepTaskSchema,
  createServiceSchema,
  generatePrepListResponseSchema,
  errorSchema,
  idSchema,
  listPrepTasksQuerySchema,
  listServicesQuerySchema,
  prepTaskSchema,
  serviceDishSchema,
  serviceSchema,
  serviceSummarySchema,
  updatePrepTaskSchema,
  updateServiceSchema,
} from '@mise/contracts';
import { isUnitCode } from '@mise/domain';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { serviceDishes } from '../../db/schema.js';
import { createGenerator } from './generate.js';
import { createServicesService } from './service.js';

/**
 * Services and their prep lists.
 *
 * Reading is open to everyone signed in, because the whole point is that the
 * line can see the list. Editing the list is a manager's job, with one
 * deliberate exception: a cook can pick up a task and tick it off, which is
 * the only thing they do with this screen all afternoon.
 */

type TaskRow = Awaited<ReturnType<ReturnType<typeof createServicesService>['listTasks']>>[number];

function serialiseTask(task: TaskRow) {
  return {
    id: task.id,
    serviceId: task.serviceId,
    stationId: task.stationId,
    kind: task.kind,
    sourceRecipeId: task.sourceRecipeId,
    sourceIngredientId: task.sourceIngredientId,
    description: task.description,
    // The column is plain text, so the unit is checked rather than asserted:
    // an unrecognised one drops the quantity instead of failing the response.
    quantity:
      task.quantityBase !== null && task.quantityUnit !== null && isUnitCode(task.quantityUnit)
        ? { value: task.quantityBase, unit: task.quantityUnit }
        : null,
    source: task.source,
    status: task.status,
    assignedUserId: task.assignedUserId,
    assignedUserName: task.assignedUserName,
    completedByName: task.completedByName,
    completedAt: task.completedAt?.toISOString() ?? null,
    notes: task.notes,
    usedBy: task.usedBy,
    sortOrder: task.sortOrder,
  };
}

const serviceRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = createServicesService(app.db);
  const generator = createGenerator(app.db);

  // --- services -----------------------------------------------------------

  r.get(
    '/services',
    {
      onRequest: [app.requireUser],
      schema: {
        querystring: listServicesQuerySchema,
        response: { 200: z.array(serviceSummarySchema), 401: errorSchema },
      },
    },
    async (request) => {
      const rows = await svc.listServices(request.query);
      return rows.map((row) => ({
        ...row,
        generatedAt: row.generatedAt?.toISOString() ?? null,
      }));
    },
  );

  r.post(
    '/services',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createServiceSchema,
        response: { 200: serviceSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      // The unique index is the real guarantee; this is here so a chef adding
      // a second dinner gets told what happened rather than a database error.
      const clash = await svc.findByDateAndPeriod(request.body.date, request.body.period);
      if (clash) {
        throw ApiError.conflict(
          'There is already a service for that date and period. Open that one instead.',
        );
      }

      const row = await svc.createService(request.body);
      if (!row) throw new ApiError(500, 'internal_error', 'Could not create that service.');
      return { ...row, dishes: [], generatedAt: row.generatedAt?.toISOString() ?? null };
    },
  );

  r.get(
    '/services/:id',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: serviceSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const row = await svc.getServiceRow(request.params.id);
      if (!row) throw ApiError.notFound('That service');
      return {
        ...row,
        dishes: await generator.dishesWithNames(row.id),
        generatedAt: row.generatedAt?.toISOString() ?? null,
      };
    },
  );

  r.patch(
    '/services/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateServiceSchema,
        response: { 200: serviceSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const row = await svc.updateService(request.params.id, request.body);
      if (!row) throw ApiError.notFound('That service');
      return {
        ...row,
        dishes: await generator.dishesWithNames(row.id),
        generatedAt: row.generatedAt?.toISOString() ?? null,
      };
    },
  );

  r.delete(
    '/services/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const removed = await svc.deleteService(request.params.id);
      if (!removed) throw ApiError.notFound('That service');
      return reply.status(204).send(null);
    },
  );

  // --- dishes on a service ------------------------------------------------

  r.post(
    '/services/:id/dishes',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: addServiceDishSchema,
        response: {
          200: z.array(serviceDishSchema),
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const service = await svc.getService(request.params.id);
      if (!service) throw ApiError.notFound('That service');

      await app.db
        .insert(serviceDishes)
        .values({
          serviceId: request.params.id,
          recipeId: request.body.recipeId,
          plannedPortions: request.body.plannedPortions,
        })
        .onConflictDoUpdate({
          target: [serviceDishes.serviceId, serviceDishes.recipeId],
          set: { plannedPortions: request.body.plannedPortions },
        });

      return generator.dishesWithNames(request.params.id);
    },
  );

  r.delete(
    '/services/:id/dishes/:dishId',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema, dishId: idSchema }),
        response: { 200: z.array(serviceDishSchema), 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const removed = await app.db
        .delete(serviceDishes)
        .where(
          and(
            eq(serviceDishes.id, request.params.dishId),
            eq(serviceDishes.serviceId, request.params.id),
          ),
        )
        .returning({ id: serviceDishes.id });
      if (removed.length === 0) throw ApiError.notFound('That dish');
      return generator.dishesWithNames(request.params.id);
    },
  );

  /**
   * The button this whole application exists for.
   *
   * Regenerating merges rather than replaces: hand-added tasks are untouched,
   * finished work stays finished, and only untouched generated lines are
   * brought up to date.
   */
  r.post(
    '/services/:id/generate',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: {
          200: generatePrepListResponseSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      const service = await svc.getService(request.params.id);
      if (!service) throw ApiError.notFound('That service');

      const result = await generator.generate(request.params.id);
      if (!result.ok) {
        throw ApiError.badRequest(
          result.error.kind === 'no_dishes'
            ? 'Add the dishes that are on tonight before generating a prep list.'
            : result.error.message,
        );
      }

      const tasks = await svc.listTasks(request.params.id);
      return { ...result.outcome, tasks: tasks.map(serialiseTask) };
    },
  );

  // --- prep tasks ---------------------------------------------------------

  r.get(
    '/services/:id/tasks',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        querystring: listPrepTasksQuerySchema,
        response: { 200: z.array(prepTaskSchema), 401: errorSchema },
      },
    },
    async (request) => {
      const rows = await svc.listTasks(request.params.id, request.query);
      return rows.map(serialiseTask);
    },
  );

  r.post(
    '/services/:id/tasks',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: createPrepTaskSchema,
        response: { 200: prepTaskSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const service = await svc.getService(request.params.id);
      if (!service) throw ApiError.notFound('That service');

      const task = await svc.createTask(request.params.id, request.body);
      if (!task) throw new ApiError(500, 'internal_error', 'Could not add that task.');
      return serialiseTask(task);
    },
  );

  // --- the running list ---------------------------------------------------

  /**
   * The one list a running-list kitchen keeps. Anything ticked more than two
   * hours ago has dropped off; if the kitchen deletes rather than keeps those,
   * this is also where they are cleared out.
   */
  r.get(
    '/running/tasks',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(prepTaskSchema), 401: errorSchema } },
    },
    async () => {
      const kitchen = await app.auth.kitchen();
      await svc.expireRunning(kitchen?.tickedRetention ?? 'keep');
      const rows = await svc.listRunning();
      return rows.map(serialiseTask);
    },
  );

  r.post(
    '/running/tasks',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createPrepTaskSchema,
        response: { 200: addRunningTaskResponseSchema, 403: errorSchema },
      },
    },
    async (request) => {
      const result = await svc.addToRunning(request.body);
      if (!result.task) throw new ApiError(500, 'internal_error', 'Could not add that line.');
      return { task: serialiseTask(result.task), merged: result.merged };
    },
  );

  /**
   * The one write a cook is allowed. They can start a task, finish it, or put
   * their name against it; they cannot reword it, move it or reassign it to
   * somebody else.
   */
  const COOK_MAY_CHANGE = new Set(['status', 'assignedUserId']);

  r.patch(
    '/tasks/:id',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        body: updatePrepTaskSchema,
        response: { 200: prepTaskSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const user = request.user!;

      if (user.role === 'cook') {
        const attempted = Object.keys(request.body).filter(
          (key) => request.body[key as keyof typeof request.body] !== undefined,
        );
        const forbidden = attempted.filter((key) => !COOK_MAY_CHANGE.has(key));
        if (forbidden.length > 0) {
          throw new ApiError(
            403,
            'forbidden',
            'You can start and finish a task, but only a chef can change what it says.',
          );
        }
        // A cook may claim a task or drop it, not hand it to somebody else.
        if (
          request.body.assignedUserId !== undefined &&
          request.body.assignedUserId !== null &&
          request.body.assignedUserId !== user.id
        ) {
          throw new ApiError(403, 'forbidden', 'You can only put your own name against a task.');
        }
      }

      // A line gone from the running list stays gone. Unticking is refused as
      // if it were never there, and a tablet's retry queue drops the attempt.
      const existing = await svc.getTask(request.params.id);
      if (!existing || svc.isGone(existing)) throw ApiError.notFound('That task');

      const task = await svc.updateTask(request.params.id, request.body, user.id);
      if (!task) throw ApiError.notFound('That task');
      return serialiseTask(task);
    },
  );

  r.delete(
    '/tasks/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const removed = await svc.deleteTask(request.params.id);
      if (!removed) throw ApiError.notFound('That task');
      return reply.status(204).send(null);
    },
  );

  r.post(
    '/services/:id/carry-over',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: carryOverRequestSchema,
        response: {
          200: carryOverResponseSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      const target = request.params.id;
      if (target === request.body.fromServiceId) {
        throw ApiError.badRequest('That is the same service.');
      }
      const [to, from] = await Promise.all([
        svc.getService(target),
        svc.getService(request.body.fromServiceId),
      ]);
      if (!to || !from) throw ApiError.notFound('That service');

      const result = await svc.carryOver(target, request.body.fromServiceId);
      return { ...result, tasks: result.tasks.map(serialiseTask) };
    },
  );
};

export default serviceRoutes;
