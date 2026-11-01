import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import type { FastifyBaseLogger } from 'fastify';

/**
 * HTTPS next to plain HTTP, from the same app.
 *
 * Fastify builds its HTTP server through serverFactory, which hands over the
 * request handler; the HTTPS server here runs that same handler. It starts
 * when the first certificate is turned on, stops when the last one is turned
 * off, and takes new certificates without a restart.
 *
 * Which certificate: a browser that asked for the kitchen's domain gets the
 * Let's Encrypt one; everything else (an IP address, mise.local) gets the
 * kitchen certificate. Browsers don't name an IP address when they connect,
 * so the kitchen certificate is also the default.
 */

export interface ServedCertificates {
  kitchen: { cert: string; key: string } | null;
  domain: { name: string; cert: string; key: string } | null;
}

/** The logger comes later: this exists before the Fastify instance that owns it. */
export function createHttpsListener(log: () => FastifyBaseLogger) {
  let handler: http.RequestListener | null = null;
  let server: https.Server | null = null;
  let target: { port: number; host: string } | null = null;
  let certificates: ServedCertificates = { kitchen: null, domain: null };
  let contexts: { kitchen: tls.SecureContext | null; domain: tls.SecureContext | null } = {
    kitchen: null,
    domain: null,
  };

  function fallback() {
    return certificates.kitchen ?? certificates.domain;
  }

  async function sync(): Promise<void> {
    const pems = fallback();
    if (!target || !handler) return;
    if (!pems) {
      if (server) {
        const closing = server;
        server = null;
        closing.closeAllConnections();
        await new Promise<void>((resolve) => closing.close(() => resolve()));
        log().info('HTTPS is off');
      }
      return;
    }
    if (server) {
      server.setSecureContext({ cert: pems.cert, key: pems.key });
      return;
    }
    const created = https.createServer(
      {
        cert: pems.cert,
        key: pems.key,
        SNICallback: (servername, done) => {
          const name = servername.toLowerCase();
          if (certificates.domain && contexts.domain && name === certificates.domain.name) {
            done(null, contexts.domain);
          } else {
            done(null, contexts.kitchen ?? contexts.domain ?? undefined);
          }
        },
      },
      handler,
    );
    // Live updates hold a connection open for hours; nothing here may cut it.
    created.requestTimeout = 0;
    created.keepAliveTimeout = 72_000;
    await new Promise<void>((resolve, reject) => {
      created.once('error', reject);
      created.listen(target!.port, target!.host, () => {
        created.off('error', reject);
        resolve();
      });
    });
    server = created;
    log().info({ port: target.port }, 'HTTPS is on');
  }

  return {
    /** Passed to Fastify, which hands over its request handler this way. */
    serverFactory(fastifyHandler: http.RequestListener): http.Server {
      handler = fastifyHandler;
      return http.createServer(fastifyHandler);
    },

    /** Use these certificates from now on. */
    async serve(next: ServedCertificates): Promise<void> {
      certificates = next;
      contexts = {
        kitchen: next.kitchen ? tls.createSecureContext(next.kitchen) : null,
        domain: next.domain ? tls.createSecureContext(next.domain) : null,
      };
      await sync();
    },

    /** Start listening, once the server proper is up. Until then certificates only wait. */
    async start(port: number, host: string): Promise<void> {
      target = { port, host };
      await sync();
    },

    /** The port it is listening on, or null while HTTPS is off. */
    port(): number | null {
      const address = server?.address();
      return address && typeof address === 'object' ? address.port : null;
    },

    async close(): Promise<void> {
      target = null;
      if (server) {
        const closing = server;
        server = null;
        closing.closeAllConnections();
        await new Promise<void>((resolve) => closing.close(() => resolve()));
      }
    },
  };
}

export type HttpsListener = ReturnType<typeof createHttpsListener>;
