import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, setupTokenFor } from '../../app.js';
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

  it('asks for none on a kitchen network when no code was set', async () => {
    expect(setupTokenFor(kitchen)).toBeNull();
    production = await buildApp(kitchen, { db: ctx.db, serveClient: false });
    const status = await production.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toMatchObject({ needsSetup: true, setupTokenRequired: false });
    const response = await production.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    expect(response.statusCode).toBe(200);
  });

  it('uses the code that was set', () => {
    expect(setupTokenFor({ ...kitchen, SETUP_TOKEN: CODE })).toBe(CODE);
  });

  it('always asks behind HTTPS or a proxy, making a code up when none was set', () => {
    expect(setupTokenFor({ ...kitchen, COOKIE_SECURE: true })).toMatch(/.{16,}/);
    expect(setupTokenFor({ ...kitchen, TRUST_PROXY: 1 })).toMatch(/.{16,}/);
  });

  it('never asks in development', () => {
    expect(
      setupTokenFor({ ...TEST_CONFIG, NODE_ENV: 'development', SETUP_TOKEN: CODE }),
    ).toBeNull();
  });
});
