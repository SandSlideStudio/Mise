import { isIP } from 'node:net';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { connectionSchema, errorSchema, updateConnectionSchema } from '@mise/contracts';
import { ApiError } from '../../lib/errors.js';
import { isPrivateAddress } from '../../lib/network.js';
import { plainHost } from './service.js';

/**
 * Settings → Connection. Administrators only: a wrong address here shuts
 * every outside device out.
 */
const connectionRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  function describe(request: FastifyRequest) {
    const seen = app.connection.seenProxy();
    return {
      outsideDomain: app.connection.outsideDomain(),
      trustedProxy: app.connection.trustedProxy(),
      seenProxy: seen ? { ...seen, at: seen.at.toISOString() } : null,
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
      const { outsideDomain: domain, trustedProxy: proxy } = request.body;
      // From outside, only an address that still leads back here, or the
      // very next request would get "Not found".
      if (!request.inside && domain != null && plainHost(domain) !== plainHost(request.hostname)) {
        throw new ApiError(
          400,
          'domain_locks_you_out',
          `You are connected through ${plainHost(request.hostname)}. Set this from inside the kitchen, or open Mise through ${domain} first.`,
        );
      }
      // Only a machine on the kitchen's own network: trusting one on the
      // internet would let anyone there claim to be anyone.
      if (proxy != null && (isIP(proxy) === 0 || !isPrivateAddress(proxy))) {
        throw new ApiError(
          400,
          'proxy_not_local',
          'Use the address of a web server on the kitchen network, such as 192.168.1.60.',
        );
      }
      await app.connection.update({ outsideDomain: domain, trustedProxy: proxy });
      return describe(request);
    },
  );
};

export default connectionRoutes;
