import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  dishCardSchema,
  dishCardSettingsSchema,
  dishSummarySchema,
  errorSchema,
  idSchema,
  updateDishCardSettingsSchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { createDishCardService, serialiseSettings } from './service.js';

/**
 * Dish cards.
 *
 * Chefs and managers set up how the cards look. Who may open one is the
 * kitchen's choice: by default everyone signed in, since the card is what the
 * floor staff are meant to read.
 */

const LOGO_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const dishCardRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = createDishCardService(app.db);
  const uploadDir = path.resolve(app.config.UPLOAD_DIR);

  async function mayOpenCards(request: FastifyRequest) {
    if (!request.user) throw new ApiError(401, 'not_authenticated', 'Sign in to continue.');
    const settings = await svc.settings();
    if (settings.access === 'managers' && !MANAGERS.includes(request.user.role)) {
      throw new ApiError(
        403,
        'forbidden',
        'Only chefs and administrators can open dish cards here.',
      );
    }
  }

  r.get(
    '/dish-cards/settings',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: dishCardSettingsSchema, 401: errorSchema } },
    },
    async () => serialiseSettings(await svc.settings()),
  );

  r.patch(
    '/dish-cards/settings',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        body: updateDishCardSettingsSchema,
        response: { 200: dishCardSettingsSchema, 403: errorSchema },
      },
    },
    async (request) => serialiseSettings(await svc.update(request.body)),
  );

  r.post(
    '/dish-cards/logo',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: dishCardSettingsSchema, 400: errorSchema, 403: errorSchema } },
    },
    async (request) => {
      const file = await request.file({ limits: { fileSize: LOGO_MAX_BYTES, files: 1 } });
      if (!file) throw ApiError.badRequest('No image was attached.');

      const extension = LOGO_TYPES[file.mimetype];
      if (!extension) {
        throw ApiError.badRequest('A logo has to be a JPEG, PNG or WebP image.');
      }

      // Generated, never derived from what the browser sent.
      const storedName = `logo-${randomUUID()}${extension}`;
      const absolute = path.join(uploadDir, storedName);
      await pipeline(file.file, createWriteStream(absolute));
      if (file.file.truncated) {
        await unlink(absolute).catch(() => {});
        throw ApiError.badRequest('That logo is larger than 2 MB.');
      }

      const previous = await svc.setLogo(storedName);
      if (previous) await unlink(path.join(uploadDir, path.basename(previous))).catch(() => {});
      return serialiseSettings(await svc.settings());
    },
  );

  r.delete(
    '/dish-cards/logo',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: dishCardSettingsSchema, 403: errorSchema } },
    },
    async () => {
      const previous = await svc.setLogo(null);
      if (previous) await unlink(path.join(uploadDir, path.basename(previous))).catch(() => {});
      return serialiseSettings(await svc.settings());
    },
  );

  // The Dishes page. What a dish contains is no secret from anyone who cooks
  // it, so this follows sign-in, not who may open the printable cards.
  r.get(
    '/dishes',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.array(dishSummarySchema), 401: errorSchema } },
    },
    async () => svc.summaries(),
  );

  r.get(
    '/recipes/:id/card',
    {
      onRequest: [mayOpenCards],
      schema: {
        params: z.object({ id: idSchema }),
        response: {
          200: dishCardSchema,
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          422: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await svc.card(request.params.id);
      if (result.ok) return result.card;
      switch (result.error.kind) {
        case 'not_found':
          throw ApiError.notFound('That recipe');
        case 'not_a_dish':
          throw ApiError.badRequest('Only a dish has a dish card.');
        case 'broken':
          throw new ApiError(
            422,
            'card_unavailable',
            'This dish points at a recipe or ingredient that no longer exists, so its allergens cannot be worked out. Fix the recipe first.',
          );
      }
    },
  );
};

export default dishCardRoutes;
