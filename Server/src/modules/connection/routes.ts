import { isIP } from 'node:net';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  connectionSchema,
  errorSchema,
  kitchenHttpsSchema,
  trustInfoSchema,
  updateConnectionSchema,
} from '@mise/contracts';
import { kitchens } from '../../db/schema.js';
import { validKitchenName } from './certificates.js';
import { CertificateFailure } from './service.js';
import { ACME_ROUTE } from '../../plugins/access.js';
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
    const relayed = app.connection.containerGateway();
    const https = app.connection.https();
    return {
      https: {
        port: app.httpsListener.port() ?? app.config.HTTPS_PORT,
        httpPort: app.config.PORT,
        kitchen: { ...https.kitchen, expiresAt: https.kitchen.expiresAt?.toISOString() ?? null },
        domain: { ...https.domain, expiresAt: https.domain.expiresAt?.toISOString() ?? null },
      },
      outsideDomain: app.connection.outsideDomain(),
      trustedProxy: app.connection.trustedProxy(),
      seenProxy: seen ? { ...seen, at: seen.at.toISOString() } : null,
      containerGateway: relayed ? { ...relayed, at: relayed.at.toISOString() } : null,
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
      onRequest: [app.requireRole('admin'), app.requirePassword],
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
          { current: plainHost(request.hostname), domain },
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

  // --- HTTPS ----------------------------------------------------------------

  async function kitchenName(): Promise<string> {
    const [kitchen] = await app.db.select({ name: kitchens.name }).from(kitchens).limit(1);
    return kitchen?.name ?? 'Kitchen';
  }

  r.put(
    '/connection/kitchen-https',
    {
      onRequest: [app.requireRole('admin'), app.requirePassword],
      schema: {
        body: kitchenHttpsSchema,
        response: { 200: connectionSchema, 400: errorSchema, 403: errorSchema },
      },
    },
    async (request) => {
      const names = [...new Set(request.body.names)];
      const wrong = names.find((name) => !validKitchenName(name));
      if (wrong) {
        throw new ApiError(400, 'bad_name', `"${wrong}" is not an address or host name.`, {
          name: wrong,
        });
      }
      const outside = app.connection.namesOutsideAuthority(names);
      if (outside.length > 0) {
        throw new ApiError(
          400,
          'name_outside_kitchen',
          `The kitchen certificate only vouches for the kitchen network: addresses such as 192.168.1.50, and names ending in .local, .lan, .home or .internal. "${outside[0]}" isn't one of them.`,
          { name: outside[0] },
        );
      }
      await app.connection.enableKitchenHttps(names, await kitchenName());
      return describe(request);
    },
  );

  r.delete(
    '/connection/kitchen-https',
    {
      onRequest: [app.requireRole('admin'), app.requirePassword],
      schema: { response: { 200: connectionSchema, 403: errorSchema } },
    },
    async (request) => {
      await app.connection.disableKitchenHttps();
      return describe(request);
    },
  );

  r.post(
    '/connection/domain-https',
    {
      onRequest: [app.requireRole('admin'), app.requirePassword],
      // Let's Encrypt allows only a few failed tries an hour.
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
      schema: {
        response: { 200: connectionSchema, 400: errorSchema, 403: errorSchema, 502: errorSchema },
      },
    },
    async (request) => {
      if (!app.connection.outsideDomain()) {
        throw new ApiError(400, 'no_domain', 'Set the address from outside first.');
      }
      try {
        await app.connection.enableDomainHttps();
      } catch (error) {
        if (error instanceof CertificateFailure) {
          throw new ApiError(502, 'certificate_failed', error.message);
        }
        throw error;
      }
      return describe(request);
    },
  );

  r.delete(
    '/connection/domain-https',
    {
      onRequest: [app.requireRole('admin'), app.requirePassword],
      schema: { response: { 200: connectionSchema, 403: errorSchema } },
    },
    async (request) => {
      await app.connection.disableDomainHttps();
      return describe(request);
    },
  );

  // --- for tablets, before anyone signs in ----------------------------------

  /** Whether there is a kitchen certificate to trust, and where it answers. */
  r.get('/connection/trust', { schema: { response: { 200: trustInfoSchema } } }, async () => {
    const { kitchen } = app.connection.https();
    return {
      enabled: kitchen.enabled,
      port: app.httpsListener.port() ?? app.config.HTTPS_PORT,
      names: kitchen.names,
      fingerprint: kitchen.fingerprint,
    };
  });

  /**
   * The authority itself, for a tablet to trust. Public: it holds no secret,
   * and the tablet asking hasn't signed in yet. From outside, the door in
   * front of the API applies as to everything else.
   */
  app.get('/connection/kitchen-certificate.crt', async (_request, reply) => {
    const authority = app.connection.authority();
    if (!authority) throw ApiError.notFound('The kitchen certificate');
    return reply
      .type('application/x-x509-ca-cert')
      .header('content-disposition', 'attachment; filename="mise-kitchen.crt"')
      .header('cache-control', 'no-store')
      .send(authority);
  });
};

export default connectionRoutes;

/** Let's Encrypt's check, at the root and over plain HTTP. Only answers while a certificate is being fetched. */
export const acmeChallengeRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>(ACME_ROUTE, async (request, reply) => {
    const answer = app.connection.challenge(request.params.token);
    if (!answer) return reply.code(404).type('text/plain').send('Not found');
    return reply.type('text/plain').send(answer);
  });
};
