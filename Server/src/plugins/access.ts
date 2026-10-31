import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../lib/errors.js';
import { insideKitchen } from '../lib/network.js';
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

const accessPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('access', createAccessService(app.db));
  app.decorate('insideKitchen', (request: FastifyRequest) =>
    insideKitchen(request, app.config.TRUST_PROXY),
  );
  app.decorate('setAccessCookie', (reply: FastifyReply, token: string) => {
    reply.setCookie(ACCESS_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.COOKIE_SECURE,
      path: '/',
      maxAge: COOKIE_DAYS * 86_400,
    });
  });
  app.decorateRequest('inside', false);
  app.decorateRequest('remoteDevice', null);

  app.addHook('onRequest', async (request, reply) => {
    request.inside = app.insideKitchen(request);
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
    if (request.inside || request.remoteDevice || app.config.OUTSIDE_ACCESS === 'open') return;
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
