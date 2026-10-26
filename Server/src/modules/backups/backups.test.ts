import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import type { Database } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import {
  ADMIN,
  TEST_CONFIG,
  cookieFrom,
  createTestDatabase,
  resetDatabase,
  setUpKitchen,
} from '../../test/harness.js';
import { formatRecoveryKey, generateRecoveryKey } from './crypto.js';
import { BACKED_UP, NOT_BACKED_UP, restoreTables } from './data.js';
import { isDue, problemOf } from './service.js';

let client: PGlite;
let db: Database;
let dir: string;
let app: FastifyInstance;

async function build(database: Database, name: string): Promise<FastifyInstance> {
  const built = await buildApp(
    {
      ...TEST_CONFIG,
      UPLOAD_DIR: path.join(dir, name, 'uploads'),
      BACKUP_DIR: path.join(dir, name, 'backups'),
    },
    { db: database, serveClient: false },
  );
  await built.ready();
  return built;
}

/** A second, empty server to restore onto. */
async function emptyServer() {
  const second = await createTestDatabase();
  const name = `empty-${randomUUID()}`;
  const server = await build(second.db, name);
  return {
    app: server,
    uploads: path.join(dir, name, 'uploads'),
    close: async () => {
      await server.close();
      await second.client.close();
    },
  };
}

function multipart(
  fields: Record<string, string>,
  file: { field: string; type: string; data: Buffer },
) {
  const boundary = `----mise${randomUUID()}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="upload"\r\nContent-Type: ${file.type}\r\n\r\n`,
    ),
    file.data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

async function restore(target: FastifyInstance, backup: Buffer, recoveryKey: string) {
  const body = multipart(
    { recoveryKey },
    { field: 'backup', type: 'application/octet-stream', data: backup },
  );
  return target.inject({ method: 'POST', url: '/api/setup/restore', ...body });
}

/** A kitchen with one recipe and one plating photo. */
async function stockedKitchen() {
  const cookies = { mise_session: await setUpKitchen(app) };
  const recipe = await app.inject({
    method: 'POST',
    url: '/api/recipes',
    cookies,
    payload: { name: 'Beurre blanc', type: 'prep', yield: { value: 1, unit: 'l' } },
  });
  expect(recipe.statusCode).toBe(200);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(256)]);
  const photo = await app.inject({
    method: 'POST',
    url: `/api/recipes/${recipe.json().id}/photos`,
    cookies,
    ...multipart({}, { field: 'file', type: 'image/png', data: png }),
  });
  expect(photo.statusCode).toBe(200);
  return { cookies, recipeId: recipe.json().id as string };
}

async function backUp(cookies: Record<string, string>) {
  const run = await app.inject({ method: 'POST', url: '/api/backups/run', cookies });
  expect(run.statusCode).toBe(200);
  const [newest] = run.json().files;
  const file = await app.inject({
    method: 'GET',
    url: `/api/backups/files/${newest.name}`,
    cookies,
  });
  expect(file.statusCode).toBe(200);
  const key = await app.inject({ method: 'GET', url: '/api/backups/key', cookies });
  return { status: run.json(), file: file.rawPayload, key: key.json().recoveryKey as string };
}

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  dir = await mkdtemp(path.join(os.tmpdir(), 'mise-backups-'));
});

