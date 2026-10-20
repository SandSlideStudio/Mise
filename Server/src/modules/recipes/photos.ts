import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, idSchema, recipePhotoSchema } from '@mise/contracts';
import { recipePhotos, recipes } from '../../db/schema.js';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';

/**
 * Plating photographs.
 *
 * In a fine dining kitchen the photograph *is* the spec for how a plate should
 * look, so this is not decoration. Files land on a mounted volume rather than
 * in the database, and nothing the browser sends is trusted: the stored name
 * is generated here and the extension comes from the content type we accepted,
 * never from the uploaded filename.
 */

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

const MAX_BYTES = 8 * 1024 * 1024;

const photoRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const uploadDir = path.resolve(app.config.UPLOAD_DIR);

  await mkdir(uploadDir, { recursive: true });

  function serialise(row: typeof recipePhotos.$inferSelect) {
    return {
      id: row.id,
      url: `/api/uploads/${row.path}`,
      caption: row.caption,
      isPrimary: row.isPrimary,
    };
  }

  r.post(
    '/recipes/:id/photos',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: recipePhotoSchema, 400: errorSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const [recipe] = await app.db
        .select({ id: recipes.id })
        .from(recipes)
        .where(eq(recipes.id, request.params.id))
        .limit(1);
      if (!recipe) throw ApiError.notFound('That recipe');

      const file = await request.file({ limits: { fileSize: MAX_BYTES, files: 1 } });
      if (!file) throw ApiError.badRequest('No image was attached.');

      const extension = ALLOWED[file.mimetype];
      if (!extension) {
        throw ApiError.badRequest('That file is not an image we can store. Use JPEG, PNG or WebP.');
      }

      // Generated, never derived from what the browser sent.
      const storedName = `${randomUUID()}${extension}`;
      const absolute = path.join(uploadDir, storedName);
      await pipeline(file.file, createWriteStream(absolute));

      if (file.file.truncated) {
        await unlink(absolute).catch(() => {});
        throw ApiError.badRequest('That image is larger than 8 MB.');
      }

      // The first photograph on a recipe is the one that represents it.
      const existing = await app.db
        .select({ id: recipePhotos.id })
        .from(recipePhotos)
        .where(eq(recipePhotos.recipeId, request.params.id));

      const [row] = await app.db
        .insert(recipePhotos)
        .values({
          recipeId: request.params.id,
          path: storedName,
          isPrimary: existing.length === 0,
        })
        .returning();
      if (!row) throw new ApiError(500, 'internal_error', 'Could not record that photograph.');
      return serialise(row);
    },
  );

  /** Exactly one photograph represents a recipe, so setting one clears the rest. */
  r.post(
    '/photos/:id/primary',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: recipePhotoSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const [photo] = await app.db
        .select()
        .from(recipePhotos)
        .where(eq(recipePhotos.id, request.params.id))
        .limit(1);
      if (!photo) throw ApiError.notFound('That photograph');

      await app.db
        .update(recipePhotos)
        .set({ isPrimary: false })
        .where(and(eq(recipePhotos.recipeId, photo.recipeId), ne(recipePhotos.id, photo.id)));

      const [updated] = await app.db
        .update(recipePhotos)
        .set({ isPrimary: true })
        .where(eq(recipePhotos.id, photo.id))
        .returning();
      return serialise(updated!);
    },
  );

  r.delete(
    '/photos/:id',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 204: z.null(), 403: errorSchema, 404: errorSchema },
      },
    },
    async (request, reply) => {
      const [photo] = await app.db
        .delete(recipePhotos)
        .where(eq(recipePhotos.id, request.params.id))
        .returning();
      if (!photo) throw ApiError.notFound('That photograph');

      // A leftover file is untidy; a failed request because of one is worse.
      await unlink(path.join(uploadDir, photo.path)).catch(() => {});
      return reply.status(204).send(null);
    },
  );
};

export default photoRoutes;
