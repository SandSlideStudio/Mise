import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createIngredientSchema,
  errorSchema,
  idSchema,
  ingredientSchema,
  listIngredientsQuerySchema,
  updateIngredientSchema,
} from '@mise/contracts';
import { isAllergen } from '@mise/domain';
import { ingredients } from '../../db/schema.js';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';

/**
 * The raw material catalogue.
 *
 * Three fields here carry all the weight and none of them are obvious, so the
 * editor explains each one: density makes volume-to-weight possible, item
 * weight makes count-to-weight possible, and trim yield is what makes a prep
 * list say how much to pull from the walk-in rather than how much ends up in
 * the pan.
 */
const ingredientRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function serialise(row: typeof ingredients.$inferSelect) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      baseUnit: row.baseUnit,
      allergens: row.allergens.filter(isAllergen),
      densityGPerMl: row.densityGPerMl,
      itemWeightG: row.itemWeightG,
      yieldPercent: row.yieldPercent,
      vegan: row.vegan,
      allergenDetails: {
        gluten: row.allergenDetails.gluten ?? [],
        nuts: row.allergenDetails.nuts ?? [],
      },
      notes: row.notes,
    };
  }

  r.get(
    '/ingredients',
    {
      onRequest: [app.requireUser],
      schema: {
        querystring: listIngredientsQuerySchema,
        response: { 200: z.array(ingredientSchema), 401: errorSchema },
      },
    },
    async (request) => {
      const conditions = [];
      if (request.query.search)
        conditions.push(ilike(ingredients.name, `%${request.query.search}%`));
      if (request.query.category) conditions.push(eq(ingredients.category, request.query.category));

      const rows = await app.db
        .select()
        .from(ingredients)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(asc(ingredients.name));
      return rows.map(serialise);
    },
  );

  /** The distinct categories in use, for grouping the picker. */
  r.get(
    '/ingredients/categories',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(z.string()), 401: errorSchema } },
    },
    async () => {
      const rows = await app.db
        .selectDistinct({ category: ingredients.category })
        .from(ingredients)
        .where(sql`${ingredients.category} is not null`)
        .orderBy(asc(ingredients.category));
      return rows.map((row) => row.category).filter((c): c is string => c !== null);
    },
  );

  r.post(
    '/ingredients',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createIngredientSchema,
        response: { 200: ingredientSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const [row] = await app.db
        .insert(ingredients)
        .values({
          name: request.body.name,
          category: request.body.category ?? null,
          baseUnit: request.body.baseUnit,
          allergens: request.body.allergens,
          densityGPerMl: request.body.densityGPerMl ?? null,
          itemWeightG: request.body.itemWeightG ?? null,
          yieldPercent: request.body.yieldPercent,
          vegan: request.body.vegan ?? null,
          allergenDetails: request.body.allergenDetails ?? {},
          notes: request.body.notes ?? null,
        })
        .returning();
      if (!row) throw new ApiError(500, 'internal_error', 'Could not save that ingredient.');
      return serialise(row);
    },
  );

  r.get(
    '/ingredients/:id',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: ingredientSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, request.params.id))
        .limit(1);
      if (!row) throw ApiError.notFound('That ingredient');
      return serialise(row);
    },
  );

  r.patch(
    '/ingredients/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateIngredientSchema,
        response: { 200: ingredientSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const [row] = await app.db
        .update(ingredients)
        .set({ ...request.body, updatedAt: new Date() })
        .where(eq(ingredients.id, request.params.id))
        .returning();
      if (!row) throw ApiError.notFound('That ingredient');
      return serialise(row);
    },
  );

  /**
   * Refused while anything still uses it. The foreign key is set to restrict
   * rather than cascade, because silently emptying a line out of every recipe
   * that referenced it would be far worse than an error message.
   */
  r.delete(
    '/ingredients/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const removed = await app.db
        .delete(ingredients)
        .where(eq(ingredients.id, request.params.id))
        .returning({ id: ingredients.id });
      if (removed.length === 0) throw ApiError.notFound('That ingredient');
      return reply.status(204).send(null);
    },
  );
};

export default ingredientRoutes;
