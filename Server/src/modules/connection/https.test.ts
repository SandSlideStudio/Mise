import { afterEach, describe, expect, it } from 'vitest';
import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../../app.js';
import { connectionSettings } from '../../db/schema.js';
import {
  ADMIN,
  TEST_CONFIG,
  cookieFrom,
  setUpKitchen,
  useTestContext,
} from '../../test/harness.js';
import type { issueDomainCertificate } from './acme.js';
import { authorityPermits, createAuthority, issueKitchenCertificate } from './certificates.js';
import { CONNECTION_ID } from './service.js';

const ctx = useTestContext();
const INSIDE = '192.168.1.20';
const OUTSIDE = '203.0.113.9';
const DOMAIN = 'mise.example.com';

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

/**
 * Let's Encrypt, played here: answers its own HTTP check through the real
 * route, then hands back a certificate for the domain from a made-up authority.
 */
function fakeLetsEncrypt(behaviour: 'works' | 'fails' = 'works') {
  const calls: string[] = [];
  let checked: string | null = null;
  const issue: typeof issueDomainCertificate = async ({ domain, answers }) => {
    calls.push(domain);
    answers.set('the-token', 'the-token.key-authorisation');
    const check = await app!.inject({
      method: 'GET',
      url: '/.well-known/acme-challenge/the-token',
      remoteAddress: '66.133.109.36',
      headers: { host: domain },
    });
    checked = check.body;
    answers.delete('the-token');
    if (behaviour === 'fails') {
      throw new Error(
        'urn:ietf:params:acme:error:connection - 203.0.113.9: Timeout during connect (likely firewall problem)',
      );
    }
    const authority = await createAuthority('Pretend Encrypt');
    const issued = await issueKitchenCertificate(authority, [domain]);
    return { ...issued, accountKey: 'account-key' };
  };
  return { issue, calls, checked: () => checked };
}

async function start(acme?: typeof issueDomainCertificate): Promise<FastifyInstance> {
  app = await buildApp(TEST_CONFIG, { db: ctx.db, serveClient: false, acme });
  await app.ready();
  return app;
}

async function signIn(server: FastifyInstance): Promise<string> {
  await setUpKitchen(server);
  const response = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: ADMIN.email, password: ADMIN.password },
    remoteAddress: INSIDE,
  });
  return `mise_session=${cookieFrom(response, 'mise_session')}`;
}

function as(
  server: FastifyInstance,
  cookie: string,
  method: 'GET' | 'PUT' | 'POST' | 'DELETE',
  url: string,
  payload?: object,
) {
  return server.inject({
    method,
    url,
    payload,
    remoteAddress: INSIDE,
    headers: { cookie, host: 'mise.local' },
  });
}

/** A real HTTPS request, trusting only the given authority. */
function fetchOverHttps(
  port: number,
  path: string,
  options: { ca?: string; servername?: string; anyCertificate?: boolean } = {},
) {
  return new Promise<{ status: number; body: string; cookies: string[]; hsts?: string }>(
    (resolve, reject) => {
      https
        .get(
          {
            host: '127.0.0.1',
            port,
            path,
            ca: options.ca,
            servername: options.servername,
            ...(options.anyCertificate ? { rejectUnauthorized: false } : {}),
            headers: { host: options.servername ?? '127.0.0.1' },
          },
          (response) => {
            let body = '';
            response.on('data', (chunk) => (body += chunk));
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                body,
                cookies: [response.headers['set-cookie'] ?? []].flat(),
                hsts: response.headers['strict-transport-security'],
              }),
            );
          },
        )
        .on('error', reject);
    },
  );
}

/** Which certificate the server shows a browser asking for this name. */
function certificateFor(port: number, servername?: string): Promise<X509Certificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: '127.0.0.1', port, servername, rejectUnauthorized: false },
      () => {
        const raw = socket.getPeerX509Certificate();
        socket.end();
        if (raw) resolve(raw);
        else reject(new Error('no certificate'));
      },
    );
    socket.on('error', reject);
  });
}

