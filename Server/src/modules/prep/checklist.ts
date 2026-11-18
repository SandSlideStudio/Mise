import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  addFromChecklistResponseSchema,
  addFromChecklistSchema,
  checklistSchema,
  errorSchema,
  updateChecklistSchema,
} from '@mise/contracts';
import { asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Executor } from '../../db/client.js';
import { ApiError } from '../../lib/errors.js';
import { ensureUnchanged } from '../../lib/conflict.js';
import { MANAGERS } from '../../plugins/auth.js';
import { kitchens, prepChecklistItems, recipes, stations } from '../../db/schema.js';
import { createPrepService } from './service.js';

/**
 * The chef's checklist on the prep list.
 *
 * Anyone signed in can read it and tick what is needed onto the list: that is
 * the whole point of it, for a cook who can't always remember what the
 * kitchen needs. Only a chef changes what is on it, and always the whole list
 * at once, so one save is one version for the "someone changed this" check.
 */

/** Station order is how the kitchen is laid out; items with no station come last. */
const ITEM_ORDER = [
  sql`${stations.sortOrder} asc nulls last`,
  asc(prepChecklistItems.sortOrder),
  asc(prepChecklistItems.createdAt),
];

/** The checklist as the API shows it. Also read by the bundle for offline use. */
export function createChecklistReader(db: Executor) {
  async function readItems(exec: Executor = db) {
    return exec
      .select({
        id: prepChecklistItems.id,
        stationId: prepChecklistItems.stationId,
        name: prepChecklistItems.name,
        recipeId: prepChecklistItems.recipeId,
      })
      .from(prepChecklistItems)
      .leftJoin(stations, eq(stations.id, prepChecklistItems.stationId))
      .orderBy(...ITEM_ORDER);
  }

  async function readChecklist(exec: Executor = db) {
    const [kitchen] = await exec
      .select({ on: kitchens.prepChecklist, at: kitchens.prepChecklistUpdatedAt })
      .from(kitchens)
      .limit(1);
    return {
      enabled: kitchen?.on ?? false,
      items: await readItems(exec),
      updatedAt: (kitchen?.at ?? new Date(0)).toISOString(),
    };
  }

  return { readItems, readChecklist };
}

const checklistRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const prep = createPrepService(app.db);
  const { readItems, readChecklist } = createChecklistReader(app.db);

  r.get(
    '/checklist',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: checklistSchema, 401: errorSchema } },
    },
    () => readChecklist(),
  );

  r.put(
    '/checklist',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: updateChecklistSchema,
        response: {
          200: checklistSchema,
          400: errorSchema,
          403: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const ids = request.body.items.flatMap((item) => (item.id ? [item.id] : []));
      if (new Set(ids).size !== ids.length) {
        throw new ApiError(400, 'validation_failed', 'An item is in the list twice.');
      }

      return app.db.transaction(async (tx) => {
        // One save at a time, so the check below and the write after it
        // can't be split by another chef's save.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mise-prep-checklist'))`);
        const before = await readChecklist(tx);
        await ensureUnchanged(request, new Date(before.updatedAt), () => before);

        // What the chef no longer has is gone; the rest keeps its id, so a tablet
        // that ticked an item a moment ago still means the same one.
        await tx
          .delete(prepChecklistItems)
          .where(ids.length > 0 ? notInArray(prepChecklistItems.id, ids) : sql`true`);

        const known = new Set(
          ids.length > 0
            ? (
                await tx
                  .select({ id: prepChecklistItems.id })
                  .from(prepChecklistItems)
                  .where(inArray(prepChecklistItems.id, ids))
              ).map((row) => row.id)
            : [],
        );
        // A recipe deleted since this list was loaded: the database already let
        // go of the link, so the save does too, instead of failing (and, from a
        // tablet that was offline, losing the whole edit).
        const recipeIds = [
          ...new Set(request.body.items.flatMap((item) => (item.recipeId ? [item.recipeId] : []))),
        ];
        const liveRecipes = new Set(
          recipeIds.length > 0
            ? (
                await tx
                  .select({ id: recipes.id })
                  .from(recipes)
                  .where(inArray(recipes.id, recipeIds))
              ).map((row) => row.id)
            : [],
        );
        for (const [index, item] of request.body.items.entries()) {
          const values = {
            stationId: item.stationId,
            name: item.name,
            recipeId: item.recipeId && liveRecipes.has(item.recipeId) ? item.recipeId : null,
            sortOrder: index,
          };
          if (item.id && known.has(item.id)) {
            await tx
              .update(prepChecklistItems)
              .set(values)
              .where(eq(prepChecklistItems.id, item.id));
          } else {
            await tx
              .insert(prepChecklistItems)
              .values({ ...values, ...(item.id ? { id: item.id } : {}) });
          }
        }

        await tx.update(kitchens).set({ prepChecklistUpdatedAt: new Date() });
        return readChecklist(tx);
      });
    },
  );

  r.post(
    '/checklist/add',
    {
      onRequest: [app.requireUser],
      schema: {
        body: addFromChecklistSchema,
        response: { 200: addFromChecklistResponseSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const [kitchen] = await app.db.select({ on: kitchens.prepChecklist }).from(kitchens).limit(1);
      if (!kitchen?.on) {
        throw new ApiError(400, 'checklist_off', 'The prep checklist is switched off.');
      }

      // In the checklist's own order, so the lines go on the way the chef laid them out.
      // An item the chef removed since it was ticked is simply not there any more.
      const wanted = new Set(request.body.ids);
      const items = (await readItems()).filter((item) => wanted.has(item.id));
      return prep.addFromChecklist(items, request.user!.id);
    },
  );
};

export default checklistRoutes;
