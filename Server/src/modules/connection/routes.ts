import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { connectionSchema, errorSchema, updateConnectionSchema } from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { plainHost } from './service.js';

/**
 * Settings → Connection. Administrators only: a wrong address here shuts
 * every outside device out.
 */
const connectionRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function describe(request: { hostname: string; inside: boolean }) {
    return {
      outsideDomain: await app.connection.outsideDomain(),
      currentHost: plainHost(request.hostname),
      inside: request.inside,
    };
  }

  r.get(
    '/connection',
    {
      onRequest: [app.requireRole('admin')],
      schema: { response: { 200: connectionSchema, 403: errorSchema } },
    },
    async (request) => describe(request),
  );

  r.put(
    '/connection',
    {
      onRequest: [app.requireRole('admin')],
      schema: {
        body: updateConnectionSchema,
        response: { 200: connectionSchema, 400: errorSchema, 403: errorSchema },
      },
    },
    async (request) => {
      const domain = request.body.outsideDomain;
      // From outside, only an address that still leads back here, or the
      // very next request would get "Not found".
      if (!request.inside && domain !== null && plainHost(domain) !== plainHost(request.hostname)) {
        throw new ApiError(
          400,
          'domain_locks_you_out',
          `You are connected through ${plainHost(request.hostname)}. Set this from inside the kitchen, or open Mise through ${domain} first.`,
        );
      }
      await app.connection.setOutsideDomain(domain);
      return describe(request);
    },
  );
};

export default connectionRoutes;
