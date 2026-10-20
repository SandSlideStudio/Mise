import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';

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

const securityPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(HEADERS)) reply.header(name, value);
    if (app.config.COOKIE_SECURE) reply.header('strict-transport-security', STRICT_TRANSPORT);
    return payload;
  });
};

export default fp(securityPlugin, { name: 'security', dependencies: ['config'] });
