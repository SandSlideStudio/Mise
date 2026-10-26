import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  addRunningTaskResponseSchema,
  createPrepTaskSchema,
  errorSchema,
  handoverNoteSchema,
  idSchema,
  prepTaskSchema,
  updateHandoverNoteSchema,
  updatePrepTaskSchema,
} from '@mise/contracts';
import { eq } from 'drizzle-orm';
import { isUnitCode } from '@mise/domain';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { kitchens, recipes } from '../../db/schema.js';
import { createPrepService } from './service.js';

/**
 * The prep list.
 *
 * Reading is open to everyone signed in, because the whole point is that the
 * line can see the list. Editing the list is a manager's job, with one
 * deliberate exception: a cook can pick up a task and tick it off, which is
 * the only thing they do with this screen all afternoon.
 */

type TaskRow = Awaited<ReturnType<ReturnType<typeof createPrepService>['listTasks']>>[number];

function serialiseTask(task: TaskRow) {
  return {
    id: task.id,
    stationId: task.stationId,
    recipeId: task.recipeId,
    description: task.description,
    // The column is plain text, so the unit is checked rather than asserted:
    // an unrecognised one drops the quantity instead of failing the response.
    quantity:
      task.quantityBase !== null && task.quantityUnit !== null && isUnitCode(task.quantityUnit)
        ? { value: task.quantityBase, unit: task.quantityUnit }
        : null,
    status: task.status,
    assignedUserId: task.assignedUserId,
    assignedUserName: task.assignedUserName,
    completedByName: task.completedByName,
    completedAt: task.completedAt?.toISOString() ?? null,
    sortOrder: task.sortOrder,
  };
}

const prepRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = createPrepService(app.db);

  /**
   * Anything ticked more than two hours ago has dropped off; if the kitchen
   * deletes rather than keeps those, this is also where they are cleared out.
   */
  r.get(
    '/running/tasks',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(prepTaskSchema), 401: errorSchema } },
    },
    async () => {
      const kitchen = await app.auth.kitchen();
      await svc.expire(kitchen?.tickedRetention ?? 'keep');
      const rows = await svc.listTasks();
      return rows.map(serialiseTask);
    },
  );

  r.post(
    '/running/tasks',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createPrepTaskSchema,
        response: { 200: addRunningTaskResponseSchema, 400: errorSchema, 403: errorSchema },
      },
    },
    async (request) => {
      if (request.body.recipeId) {
        const [recipe] = await app.db
          .select({ id: recipes.id })
          .from(recipes)
          .where(eq(recipes.id, request.body.recipeId))
          .limit(1);
        if (!recipe) throw ApiError.badRequest('That recipe no longer exists.');
      }
      const result = await svc.addTask(request.body);
      if (!result.task) throw new ApiError(500, 'internal_error', 'Could not add that line.');
      return { task: serialiseTask(result.task), merged: result.merged };
    },
  );

  // --- the handover note ---------------------------------------------------

  /** What the last shift left for this one. Everyone reads it; chefs write it. */
  async function readNote() {
    const [kitchen] = await app.db
      .select({
        text: kitchens.handoverNote,
        byName: kitchens.handoverNoteBy,
        at: kitchens.handoverNoteAt,
      })
      .from(kitchens)
      .limit(1);
    return {
      text: kitchen?.text ?? null,
      byName: kitchen?.byName ?? null,
      at: kitchen?.at?.toISOString() ?? null,
    };
  }

  r.get(
    '/running/note',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: handoverNoteSchema, 401: errorSchema } },
    },
    readNote,
  );

  r.put(
    '/running/note',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: updateHandoverNoteSchema,
        response: { 200: handoverNoteSchema, 403: errorSchema },
      },
    },
    async (request) => {
      const text = request.body.text;
      await app.db.update(kitchens).set(
        text
          ? {
              handoverNote: text,
              handoverNoteBy: request.user!.displayName,
              handoverNoteAt: new Date(),
            }
          : { handoverNote: null, handoverNoteBy: null, handoverNoteAt: null },
      );
      return readNote();
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

      // A line gone from the list stays gone. Unticking is refused as if it
      // were never there, and a tablet's retry queue drops the attempt.
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
};

export default prepRoutes;