describe('the kitchen certificate', () => {
  it('serves HTTPS that a tablet trusting the kitchen authority accepts', async () => {
    const server = await start();
    const admin = await signIn(server);
    await server.httpsListener.start(0, '127.0.0.1');
    expect(server.httpsListener.port()).toBeNull();

    const on = await as(server, admin, 'PUT', '/api/connection/kitchen-https', {
      names: ['127.0.0.1', 'Mise.Local'],
    });
    expect(on.statusCode).toBe(200);
    expect(on.json().https.kitchen).toMatchObject({
      enabled: true,
      names: ['127.0.0.1', 'mise.local'],
    });
    const port = server.httpsListener.port()!;
    expect(port).toBeGreaterThan(0);

    const download = await server.inject({
      method: 'GET',
      url: '/api/connection/kitchen-certificate.crt',
      remoteAddress: INSIDE,
    });
    expect(download.headers['content-type']).toContain('application/x-x509-ca-cert');
    const authority = download.body;
    expect(new X509Certificate(authority).fingerprint256).toBe(on.json().https.kitchen.fingerprint);

    const health = await fetchOverHttps(port, '/api/health', { ca: authority });
    expect(health.status).toBe(200);
    // Without trusting it, a browser refuses.
    await expect(fetchOverHttps(port, '/api/health')).rejects.toThrow();
  });

  it('keeps sign-in cookies to HTTPS when signed in over it', async () => {
    const server = await start();
    const admin = await signIn(server);
    await server.httpsListener.start(0, '127.0.0.1');
    await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['127.0.0.1'] });
    const authority = server.connection.authority()!;
    const port = server.httpsListener.port()!;

    const response = await new Promise<string[]>((resolve, reject) => {
      const request = https.request(
        {
          host: '127.0.0.1',
          port,
          path: '/api/auth/login',
          method: 'POST',
          ca: authority,
          headers: { 'content-type': 'application/json' },
        },
        (res) => {
          res.resume();
          resolve([res.headers['set-cookie'] ?? []].flat());
        },
      );
      request.on('error', reject);
      request.end(JSON.stringify({ email: ADMIN.email, password: ADMIN.password }));
    });
    expect(response.find((c) => c.startsWith('mise_session='))).toMatch(/; Secure/i);
  });

  it('keeps the same authority when turned off and on, so no tablet trusts it again', async () => {
    const server = await start();
    const admin = await signIn(server);
    await server.httpsListener.start(0, '127.0.0.1');
    const first = (
      await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['127.0.0.1'] })
    ).json();
    const off = await as(server, admin, 'DELETE', '/api/connection/kitchen-https');
    expect(off.json().https.kitchen.enabled).toBe(false);
    expect(server.httpsListener.port()).toBeNull();
    const again = (
      await as(server, admin, 'PUT', '/api/connection/kitchen-https', {
        names: ['127.0.0.1', '192.168.1.50'],
      })
    ).json();
    expect(again.https.kitchen.fingerprint).toBe(first.https.kitchen.fingerprint);
    expect(server.httpsListener.port()).toBeGreaterThan(0);
  });

  it('comes back on after a restart', async () => {
    const server = await start();
    const admin = await signIn(server);
    await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['127.0.0.1'] });
    await server.close();
    app = null;

    const again = await start();
    await again.httpsListener.start(0, '127.0.0.1');
    const health = await fetchOverHttps(again.httpsListener.port()!, '/api/health', {
      ca: again.connection.authority()!,
    });
    expect(health.status).toBe(200);
  });

  it('vouches only for the kitchen network, so a tablet trusting it trusts nothing else', async () => {
    const server = await start();
    const admin = await signIn(server);
    const on = await as(server, admin, 'PUT', '/api/connection/kitchen-https', {
      names: ['192.168.1.50', 'mise'],
    });
    expect(on.statusCode).toBe(200);
    const authority = server.connection.authority()!;
    for (const name of ['192.168.1.50', '10.0.0.7', 'mise', 'pass.mise', 'mise.local', 'fd00::1'])
      expect(authorityPermits(authority, name), name).toBe(true);
    for (const name of ['www.mybank.com', '8.8.8.8', 'mise.com'])
      expect(authorityPermits(authority, name), name).toBe(false);

    // Later, a name it can't vouch for is refused rather than served broken.
    const outside = await as(server, admin, 'PUT', '/api/connection/kitchen-https', {
      names: ['192.168.1.50', 'kitchen.example.com'],
    });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().error.code).toBe('name_outside_kitchen');
  });

  it('takes only addresses and host names', async () => {
    const server = await start();
    const admin = await signIn(server);
    for (const names of [['http://192.168.1.50'], ['192.168.1.50:3000'], [], ['a b']]) {
      expect(
        (await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names })).statusCode,
        String(names),
      ).toBe(400);
    }
  });

  it('tells a tablet, before anyone signs in, what there is to trust', async () => {
    const server = await start();
    const admin = await signIn(server);
    const before = await server.inject({
      method: 'GET',
      url: '/api/connection/trust',
      remoteAddress: INSIDE,
    });
    expect(before.json()).toMatchObject({ enabled: false, fingerprint: null });
    expect(
      (
        await server.inject({
          method: 'GET',
          url: '/api/connection/kitchen-certificate.crt',
          remoteAddress: INSIDE,
        })
      ).statusCode,
    ).toBe(404);

    await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['192.168.1.50'] });
    const after = await server.inject({
      method: 'GET',
      url: '/api/connection/trust',
      remoteAddress: INSIDE,
    });
    expect(after.json()).toMatchObject({
      enabled: true,
      names: ['192.168.1.50'],
      fingerprint: expect.stringMatching(/^[0-9A-F:]+$/),
    });
  });

  it('is renewed by itself a month before it runs out', async () => {
    const server = await start();
    const admin = await signIn(server);
    await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['192.168.1.50'] });
    const soon = new Date(Date.now() + 10 * 86_400_000);
    await ctx.db
      .update(connectionSettings)
      .set({ kitchenExpiresAt: soon })
      .where(eq(connectionSettings.id, CONNECTION_ID));
    await server.connection.load();
    const fingerprint = server.connection.https().kitchen.fingerprint;

    await server.connection.renew('The Test Kitchen');
    const renewed = server.connection.https().kitchen;
    expect(renewed.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * 86_400_000);
    expect(renewed.fingerprint).toBe(fingerprint);
  });

  it('is for administrators only', async () => {
    const server = await start();
    await signIn(server);
    const anyone = await server.inject({
      method: 'PUT',
      url: '/api/connection/kitchen-https',
      payload: { names: ['192.168.1.50'] },
      remoteAddress: INSIDE,
    });
    expect(anyone.statusCode).toBe(401);
  });
});

