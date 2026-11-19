import { changedMeanwhile, ensureUnchanged, matchesBase } from '../../lib/conflict.js';
import { and, asc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createIngredientSchema,
  type IngredientPriceInput,
  type UpdateIngredient,
  errorSchema,
  idSchema,
  ingredientSchema,
  listIngredientsQuerySchema,
  updateIngredientSchema,
} from '@mise/contracts';
import { costPerBaseUnit, isAllergen, type Allergen } from '@mise/domain';
import { ingredients } from '../../db/schema.js';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { recordAllergenChanges } from '../recipes/allergenHistory.js';
import { domainIngredient } from '../recipes/book.js';
import { seesCosts } from '../recipes/costs.js';

type IngredientRow = typeof ingredients.$inferSelect;

/** The columns a price is kept in; null clears it. */
function priceColumns(price: IngredientPriceInput | null) {
  return {
    price: price?.amount ?? null,
    purchaseQuantity: price?.quantity.value ?? null,
    purchaseUnit: price?.quantity.unit ?? null,
  };
}

function samePrice(row: IngredientRow, price: IngredientPriceInput | null): boolean {
  const next = priceColumns(price);
  return (
    row.price === next.price &&
    row.purchaseQuantity === next.purchaseQuantity &&
    row.purchaseUnit === next.purchaseUnit
  );
}

/**
 * A "may contain" next to a "contains" of the same allergen says nothing the
 * label doesn't already say louder, so it isn't kept.
 */
function tracesOnly(mayContain: Allergen[], contains: readonly Allergen[]): Allergen[] {
  return mayContain.filter((allergen) => !contains.includes(allergen));
}

/**
 * Whether an edit changes anything but the price, comparing with what is
 * stored the way the editor sends it. When unsure, it counts as a change.
 */
function changesMoreThanPrice(row: IngredientRow, body: UpdateIngredient): boolean {
  const stored: Record<string, unknown> = {
    name: row.name,
    category: row.category,
    baseUnit: row.baseUnit,
    allergens: row.allergens,
    mayContain: row.mayContain,
    vegan: row.vegan,
    allergenDetails: {
      gluten: row.allergenDetails.gluten ?? [],
      nuts: row.allergenDetails.nuts ?? [],
    },
    notes: row.notes,
    densityGPerMl: row.densityGPerMl,
    itemWeightG: row.itemWeightG,
    yieldPercent: row.yieldPercent,
  };
  return Object.entries(body).some(
    ([key, value]) =>
      key !== 'price' &&
      value !== undefined &&
      JSON.stringify(value) !== JSON.stringify(stored[key]),
  );
}

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

  /** withCosts: whether the reader may see the price. Off unless said. */
  function serialise(row: IngredientRow, withCosts = false) {
    const domain = domainIngredient(row);
    const perBase = costPerBaseUnit(domain);
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      baseUnit: row.baseUnit,
      allergens: row.allergens.filter(isAllergen),
      mayContain: row.mayContain.filter(isAllergen),
      vegan: row.vegan,
      allergenDetails: {
        gluten: row.allergenDetails.gluten ?? [],
        nuts: row.allergenDetails.nuts ?? [],
      },
      notes: row.notes,
      densityGPerMl: row.densityGPerMl,
      itemWeightG: row.itemWeightG,
      yieldPercent: row.yieldPercent,
      updatedAt: row.updatedAt.toISOString(),
      ...(withCosts
        ? {
            price: domain.price
              ? {
                  ...domain.price,
                  updatedAt: row.priceUpdatedAt?.toISOString() ?? null,
                  perBase: perBase.ok ? perBase.value : null,
                }
              : null,
          }
        : {}),
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
      const withCosts = seesCosts(request.user);
      return rows.map((row) => serialise(row, withCosts));
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
          mayContain: tracesOnly(request.body.mayContain, request.body.allergens),
          vegan: request.body.vegan ?? null,
          allergenDetails: request.body.allergenDetails ?? {},
          notes: request.body.notes ?? null,
          densityGPerMl: request.body.densityGPerMl ?? null,
          itemWeightG: request.body.itemWeightG ?? null,
          yieldPercent: request.body.yieldPercent ?? 100,
          ...priceColumns(request.body.price ?? null),
          priceUpdatedAt: request.body.price ? new Date() : null,
        })
        .returning();
      if (!row) throw new ApiError(500, 'internal_error', 'Could not save that ingredient.');
      return serialise(row, true);
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
      return serialise(row, seesCosts(request.user));
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
      // Someone else changed it since this edit started (offline, or with the
      // page open): ask which to keep, rather than overwrite their allergens.
      const [before] = await app.db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, request.params.id))
        .limit(1);
      if (!before) throw ApiError.notFound('That ingredient');
      await ensureUnchanged(request, before.updatedAt, () => serialise(before, true));
      // The check above is the quick answer. This is the one that counts: made
      // with the row locked, in the same transaction as the write.
      const saved = await app.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, request.params.id))
          .for('update');
        if (!locked) return null;
        if (!matchesBase(request, locked.updatedAt)) return 'changed' as const;
        const { mayContain, price, ...rest } = request.body;
        const priceChanged = price !== undefined && !samePrice(locked, price);
        const [row] = await tx
          .update(ingredients)
          .set({
            ...rest,
            ...(priceChanged ? { ...priceColumns(price), priceUpdatedAt: new Date() } : {}),
            // Saved either way when either list changed, so the two never overlap.
            ...(mayContain !== undefined || rest.allergens !== undefined
              ? {
                  mayContain: tracesOnly(
                    mayContain ?? locked.mayContain.filter(isAllergen),
                    rest.allergens ?? locked.allergens.filter(isAllergen),
                  ),
                }
              : {}),
            // A new price changes nothing a dish card says, so a price alone
            // keeps the version: menus would otherwise ask for every card to be
            // printed again each time an invoice comes in.
            ...(changesMoreThanPrice(locked, request.body) ? { updatedAt: new Date() } : {}),
          })
          .where(eq(ingredients.id, request.params.id))
          .returning();
        if (!row) return null;
        // Every dish it goes into, however deep, gets a line in its allergen record.
        await recordAllergenChanges(tx, { name: row.name, userId: request.user?.id ?? null });
        return row;
      });
      if (saved === 'changed') {
        await changedMeanwhile(async () => {
          const [now] = await app.db
            .select()
            .from(ingredients)
            .where(eq(ingredients.id, request.params.id))
            .limit(1);
          if (!now) throw ApiError.notFound('That ingredient');
          return serialise(now, true);
        });
      }
      if (!saved || saved === 'changed') throw ApiError.notFound('That ingredient');
      return serialise(saved, true);
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
