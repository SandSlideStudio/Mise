import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { TEST_CONFIG, cookieFrom, setUpKitchen, useTestContext } from '../../test/harness.js';
import { isNewer, parseVersion, RELEASES_URL } from './service.js';

const ctx = useTestContext();
let app: FastifyInstance;
let admin: Record<string, string>;
let asked: string[];
let answer: () => Response;

const release = (tag: string) => () =>
  Response.json({
    tag_name: tag,
    html_url: `https://github.com/SandSlideStudio/Mise/releases/tag/${tag}`,
  });

beforeEach(async () => {
  asked = [];
  answer = release('v2.1.1');
  app = await buildApp(TEST_CONFIG, {
    db: ctx.db,
    serveClient: false,
    version: '2.1.0',
    releases: async (url) => {
      asked.push(url);
      return answer();
    },
  });
  await app.ready();
  admin = { mise_session: await setUpKitchen(app) };
});

afterEach(async () => {
  await app.close();
});

async function version(cookies: Record<string, string>) {
  return (await app.inject({ method: 'GET', url: '/api/version', cookies })).json();
}

describe('comparing versions', () => {
  it('reads plain versions with or without a v', () => {
    expect(parseVersion('v2.1.0')).toEqual([2, 1, 0]);
    expect(parseVersion('10.0.3')).toEqual([10, 0, 3]);
    expect(parseVersion('dev')).toBeNull();
    expect(parseVersion('2.1.0-rc.1')).toBeNull();
  });

  it('only calls a release newer when it is', () => {
    expect(isNewer('2.1.1', '2.1.0')).toBe(true);
    expect(isNewer('2.10.0', '2.9.9')).toBe(true);
    expect(isNewer('3.0.0', '2.99.99')).toBe(true);
    expect(isNewer('2.1.0', '2.1.0')).toBe(false);
    expect(isNewer('2.0.9', '2.1.0')).toBe(false);
    expect(isNewer('2.1.1', 'dev')).toBe(false);
  });
});

describe('the update check', () => {
  it('tells an administrator a newer release is out, with where to read about it', async () => {
    await app.updates.check();
    expect(asked).toEqual([RELEASES_URL]);
    expect(await version(admin)).toMatchObject({
      current: '2.1.0',
      checkEnabled: true,
      latest: '2.1.1',
      newer: true,
      releaseUrl: 'https://github.com/SandSlideStudio/Mise/releases/tag/v2.1.1',
      checkFailed: false,
    });
  });

  it('says nothing is newer when this is the latest', async () => {
    answer = release('v2.1.0');
    await app.updates.check();
    expect(await version(admin)).toMatchObject({ latest: '2.1.0', newer: false });
  });

  it('shows everyone the version, but only administrators the update', async () => {
    await app.updates.check();
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {
        displayName: 'Ana',
        role: 'sous_chef',
        email: 'ana@example.com',
        password: 'correct-horse-battery',
      },
      cookies: admin,
    });
    expect(created.statusCode).toBe(200);
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'correct-horse-battery' },
    });
    const chef = { mise_session: cookieFrom(signedIn, 'mise_session')! };
    expect(await version(chef)).toMatchObject({ current: '2.1.0', latest: null, newer: false });
  });

  it('keeps quiet about a check that could not reach GitHub', async () => {
    answer = () => new Response('rate limited', { status: 403 });
    await app.updates.check();
    expect(await version(admin)).toMatchObject({ latest: null, newer: false, checkFailed: true });
  });

  it('can be switched off by an administrator, and asks nobody while off', async () => {
    const off = await app.inject({
      method: 'PUT',
      url: '/api/version/check',
      payload: { enabled: false },
      cookies: admin,
    });
    expect(off.json()).toMatchObject({ checkEnabled: false, latest: null });
    expect(await app.updates.enabled()).toBe(false);

    const on = await app.inject({
      method: 'PUT',
      url: '/api/version/check',
      payload: { enabled: true },
      cookies: admin,
    });
    // Switching it back on checks straight away.
    expect(on.json()).toMatchObject({ checkEnabled: true, latest: '2.1.1', newer: true });
    expect(asked).toHaveLength(1);
  });
});
