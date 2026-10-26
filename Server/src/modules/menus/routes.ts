import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createMenuSchema,
  duplicateMenuSchema,
  errorSchema,
  idSchema,
  menuOverviewSchema,
  menuSchema,
  menuSummarySchema,
  updateMenuSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { createDishCardService } from '../dishcards/service.js';
import { createMenusService, type MenuFailure } from './service.js';

/**
 * Menus.
 *
 * Everyone signed in can see the menus, as they can the recipe book. Chefs and
 * administrators make and change them. The overview follows the kitchen's
 * choice of who may open dish cards, since it shows the same allergens.
 */

function failureToError(failure: MenuFailure): ApiError {
  switch (failure.kind) {
    case 'not_found':
      return ApiError.notFound('That menu');
    case 'duplicate_name':
      return ApiError.conflict('There is already a menu with that name.');
    case 'not_dishes':
      return ApiError.badRequest(`Only dishes go on a menu: ${failure.names.join(', ')}.`, {
        names: failure.names,
      });
    case 'broken':
      return new ApiError(
        422,
        'menu_unavailable',
        `The allergens of ${failure.names.join(', ')} can't be worked out, because it points at a recipe or ingredient that no longer exists. Fix the recipe first.`,
        { names: failure.names },
      );
  }
}

const menuRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = createMenusService(app.db);
  const dishCards = createDishCardService(app.db);

  async function mayOpenCards(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'not_authenticated', 'Sign in to continue.');
    const settings = await dishCards.settings();
    if (settings.access === 'managers' && !MANAGERS.includes(request.user.role)) {
      throw new ApiError(403, 'forbidden', 'Only chefs and administrators can open this here.');
    }
  }

  const byId = { params: z.object({ id: idSchema }) };

  r.get(
    '/menus',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(menuSummarySchema), 401: errorSchema } },
    },
    async () => svc.listMenus(),
  );

  r.post(
    '/menus',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: createMenuSchema,
        response: { 200: menuSchema, 400: errorSchema, 403: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const result = await svc.createMenu(request.body);
      if (!result.ok) throw failureToError(result.error);
      return result.menu;
    },
  );

  r.get(
    '/menus/:id',
    {
      onRequest: [app.requireUser],
      schema: { ...byId, response: { 200: menuSchema, 401: errorSchema, 404: errorSchema } },
    },
    async (request) => {
      const menu = await svc.getMenu(request.params.id);
      if (!menu) throw ApiError.notFound('That menu');
      return menu;
    },
  );

  r.patch(
    '/menus/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        ...byId,
        body: updateMenuSchema,
        response: {
          200: menuSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await svc.updateMenu(request.params.id, request.body);
      if (!result.ok) throw failureToError(result.error);
      return result.menu;
    },
  );

  r.delete(
    '/menus/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { ...byId, response: { 204: z.null(), 403: errorSchema, 404: errorSchema } },
    },
    async (request, reply) => {
      if (!(await svc.deleteMenu(request.params.id))) throw ApiError.notFound('That menu');
      return reply.status(204).send(null);
    },
  );

  r.post(
    '/menus/:id/duplicate',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        ...byId,
        body: duplicateMenuSchema,
        response: { 200: menuSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const result = await svc.duplicateMenu(request.params.id, request.body.name);
      if (!result.ok) throw failureToError(result.error);
      return result.menu;
    },
  );

  /** Called once all of a menu's dish cards have been downloaded. */
  r.post(
    '/menus/:id/cards-printed',
    {
      onRequest: [mayOpenCards],
      schema: { ...byId, response: { 200: menuSchema, 403: errorSchema, 404: errorSchema } },
    },
    async (request) => {
      const menu = await svc.markCardsPrinted(request.params.id);
      if (!menu) throw ApiError.notFound('That menu');
      return menu;
    },
  );

  r.get(
    '/menus/:id/overview',
    {
      onRequest: [mayOpenCards],
      schema: {
        ...byId,
        response: {
          200: menuOverviewSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await svc.overview(request.params.id);
      if (!result.ok) throw failureToError(result.error);
      return result.overview;
    },
  );
};

export default menuRoutes;