describe('a certificate for the domain', () => {
  async function withDomain(acme: typeof issueDomainCertificate) {
    const server = await start(acme);
    const admin = await signIn(server);
    await as(server, admin, 'PUT', '/api/connection', { outsideDomain: DOMAIN });
    return { server, admin };
  }

  it('asks Let’s Encrypt, answers its check, and turns HTTPS on for the domain', async () => {
    const letsEncrypt = fakeLetsEncrypt();
    const { server, admin } = await withDomain(letsEncrypt.issue);
    await server.httpsListener.start(0, '127.0.0.1');

    const response = await as(server, admin, 'POST', '/api/connection/domain-https');
    expect(response.statusCode).toBe(200);
    expect(letsEncrypt.calls).toEqual([DOMAIN]);
    expect(letsEncrypt.checked()).toBe('the-token.key-authorisation');
    expect(response.json().https.domain).toMatchObject({
      enabled: true,
      domain: DOMAIN,
      error: null,
    });

    // The check only answers while a certificate is being fetched.
    const later = await server.inject({
      method: 'GET',
      url: '/.well-known/acme-challenge/the-token',
      remoteAddress: OUTSIDE,
      headers: { host: DOMAIN },
    });
    expect(later.statusCode).toBe(404);
  });

  it('shows the domain certificate to a browser asking for the domain, the kitchen one otherwise', async () => {
    const { server, admin } = await withDomain(fakeLetsEncrypt().issue);
    await server.httpsListener.start(0, '127.0.0.1');
    await as(server, admin, 'PUT', '/api/connection/kitchen-https', { names: ['127.0.0.1'] });
    await as(server, admin, 'POST', '/api/connection/domain-https');
    const port = server.httpsListener.port()!;

    expect((await certificateFor(port, DOMAIN)).subjectAltName).toBe(`DNS:${DOMAIN}`);
    expect((await certificateFor(port)).subjectAltName).toBe('IP Address:127.0.0.1');
    expect((await certificateFor(port, 'mise.local')).subjectAltName).toBe('IP Address:127.0.0.1');

    // On its own domain over HTTPS, the browser is told to stay on HTTPS; on
    // the kitchen network's addresses, never.
    const onDomain = await fetchOverHttps(port, '/api/health', {
      servername: DOMAIN,
      anyCertificate: true,
    });
    expect(onDomain.hsts).toBe('max-age=31536000');
    const inKitchen = await fetchOverHttps(port, '/api/health', { anyCertificate: true });
    expect(inKitchen.hsts).toBeUndefined();
  });

  it('sends plain HTTP on the domain over to HTTPS, but not Let’s Encrypt’s check or the kitchen network address', async () => {
    const { server, admin } = await withDomain(fakeLetsEncrypt().issue);
    await as(server, admin, 'POST', '/api/connection/domain-https');

    const plain = await server.inject({
      method: 'GET',
      url: '/login?next=%2F',
      remoteAddress: OUTSIDE,
      headers: { host: DOMAIN },
    });
    expect(plain.statusCode).toBe(301);
    expect(plain.headers.location).toBe(`https://${DOMAIN}/login?next=%2F`);

    const check = await server.inject({
      method: 'GET',
      url: '/.well-known/acme-challenge/x',
      remoteAddress: OUTSIDE,
      headers: { host: DOMAIN },
    });
    expect(check.statusCode).toBe(404);
    const local = await server.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: INSIDE,
      headers: { host: '192.168.1.50:3000' },
    });
    expect(local.statusCode).toBe(200);
  });

  it('says why, in Let’s Encrypt’s words, when it fails, and leaves HTTPS off', async () => {
    const { server, admin } = await withDomain(fakeLetsEncrypt('fails').issue);
    const response = await as(server, admin, 'POST', '/api/connection/domain-https');
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({
      code: 'certificate_failed',
      message: expect.stringContaining('Timeout during connect'),
    });

    const after = (await as(server, admin, 'GET', '/api/connection')).json();
    expect(after.https.domain).toMatchObject({
      enabled: false,
      error: expect.stringContaining('firewall'),
    });
    const plain = await server.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: OUTSIDE,
      headers: { host: DOMAIN },
    });
    expect(plain.statusCode).toBe(200);
  });

  it('needs the address from outside first', async () => {
    const server = await start(fakeLetsEncrypt().issue);
    const admin = await signIn(server);
    const response = await as(server, admin, 'POST', '/api/connection/domain-https');
    expect(response.json().error.code).toBe('no_domain');
  });

  it('fetches anew when the outside address changes, and when it nears its end', async () => {
    const letsEncrypt = fakeLetsEncrypt();
    const { server, admin } = await withDomain(letsEncrypt.issue);
    await as(server, admin, 'POST', '/api/connection/domain-https');

    await server.connection.renew('The Test Kitchen');
    expect(letsEncrypt.calls).toHaveLength(1);

    await as(server, admin, 'PUT', '/api/connection', { outsideDomain: 'kitchen.example.com' });
    await server.connection.renew('The Test Kitchen');
    expect(letsEncrypt.calls).toEqual([DOMAIN, 'kitchen.example.com']);

    await ctx.db
      .update(connectionSettings)
      .set({ domainExpiresAt: new Date(Date.now() + 5 * 86_400_000) })
      .where(eq(connectionSettings.id, CONNECTION_ID));
    await server.connection.load();
    await server.connection.renew('The Test Kitchen');
    expect(letsEncrypt.calls).toHaveLength(3);
  });
});
