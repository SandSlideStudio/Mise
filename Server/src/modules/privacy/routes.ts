import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  errorSchema,
  idSchema,
  mayManage,
  personDataSchema,
  privacySummarySchema,
} from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';

/**
 * Settings → Privacy, and one person's data for them to take away. Removing
 * someone for good is the ordinary DELETE /users/:id; see the kitchen service.
 */
const privacyRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/privacy',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: privacySummarySchema, 403: errorSchema } },
    },
    async () => app.privacy.summary(),
  );

  /**
   * Who may download it: the same people, with the same password sign-in, as
   * may edit or remove that person. Anyone may download their own.
   */
  r.get(
    '/users/:id/data',
    {
      onRequest: [app.requirePassword],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: personDataSchema, 403: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const actor = request.user!;
      const own = request.params.id === actor.id;
      if (!own && actor.role !== 'admin' && actor.role !== 'head_chef') {
        throw new ApiError(403, 'forbidden', 'Your role does not allow that.');
      }
      const data = await app.privacy.personData(request.params.id);
      if (!data) throw ApiError.notFound('That person');
      if (!own && !mayManage(actor.role, data.person.role)) {
        throw new ApiError(
          403,
          'staff_rank',
          'Only an administrator can manage staff at your rank or above.',
        );
      }
      return data;
    },
  );
};

export default privacyRoutes;
