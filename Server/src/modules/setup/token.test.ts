import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, setupCodeAlways, setupTokenFor } from '../../app.js';
import { isPrivateAddress } from '../../lib/network.js';
import { ADMIN, TEST_CONFIG, useTestContext } from '../../test/harness.js';

const ctx = useTestContext();
const CODE = 'the-code-printed-at-install';
let production: FastifyInstance | null = null;

afterEach(async () => {
  await production?.close();
  production = null;
});

/** The same database, run the way a kitchen's server runs. */
async function productionApp(): Promise<FastifyInstance> {
  production = await buildApp(
    { ...TEST_CONFIG, NODE_ENV: 'production', SETUP_TOKEN: CODE },
    { db: ctx.db, serveClient: false },
  );
  await production.ready();
  return production;
}

describe('setting up a production server', () => {
  it('says a code is needed', async () => {
    const app = await productionApp();
    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toMatchObject({ needsSetup: true, setupTokenRequired: true });
  });

  it('refuses without the code from the install', async () => {
    const app = await productionApp();
    const missing = await app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(missing.statusCode).toBe(403);
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, setupToken: 'a-guess-at-the-code' },
    });
    expect(wrong.statusCode).toBe(403);

    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json().needsSetup).toBe(true);
  });

  it('sets up with the right code', async () => {
    const app = await productionApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, setupToken: CODE },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('when setup asks for a code', () => {
  const kitchen = { ...TEST_CONFIG, NODE_ENV: 'production' as const };

  async function status(app: FastifyInstance, extra: Record<string, unknown> = {}) {
    const response = await app.inject({ method: 'GET', url: '/api/setup/status', ...extra });
    return response.json().setupTokenRequired as boolean;
  }

  async function plainKitchen(): Promise<FastifyInstance> {
    production = await buildApp(kitchen, { db: ctx.db, serveClient: false });
    await production.ready();
    return production;
  }

  it('asks for none from the kitchen network when no code was set', async () => {
    const app = await plainKitchen();
    for (const remoteAddress of ['192.168.1.20', '10.0.0.7', '172.20.0.1', '100.101.102.103']) {
      expect(await status(app, { remoteAddress })).toBe(false);
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: ADMIN,
      remoteAddress: '192.168.1.20',
    });
    expect(response.statusCode).toBe(200);
  });

  it('asks a request from the internet for the code Mise made up', async () => {
    const app = await plainKitchen();
    expect(await status(app, { remoteAddress: '203.0.113.9' })).toBe(true);
    const refused = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: ADMIN,
      remoteAddress: '203.0.113.9',
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe('setup_token');

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, setupToken: app.setupToken },
      remoteAddress: '203.0.113.9',
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('asks for the code when the request came through a proxy or tunnel', async () => {
    const app = await plainKitchen();
    // A tunnel inside the network connects from a local address, but says who it forwards.
    expect(
      await status(app, {
        remoteAddress: '192.168.1.5',
        headers: { 'cf-connecting-ip': '198.51.100.4' },
      }),
    ).toBe(true);
    expect(
      await status(app, {
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': '198.51.100.4' },
      }),
    ).toBe(true);
  });

  it('always asks when a code was set, or behind HTTPS or a proxy', () => {
    expect(setupCodeAlways({ ...kitchen, SETUP_TOKEN: CODE })).toBe(true);
    expect(setupCodeAlways({ ...kitchen, COOKIE_SECURE: true })).toBe(true);
    expect(setupCodeAlways({ ...kitchen, TRUST_PROXY: 1 })).toBe(true);
    expect(setupCodeAlways(kitchen)).toBe(false);
  });

  it('always has a code in production, and never in development', () => {
    expect(setupTokenFor({ ...kitchen, SETUP_TOKEN: CODE })).toBe(CODE);
    expect(setupTokenFor(kitchen)).toMatch(/.{16,}/);
    expect(
      setupTokenFor({ ...TEST_CONFIG, NODE_ENV: 'development', SETUP_TOKEN: CODE }),
    ).toBeNull();
  });
});

describe('telling the kitchen network apart', () => {
  it('knows the private ranges, and nothing else', () => {
    for (const address of [
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.10',
      '127.0.0.1',
      '::1',
      '::ffff:192.168.1.4',
      'fd12:3456::1',
      'fe80::1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of [
      '8.8.8.8',
      '172.32.0.1',
      '100.128.0.1',
      '203.0.113.9',
      '2001:db8::1',
      '::ffff:8.8.8.8',
      '',
      'not-an-address',
    ]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