afterAll(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetDatabase(db);
  await rm(path.join(dir, 'main'), { recursive: true, force: true });
  app = await build(db, 'main');
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

describe('backing up and restoring', () => {
  it('puts the whole kitchen back on an empty server, photos and sign-ins included', async () => {
    const { cookies, recipeId } = await stockedKitchen();
    const { status, file, key } = await backUp(cookies);
    expect(status.lastError).toBeNull();
    expect(status.files).toHaveLength(1);
    expect(file.subarray(0, 8).toString()).toBe('MISEBAK1');

    const second = await emptyServer();
    try {
      // Typed off paper: lower case, spaces instead of dashes.
      const typed = key.toLowerCase().replace(/-/g, ' ');
      const restored = await restore(second.app, file, typed);
      expect(restored.statusCode).toBe(200);
      expect(restored.json()).toEqual({
        kitchenName: ADMIN.kitchenName,
        staff: 1,
        recipes: 1,
        photos: 1,
      });

      const signIn = await second.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: ADMIN.password },
      });
      expect(signIn.statusCode).toBe(200);
      const restoredCookies = { mise_session: cookieFrom(signIn, 'mise_session')! };

      const recipe = await second.app.inject({
        method: 'GET',
        url: `/api/recipes/${recipeId}`,
        cookies: restoredCookies,
      });
      expect(recipe.json().name).toBe('Beurre blanc');
      expect(recipe.json().photos).toHaveLength(1);
      expect(await readdir(second.uploads)).toHaveLength(1);

      // The key that opened the backup opens the next ones, and was evidently written down.
      const backups = await second.app.inject({
        method: 'GET',
        url: '/api/backups',
        cookies: restoredCookies,
      });
      expect(backups.json().keyConfirmed).toBe(true);
      const sameKey = await second.app.inject({
        method: 'GET',
        url: '/api/backups/key',
        cookies: restoredCookies,
      });
      expect(sameKey.json().recoveryKey).toBe(key);
    } finally {
      await second.close();
    }
  });

  it('brings back the dish card settings and logo', async () => {
    const { cookies } = await stockedKitchen();
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)]);
    const logo = await app.inject({
      method: 'POST',
      url: '/api/dish-cards/logo',
      cookies,
      ...multipart({}, { field: 'file', type: 'image/png', data: png }),
    });
    expect(logo.statusCode).toBe(200);
    await app.inject({
      method: 'PATCH',
      url: '/api/dish-cards/settings',
      cookies,
      payload: { warnings: { nl: 'Eigendom van de keuken.' }, theme: 'night' },
    });
    const { file, key } = await backUp(cookies);

    const second = await emptyServer();
    try {
      const restored = await restore(second.app, file, key);
      expect(restored.json().photos).toBe(2);
      const signIn = await second.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: ADMIN.email, password: ADMIN.password },
      });
      const restoredCookies = { mise_session: cookieFrom(signIn, 'mise_session')! };
      const settings = await second.app.inject({
        method: 'GET',
        url: '/api/dish-cards/settings',
        cookies: restoredCookies,
      });
      expect(settings.json()).toMatchObject({
        logoUrl: logo.json().logoUrl,
        warnings: { nl: 'Eigendom van de keuken.' },
        theme: 'night',
      });
      const image = await second.app.inject({
        method: 'GET',
        url: settings.json().logoUrl,
        cookies: restoredCookies,
      });
      expect(image.rawPayload.equals(png)).toBe(true);
    } finally {
      await second.close();
    }
  });

  it('refuses a wrong key, a file that is not a backup, and a server already in use', async () => {
    const { cookies } = await stockedKitchen();
    const { file, key } = await backUp(cookies);

    const second = await emptyServer();
    try {
      const wrongKey = await restore(second.app, file, generateRecoveryKey());
      expect(wrongKey.statusCode).toBe(400);
      expect(wrongKey.json().error.code).toBe('backup_wrong_key');

      const badKey = await restore(second.app, file, 'not a key');
      expect(badKey.json().error.code).toBe('backup_bad_key');

      const notBackup = await restore(second.app, randomBytes(400), key);
      expect(notBackup.json().error.code).toBe('backup_not_a_backup');

      // Nothing was half-restored along the way.
      const status = await second.app.inject({ method: 'GET', url: '/api/setup/status' });
      expect(status.json().needsSetup).toBe(true);
    } finally {
      await second.close();
    }

    const inUse = await restore(app, file, key);
    expect(inUse.statusCode).toBe(404);
  });

  it('keeps backups to administrators', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      cookies,
      payload: {
        displayName: 'Ana',
        role: 'head_chef',
        email: 'ana@example.com',
        password: 'another-long-password',
      },
    });
    expect(created.statusCode).toBe(200);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'ana@example.com', password: 'another-long-password' },
    });
    const headChef = { mise_session: cookieFrom(signIn, 'mise_session')! };

    for (const [method, url] of [
      ['GET', '/api/backups'],
      ['GET', '/api/backups/key'],
      ['POST', '/api/backups/run'],
    ] as const) {
      const response = await app.inject({ method, url, cookies: headChef });
      expect(response.statusCode).toBe(403);
    }
    const anonymous = await app.inject({ method: 'GET', url: '/api/backups' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('only serves files that are backups', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    for (const name of ['..%2F..%2Fpackage.json', 'mise-backup-20260101-000000.mise', '.env']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/backups/files/${name}`,
        cookies,
      });
      expect(response.statusCode).toBe(404);
    }
  });

  it("doesn't write a new file for an unchanged kitchen, unless asked to", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
    const { cookies } = await stockedKitchen();

    await app.backups.run({ force: false });
    vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));
    await app.backups.run({ force: false });
    let status = (await app.inject({ method: 'GET', url: '/api/backups', cookies })).json();
    expect(status.files).toHaveLength(1);
    expect(status.lastSuccessAt).toBe('2026-10-21T04:00:00.000Z');

    await app.inject({
      method: 'POST',
      url: '/api/recipes',
      cookies,
      payload: { name: 'Sauce vierge', type: 'prep', yield: { value: 1, unit: 'l' } },
    });
    vi.setSystemTime(new Date('2026-10-22T04:00:00Z'));
    await app.backups.run({ force: false });
    status = (await app.inject({ method: 'GET', url: '/api/backups', cookies })).json();
    expect(status.files).toHaveLength(2);
  });
});

describe('restoring a backup from 1.x', () => {
  it('brings back the running list but leaves old service lists behind', async () => {
    // A 1.x backup: one running-list line, and two lines from a service.
    const prepTask = JSON.stringify([
      { id: randomUUID(), service_id: null, description: 'Brunoise shallots', status: 'open' },
      { id: randomUUID(), service_id: randomUUID(), description: 'Chicken stock', status: 'done' },
      { id: randomUUID(), service_id: randomUUID(), description: 'Velouté', status: 'open' },
    ]);
    const counts = await db.transaction((tx) =>
      restoreTables(tx, new Map([['prep_task', prepTask]])),
    );
    expect(counts.get('prep_task')).toBe(1);
    const rows = await db.select().from(schema.prepTasks);
    expect(rows.map((row) => row.description)).toEqual(['Brunoise shallots']);
  });
});

describe('the nightly schedule', () => {
  it('runs at night where the kitchen is, as the setup screens report it', async () => {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, timeZone: 'Europe/Amsterdam' },
    });
    const cookies = { mise_session: cookieFrom(setup, 'mise_session')! };
    const status = await app.inject({ method: 'GET', url: '/api/backups', cookies });
    expect(status.json()).toMatchObject({ timeZone: 'Europe/Amsterdam', hour: 4 });
  });
});

describe('sending backups to a NAS', () => {
  let nas: http.Server;
  let address: string;
  const stored = new Map<string, Buffer>();

  beforeAll(async () => {
    const expected = `Basic ${Buffer.from('chef:secret').toString('base64')}`;
    nas = http.createServer((request, response) => {
      if (request.headers.authorization !== expected) {
        response.writeHead(401).end();
        return;
      }
      const name = decodeURIComponent(request.url!.replace(/^\/dav\/?/, ''));
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'PUT') {
          stored.set(name, Buffer.concat(chunks));
          response.writeHead(201).end();
        } else if (request.method === 'DELETE') {
          response.writeHead(stored.delete(name) ? 204 : 404).end();
        } else if (request.method === 'PROPFIND') {
          const hrefs = ['/dav/', ...[...stored.keys()].map((file) => `/dav/${file}`)]
            .map((href) => `<d:response><d:href>${href}</d:href></d:response>`)
            .join('');
          response
            .writeHead(207, { 'content-type': 'application/xml' })
            .end(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">${hrefs}</d:multistatus>`);
        } else {
          response.writeHead(405).end();
        }
      });
    });
    await new Promise<void>((resolve) => nas.listen(0, '127.0.0.1', resolve));
    address = `http://127.0.0.1:${(nas.address() as AddressInfo).port}/dav`;
  });

  afterAll(async () => {
    await new Promise((resolve) => nas.close(resolve));
  });

  beforeEach(() => stored.clear());

  it('uploads each backup and keeps only as many as asked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
    const { cookies } = await stockedKitchen();

    const test = await app.inject({
      method: 'POST',
      url: '/api/backups/test',
      cookies,
      payload: { webdavUrl: address, webdavUsername: 'chef', webdavPassword: 'secret' },
    });
    expect(test.statusCode).toBe(204);
    expect(stored.size).toBe(0);

    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/backups',
      cookies,
      payload: {
        destination: 'webdav',
        webdavUrl: address,
        webdavUsername: 'chef',
        webdavPassword: 'secret',
        keepRemote: 1,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ destination: 'webdav', hasWebdavPassword: true });

    await app.backups.run({ force: true });
    expect([...stored.keys()]).toEqual(['mise-backup-20261020-040000.mise']);

    vi.setSystemTime(new Date('2026-10-21T04:00:00Z'));
    await app.backups.run({ force: true });
    expect([...stored.keys()]).toEqual(['mise-backup-20261021-040000.mise']);
    const status = (await app.inject({ method: 'GET', url: '/api/backups', cookies })).json();
    expect(status.lastError).toBeNull();
  });

  it('can be tested and chosen during setup, before the kitchen exists', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/setup/backups/test',
      payload: { webdavUrl: address, webdavUsername: 'chef', webdavPassword: 'wrong' },
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('backup_auth');

    const right = await app.inject({
      method: 'POST',
      url: '/api/setup/backups/test',
      payload: { webdavUrl: address, webdavUsername: 'chef', webdavPassword: 'secret' },
    });
    expect(right.statusCode).toBe(204);

    const setUp = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: {
        ...ADMIN,
        backups: {
          destination: 'webdav',
          webdavUrl: address,
          webdavUsername: 'chef',
          webdavPassword: 'secret',
        },
      },
    });
    expect(setUp.statusCode).toBe(200);
    const cookies = { mise_session: cookieFrom(setUp, 'mise_session')! };
    const status = (await app.inject({ method: 'GET', url: '/api/backups', cookies })).json();
    expect(status).toMatchObject({
      destination: 'webdav',
      webdavUrl: address,
      webdavUsername: 'chef',
      hasWebdavPassword: true,
    });

    // Once the kitchen exists, the setup steps are gone.
    const after = await app.inject({
      method: 'POST',
      url: '/api/setup/backups/test',
      payload: { webdavUrl: address, webdavUsername: 'chef', webdavPassword: 'secret' },
    });
    expect(after.statusCode).toBe(404);
  });

  it('refuses a NAS without an address in setup', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ADMIN, backups: { destination: 'webdav' } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('says when the NAS turns the password down', async () => {
    const { cookies } = await stockedKitchen();
    const test = await app.inject({
      method: 'POST',
      url: '/api/backups/test',
      cookies,
      payload: { webdavUrl: address, webdavUsername: 'chef', webdavPassword: 'wrong' },
    });
    expect(test.statusCode).toBe(400);
    expect(test.json().error.code).toBe('backup_auth');

    await app.inject({
      method: 'PATCH',
      url: '/api/backups',
      cookies,
      payload: {
        destination: 'webdav',
        webdavUrl: address,
        webdavUsername: 'chef',
        webdavPassword: 'wrong',
      },
    });
    const run = await app.inject({ method: 'POST', url: '/api/backups/run', cookies });
    expect(run.json()).toMatchObject({ lastError: 'auth', problem: 'failed' });
    // The copy on this machine was still made.
    expect(run.json().files).toHaveLength(1);
  });

  it('wants an address before sending anywhere', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/backups',
      cookies,
      payload: { destination: 'webdav' },
    });
    expect(response.statusCode).toBe(400);
    const zone = await app.inject({
      method: 'PATCH',
      url: '/api/backups',
      cookies,
      payload: { timeZone: 'Mars/Olympus_Mons' },
    });
    expect(zone.statusCode).toBe(400);
  });
});

