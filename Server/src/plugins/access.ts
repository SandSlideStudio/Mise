import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../lib/errors.js';
import { forwarded, insideKitchen, isPrivateAddress } from '../lib/network.js';
import {
  createConnectionService,
  plainHost,
  type ConnectionService,
  type ConnectionState,
} from '../modules/connection/service.js';
import type { HttpsListener } from '../modules/connection/listener.js';
import type { issueDomainCertificate } from '../modules/connection/acme.js';
import {
  ACCESS_COOKIE,
  COOKIE_DAYS,
  createAccessService,
  type AccessService,
} from '../modules/access/service.js';

/**
 * The door for everything outside the kitchen.
 *
 * Inside (the kitchen's own network or its VPN) nothing changes. Outside,
 * the API answers only the request page until the device is approved, so
 * someone on the internet can't reach the sign-in form, let alone guess at
 * it. The built web app itself is not secret and loads anywhere; it is what
 * shows the request page.
 *
 * Decided by the route that matched, never the raw address, so an encoded or
 * oddly written path can't slip past.
 */

declare module 'fastify' {
  interface FastifyInstance {
    access: AccessService;
    connection: ConnectionService;
    /** Whether this request comes from the kitchen's own network or VPN. */
    insideKitchen: (request: FastifyRequest) => boolean;
    setAccessCookie: (reply: FastifyReply, token: string) => void;
  }

  interface FastifyRequest {
    /** Set for every request: inside the kitchen, so no approval is needed. */
    inside: boolean;
    /** The approved outside device this request came from, if any. */
    remoteDevice: { id: string; name: string } | null;
  }
}

/** Open to everyone: how to ask, and whether the server is up. */
const OPEN_ROUTES = new Set(['/api/health', '/api/access/status', '/api/access/request']);

interface AccessOptions {
  connectionState: ConnectionState;
  listener: HttpsListener;
  directoryUrl: string;
  issue?: typeof issueDomainCertificate;
}

/** Let's Encrypt asks here over plain HTTP; it must never be sent elsewhere. */
export const ACME_ROUTE = '/.well-known/acme-challenge/:token';

const accessPlugin: FastifyPluginAsync<AccessOptions> = async (app, options) => {
  app.decorate('access', createAccessService(app.db));
  app.decorate(
    'connection',
    createConnectionService({
      db: app.db,
      state: options.connectionState,
      listener: options.listener,
      directoryUrl: options.directoryUrl,
      issue: options.issue,
    }),
  );
  app.addHook('onReady', async () => app.connection.load());
  app.decorate('insideKitchen', (request: FastifyRequest) =>
    insideKitchen(
      request,
      (proxy) => app.config.TRUST_PROXY !== false || proxy === app.connection.trustedProxy(),
    ),
  );
  app.decorate('setAccessCookie', (reply: FastifyReply, token: string) => {
    reply.setCookie(ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.secureCookies(reply.request),
      path: '/',
      maxAge: COOKIE_DAYS * 86_400,
    });
  });
  app.decorateRequest('inside', false);
  app.decorateRequest('remoteDevice', null);

  app.addHook('onRequest', async (request, reply) => {
    request.inside = app.insideKitchen(request);
    const open = app.config.OUTSIDE_ACCESS === 'open';
    // A web server on the kitchen network passing requests on: offered in
    // Settings → Connection as the one to trust.
    const peer = request.socket.remoteAddress ?? '';
    if (forwarded(request) && isPrivateAddress(peer))
      app.connection.sawProxy(peer, request.hostname);

    // From outside, only the kitchen's own address leads here once one is set,
    // like a website on a shared server. Anything else (the bare IP, another
    // site's name pointed at the same machine) finds nothing at all.
    if (!request.inside && !open) {
      const domain = app.connection.outsideDomain();
      if (domain && plainHost(request.hostname) !== domain) {
        return reply.code(404).type('text/plain; charset=utf-8').send('Not found');
      }
    }

    // The kitchen's domain has a certificate: plain HTTP there goes over to
    // HTTPS. Not behind a proxy, which does its own HTTPS, and never Let's
    // Encrypt's own check, which only ever comes over HTTP.
    const secureDomain = app.connection.httpsDomain();
    if (
      secureDomain &&
      !('encrypted' in request.socket && request.socket.encrypted) &&
      !forwarded(request) &&
      plainHost(request.hostname) === secureDomain &&
      request.routeOptions.url !== ACME_ROUTE
    ) {
      return reply.redirect(`https://${secureDomain}${request.url}`, 301);
    }

    if (!request.inside) {
      const token = request.cookies[ACCESS_COOKIE];
      const device = token ? await app.access.approved(token) : null;
      if (device && token) {
        request.remoteDevice = { id: device.id, name: device.name };
        // Used, so kept: the browser's own limit on the cookie starts again.
        if (device.renew) app.setAccessCookie(reply, token);
      }
    }

    const route = request.routeOptions.url;
    if (!route?.startsWith('/api/') || OPEN_ROUTES.has(route)) return;
    if (request.inside || request.remoteDevice || open) return;
    // Before anyone has set the kitchen up there is nobody to approve anything:
    // setup itself stays reachable, behind its setup code.
    if (route.startsWith('/api/setup') && (await app.auth.needsSetup())) return;

    throw new ApiError(
      403,
      'access_required',
      'This Mise only opens on devices the kitchen has approved. Ask for access first.',
    );
  });
};

export default fp(accessPlugin, { name: 'access', dependencies: ['db', 'config', 'auth'] });
