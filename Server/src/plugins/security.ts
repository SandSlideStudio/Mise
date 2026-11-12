import fp from 'fastify-plugin';
import type { TLSSocket } from 'node:tls';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { ApiError } from '../lib/errors.js';

/**
 * Browser-side protections on every response.
 *
 * Mise runs on networks nobody here controls, often a restaurant's guest wifi,
 * so the page tells the browser exactly what it is allowed to do: load its own
 * scripts and nothing else, never sit inside someone else's frame, never guess
 * a file's type. Everything Mise needs is served from its own origin, which
 * keeps the policy short.
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // No inline scripts at all: the one pre-paint script is its own file.
  "script-src 'self'",
  // Inline styles stay allowed: view transitions and a few computed widths set them.
  "style-src 'self' 'unsafe-inline'",
  // Photos come from the server; data: and blob: cover previews before upload.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // The API and the live-update stream are same-origin.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS: Record<string, string> = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), payment=(), usb=()',
};

/** A year, once someone has said the server is only reached over HTTPS. */
const STRICT_TRANSPORT = 'max-age=31536000';

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** "https://mise.example.com:3443" → "mise.example.com:3443". */
function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Whether a change comes from Mise's own page. A browser names the page a
 * request comes from in Origin; another site (another app on the same NAS,
 * say) can't send changes with the kitchen's cookie. No Origin at all is a
 * request from outside a browser, which carries no cookie by itself.
 */
function fromOwnPage(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return request.headers['sec-fetch-site'] !== 'cross-site';
  const from = hostOf(origin);
  if (!from) return false;
  const hosts = [request.headers.host, request.headers['x-forwarded-host']]
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.split(',')[0]!.trim().toLowerCase());
  return hosts.includes(from);
}

/** Served over HTTPS on the domain Mise holds its own certificate for. */
function onOwnDomainOverHttps(request: FastifyRequest, domain: string | null): boolean {
  if (!domain || !(request.raw.socket as TLSSocket).encrypted) return false;
  return request.hostname.split(':')[0]!.toLowerCase() === domain;
}

const securityPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', async (request) => {
    // By the route it reaches, not the address as typed: /api//x or an
    // encoded path reach the same route without starting with /api/.
    const route = request.routeOptions.url;
    const api = route?.startsWith('/api/') || request.url.startsWith('/api/');
    if (WRITES.has(request.method) && api && !fromOwnPage(request)) {
      throw new ApiError(403, 'bad_origin', 'Changes can only come from Mise’s own page.');
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    for (const [name, value] of Object.entries(HEADERS)) reply.header(name, value);
    // Said to be HTTPS only, or on the domain Mise has its own certificate
    // for: the browser goes straight to HTTPS from then on.
    const https = app.hasDecorator('connection') ? app.connection.https().domain : null;
    const domain = https?.enabled ? https.domain : null;
    if (app.config.COOKIE_SECURE || onOwnDomainOverHttps(request, domain))
      reply.header('strict-transport-security', STRICT_TRANSPORT);
    return payload;
  });
};

export default fp(securityPlugin, { name: 'security', dependencies: ['config'] });