describe('the rules behind it', () => {
  it('backs up every table, apart from the ones left out on purpose', () => {
    const tables = Object.values(schema).filter((value) => is(value, PgTable));
    for (const table of tables) {
      expect([...BACKED_UP, ...NOT_BACKED_UP]).toContain(table);
    }
  });

  it('reads a recovery key however it was typed', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    const sloppy = key.toLowerCase().replace(/-/g, '').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(formatRecoveryKey(sloppy)).toBe(key);
  });

  it('runs at the chosen hour, and catches up after a missed night', () => {
    const base = { hour: 4, timeZone: 'Europe/Amsterdam' };
    const at = (iso: string) => new Date(iso);
    // 04:10 in Amsterdam is 02:10 UTC in summer time.
    expect(
      isDue(
        {
          ...base,
          lastAttemptAt: at('2026-07-01T02:00:00Z'),
          lastSuccessAt: at('2026-07-01T02:00:00Z'),
        },
        at('2026-07-02T02:10:00Z'),
      ),
    ).toBe(true);
    expect(
      isDue(
        {
          ...base,
          lastAttemptAt: at('2026-07-02T02:05:00Z'),
          lastSuccessAt: at('2026-07-02T02:05:00Z'),
        },
        at('2026-07-02T02:30:00Z'),
      ),
    ).toBe(false);
    // Off all night: the next look after a day and a bit catches up.
    expect(
      isDue(
        {
          ...base,
          lastAttemptAt: at('2026-07-01T02:00:00Z'),
          lastSuccessAt: at('2026-07-01T02:00:00Z'),
        },
        at('2026-07-02T09:00:00Z'),
      ),
    ).toBe(true);
    expect(
      isDue({ ...base, lastAttemptAt: null, lastSuccessAt: null }, at('2026-07-02T12:00:00Z')),
    ).toBe(true);
  });

  it('warns about a failure first, then an old backup, then an unprinted key', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const fresh = new Date('2026-07-10T04:00:00Z');
    const old = new Date('2026-07-07T04:00:00Z');
    expect(
      problemOf({ lastError: 'auth', lastSuccessAt: fresh, keyConfirmedAt: null }, null, now),
    ).toBe('failed');
    expect(problemOf({ lastError: null, lastSuccessAt: old, keyConfirmedAt: now }, null, now)).toBe(
      'stale',
    );
    expect(
      problemOf({ lastError: null, lastSuccessAt: fresh, keyConfirmedAt: null }, null, now),
    ).toBe('key_unconfirmed');
    expect(
      problemOf({ lastError: null, lastSuccessAt: fresh, keyConfirmedAt: now }, null, now),
    ).toBeNull();
    // A kitchen set up yesterday hasn't missed anything yet.
    expect(
      problemOf({ lastError: null, lastSuccessAt: null, keyConfirmedAt: now }, fresh, now),
    ).toBeNull();
  });
});
