import { unlink } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  allergenProfileSchema,
  createRecipeSchema,
  duplicateRecipeSchema,
  errorSchema,
  expandedRecipeSchema,
  idSchema,
  listRecipesQuerySchema,
  recipeSchema,
  recipeSummarySchema,
  scaleQuerySchema,
  updateRecipeSchema,
} from '@mise/contracts';
import {
  expandRecipe,
  factorFor,
  isAllergen,
  isSeason,
  isUnitCode,
  type ExpandError,
  type Quantity,
} from '@mise/domain';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { recipePhotos } from '../../db/schema.js';
import { loadComponentNames, loadRecipeBook } from './book.js';
import { createRecipesService } from './service.js';

/**
 * Recipes.
 *
 * Everyone signed in can read the library, because a cook on the line needs
 * the spec. Only chefs and managers can change it.
 */

type StoredRecipe = NonNullable<
  Awaited<ReturnType<ReturnType<typeof createRecipesService>['getRecipe']>>
>;

const recipeRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = createRecipesService(app.db);

  function serialise(row: StoredRecipe, names: Map<string, string>) {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      status: row.status,
      stationId: row.stationId,
      yield: {
        value: row.yieldEntered,
        unit: isUnitCode(row.yieldUnit) ? row.yieldUnit : ('g' as const),
      },
      portions: row.portions,
      prepMinutes: row.prepMinutes,
      cookMinutes: row.cookMinutes,
      shelfLifeHours: row.shelfLifeHours,
      storage: row.storage,
      method: row.method,
      tags: row.tags,
      declaredAllergens: row.declaredAllergens.filter(isAllergen),
      mayContain: row.mayContain.filter(isAllergen),
      seasons: row.seasons.filter(isSeason),
      flavourProfile: row.flavourProfile,
      servingTemperature: row.servingTemperature,
      course: row.course,
      drinkPairings: row.drinkPairings,
      cutlery: row.cutlery,
      components: row.components.map((component) => ({
        id: component.id,
        sortOrder: component.sortOrder,
        section: component.section,
        note: component.note,
        quantity: {
          value: component.quantityEntered,
          unit: isUnitCode(component.unitEntered) ? component.unitEntered : ('g' as const),
        },
        ref: component.childRecipeId
          ? ({ kind: 'recipe', recipeId: component.childRecipeId } as const)
          : ({ kind: 'ingredient', ingredientId: component.ingredientId! } as const),
        displayName: names.get(component.id) ?? '',
      })),
      photos: row.photos.map((photo) => ({
        id: photo.id,
        url: `/api/uploads/${photo.path}`,
        caption: photo.caption,
        isPrimary: photo.isPrimary,
      })),
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  r.get(
    '/recipes',
    {
      onRequest: [app.requireUser],
      schema: {
        querystring: listRecipesQuerySchema,
        response: { 200: z.array(recipeSummarySchema), 401: errorSchema },
      },
    },
    async (request) => {
      const rows = await svc.listRecipes(request.query);

      // Allergen filters need the whole tree, so they are applied after the
      // database has narrowed everything else down.
      let allowed: Set<string> | null = null;
      let excluded: Set<string> | null = null;
      if (request.query.allergen) allowed = await svc.idsWithAllergen(request.query.allergen);
      if (request.query.excludeAllergen)
        excluded = await svc.idsWithAllergen(request.query.excludeAllergen);

      return rows
        .filter((row) => (allowed ? allowed.has(row.id) : true))
        .filter((row) => (excluded ? !excluded.has(row.id) : true))
        .map((row) => ({
          id: row.id,
          name: row.name,
          type: row.type,
          status: row.status,
          stationId: row.stationId,
          yield: {
            value: row.yieldEntered,
            unit: isUnitCode(row.yieldUnit) ? row.yieldUnit : ('g' as const),
          },
          portions: row.portions,
          tags: row.tags,
          updatedAt: row.updatedAt.toISOString(),
        }));
    },
  );

  r.post(
    '/recipes',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createRecipeSchema,
        response: { 200: recipeSchema, 400: errorSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const result = await svc.createRecipe(request.body, request.user?.id ?? null);
      if (result.outcome === 'cycle') throw cycleError(result.through);

      const full = await svc.getRecipe(result.recipe.id);
      if (!full) throw new ApiError(500, 'internal_error', 'Could not read that recipe back.');
      return serialise(full, await loadComponentNames(app.db, full.id));
    },
  );

  r.get(
    '/recipes/:id',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: recipeSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const row = await svc.getRecipe(request.params.id);
      if (!row) throw ApiError.notFound('That recipe');
      return serialise(row, await loadComponentNames(app.db, row.id));
    },
  );

  /** Allergens for the whole tree, which is what has to go on a menu. */
  r.get(
    '/recipes/:id/allergens',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: allergenProfileSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const row = await svc.getRecipe(request.params.id);
      if (!row) throw ApiError.notFound('That recipe');
      return svc.allergensFor(request.params.id);
    },
  );

  /**
   * The whole tree at a requested size.
   *
   * A chef asks for this in two ways, "make me twenty-five" and "I need five
   * litres", so both are accepted and turned into the same multiplier.
   */
  r.get(
    '/recipes/:id/expanded',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        querystring: scaleQuerySchema,
        response: {
          200: expandedRecipeSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      const row = await svc.getRecipe(request.params.id);
      if (!row) throw ApiError.notFound('That recipe');

      const book = await loadRecipeBook(app.db);
      const target: { portions?: number; factor?: number; yield?: Quantity } = {};
      if (request.query.factor !== undefined) target.factor = request.query.factor;
      else if (request.query.portions !== undefined) target.portions = request.query.portions;
      else if (request.query.yieldValue !== undefined && request.query.yieldUnit !== undefined) {
        target.yield = { value: request.query.yieldValue, unit: request.query.yieldUnit };
      }

      const factor = factorFor(request.params.id, target, book);
      if (!factor.ok) throw scaleError(factor.error);

      const lines = expandRecipe(request.params.id, factor.value, book);
      if (!lines.ok) throw scaleError(lines.error);

      return {
        recipe: serialise(row, await loadComponentNames(app.db, row.id)),
        factor: factor.value,
        lines: lines.value,
        allergens: await svc.allergensFor(request.params.id),
      };
    },
  );

  /** Which recipes use this one. Shown before deleting it. */
  r.get(
    '/recipes/:id/used-by',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: {
          200: z.array(z.object({ id: idSchema, name: z.string() })),
          401: errorSchema,
        },
      },
    },
    async (request) => svc.usedBy(request.params.id),
  );

  r.patch(
    '/recipes/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: updateRecipeSchema,
        response: {
          200: recipeSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await svc.updateRecipe(request.params.id, request.body);
      if (result.outcome === 'not_found') throw ApiError.notFound('That recipe');
      if (result.outcome === 'cycle') throw cycleError(result.through);

      const full = await svc.getRecipe(request.params.id);
      if (!full) throw ApiError.notFound('That recipe');
      return serialise(full, await loadComponentNames(app.db, full.id));
    },
  );

  r.post(
    '/recipes/:id/duplicate',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        body: duplicateRecipeSchema,
        response: { 200: recipeSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const copy = await svc.duplicateRecipe(request.params.id, request.body.name);
      if (!copy) throw ApiError.notFound('That recipe');
      const full = await svc.getRecipe(copy.id);
      if (!full) throw new ApiError(500, 'internal_error', 'Could not read the copy back.');
      return serialise(full, await loadComponentNames(app.db, full.id));
    },
  );

  r.delete(
    '/recipes/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      // Say what would break rather than letting a foreign key speak for us.
      const users = await svc.usedBy(request.params.id);
      if (users.length > 0) {
        throw ApiError.conflict(
          `Still used by ${users.map((u) => u.name).join(', ')}. Remove it from those first.`,
        );
      }
      const photos = await app.db
        .select({ path: recipePhotos.path })
        .from(recipePhotos)
        .where(eq(recipePhotos.recipeId, request.params.id));
      const removed = await svc.deleteRecipe(request.params.id);
      if (!removed) throw ApiError.notFound('That recipe');

      // The rows went with the recipe; the files would otherwise stay on disk.
      const uploadDir = path.resolve(app.config.UPLOAD_DIR);
      await Promise.all(
        photos.map((photo) =>
          unlink(path.join(uploadDir, path.basename(photo.path))).catch(() => undefined),
        ),
      );
      return reply.status(204).send(null);
    },
  );
};

/** Turning a scaling failure into something a chef can act on. */
function scaleError(error: ExpandError): ApiError {
  switch (error.kind) {
    case 'no_portions':
      return ApiError.badRequest(
        'This recipe is not written in portions, so scale it by batch or by yield instead.',
      );
    case 'incompatible_units':
      return ApiError.badRequest('That size is in different units from what this recipe makes.');
    case 'cycle':
      return ApiError.badRequest('This recipe contains itself, so it cannot be scaled.');
    default:
      return ApiError.badRequest('That recipe could not be worked out at that size.');
  }
}

/**
 * A loop is the one edit that has to be refused outright, so the message names
 * both ends rather than saying "invalid".
 */
function cycleError(through: string[]): ApiError {
  const [parent, child] = through;
  return ApiError.badRequest(
    `${parent} cannot contain ${child}, because ${child} already contains ${parent}. That would be a loop.`,
  );
}

export default recipeRoutes;
