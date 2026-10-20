import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import type { Database } from '../../db/client.js';
import {
  TEST_CONFIG,
  createTestDatabase,
  resetDatabase,
  setUpKitchen,
} from '../../test/harness.js';

/**
 * A stand-in for Microsoft's sign-in and OneDrive, close enough to the real
 * thing: a code that has to be approved, refresh tokens that rotate, upload
 * sessions taken in pieces, and an app folder that can be listed and pruned.
 */
const microsoft = {
  approved: false,
  declined: false,
  /** Refresh tokens Microsoft would still accept. */
  valid: new Set<string>(),
  issued: 0,
  files: new Map<string, Buffer>(),
  pieces: 0,
};

let server: http.Server;
let base: string;

function reply(response: http.ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function newTokens() {
  microsoft.issued += 1;
  const refresh = `refresh-${microsoft.issued}`;
  microsoft.valid.add(refresh);
  return { access_token: `access-${microsoft.issued}`, refresh_token: refresh };
}

async function handle(request: http.IncomingMessage, response: http.ServerResponse) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  const url = new URL(request.url!, base);
  const route = decodeURIComponent(url.pathname);

  if (route === '/login/devicecode') {
    return reply(response, 200, {
      device_code: 'device-1',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://microsoft.com/link',
      expires_in: 900,
      interval: 0.02,
    });
  }
  if (route === '/login/token') {
    const form = new URLSearchParams(body.toString());
    if (form.get('grant_type') === 'refresh_token') {
      const token = form.get('refresh_token')!;
      if (!microsoft.valid.delete(token)) return reply(response, 400, { error: 'invalid_grant' });
      return reply(response, 200, newTokens());
    }
    if (microsoft.declined) return reply(response, 400, { error: 'authorization_declined' });
    if (!microsoft.approved) return reply(response, 400, { error: 'authorization_pending' });
    return reply(response, 200, newTokens());
  }

  if (route.startsWith('/upload/')) {
    const name = route.slice('/upload/'.length);
    const [, start, , total] = /bytes (\d+)-(\d+)\/(\d+)/.exec(request.headers['content-range']!)!;
    const sofar = microsoft.files.get(`.${name}`) ?? Buffer.alloc(0);
    expect(Number(start)).toBe(sofar.length);
    const joined = Buffer.concat([sofar, body]);
    microsoft.pieces += 1;
    if (joined.length < Number(total)) {
      microsoft.files.set(`.${name}`, joined);
      return reply(response, 202, {});
    }
    microsoft.files.delete(`.${name}`);
    microsoft.files.set(name, joined);
    return reply(response, 201, { id: name, name });
  }

  if (!route.startsWith('/graph/')) return reply(response, 404, {});
  if (!/^Bearer access-\d+$/.test(request.headers.authorization ?? '')) {
    return reply(response, 401, { error: { code: 'InvalidAuthenticationToken' } });
  }
  const graph = route.slice('/graph'.length);
  if (graph === '/me') return reply(response, 200, { mail: 'chef@outlook.com' });
  if (graph === '/me/drive/special/approot') return reply(response, 200, { name: 'Mise' });
  const session = /^\/me\/drive\/special\/approot:\/(.+):\/createUploadSession$/.exec(graph);
  if (session) return reply(response, 200, { uploadUrl: `${base}/upload/${session[1]}` });
  if (graph === '/me/drive/special/approot/children') {
    const value = [...microsoft.files.keys()]
      .filter((name) => !name.startsWith('.'))
      .map((name) => ({ id: name, name }));
    return reply(response, 200, { value });
  }
  const item = /^\/me\/drive\/items\/(.+)$/.exec(graph);
  if (item && request.method === 'DELETE') {
    microsoft.files.delete(item[1]!);
    return reply(response, 204);
  }
  return reply(response, 404, {});
}

let client: PGlite;
let db: Database;
let dir: string;
let app: FastifyInstance;

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Gave up waiting');
}

async function status(cookies: Record<string, string>) {
  return (await app.inject({ method: 'GET', url: '/api/backups', cookies })).json();
}

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  dir = await mkdtemp(path.join(os.tmpdir(), 'mise-onedrive-'));
  server = http.createServer((request, response) => void handle(request, response));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  Object.assign(microsoft, { approved: false, declined: false, issued: 0, pieces: 0 });
  microsoft.valid.clear();
  microsoft.files.clear();
  await resetDatabase(db);
  await rm(path.join(dir, 'main'), { recursive: true, force: true });
  app = await buildApp(
    {
      ...TEST_CONFIG,
      UPLOAD_DIR: path.join(dir, 'main', 'uploads'),
      BACKUP_DIR: path.join(dir, 'main', 'backups'),
    },
    {
      db,
      serveClient: false,
      // Small pieces, so an ordinary test backup is uploaded in several.
      microsoft: { login: `${base}/login`, graph: `${base}/graph`, chunkBytes: 320 * 1024 },
    },
  );
  await app.ready();
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
});

/** Through Microsoft's code page and back, as an administrator would. */
async function connect(cookies: Record<string, string>) {
  const started = await app.inject({ method: 'POST', url: '/api/backups/onedrive', cookies });
  expect(started.statusCode).toBe(200);
  expect(started.json().onedrive.connecting).toMatchObject({
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://microsoft.com/link',
  });
  microsoft.approved = true;
  await until(async () => (await status(cookies)).onedrive.account !== null);
  // The first backup starts by itself once connected; wait for it.
  await app.backups.run({ force: false });
}

describe('backing up to OneDrive', () => {
  it('connects with a code, then sends each backup to the app folder', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
    const cookies = { mise_session: await setUpKitchen(app) };
    await connect(cookies);

    const after = await status(cookies);
    expect(after).toMatchObject({
      destination: 'onedrive',
      lastError: null,
      onedrive: { account: 'chef@outlook.com', connecting: null, connectError: null },
    });
    const name = 'mise-backup-20261020-040000.mise';
    expect([...microsoft.files.keys()]).toEqual([name]);
    const local = await readFile(path.join(dir, 'main', 'backups', name));
    expect(microsoft.files.get(name)!.equals(local)).toBe(true);
  });

  it('uploads a large backup in pieces', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    const recipe = await app.inject({
      method: 'POST',
      url: '/api/recipes',
      cookies,
      payload: { name: 'Beurre blanc', type: 'prep', yield: { value: 1, unit: 'l' } },
    });
    const boundary = 'mise-photo';
    const photo = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(1_200_000)]);
    const upload = await app.inject({
      method: 'POST',
      url: `/api/recipes/${recipe.json().id}/photos`,
      cookies,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plate.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        photo,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(upload.statusCode).toBe(200);

    await connect(cookies);
    const [name] = [...microsoft.files.keys()];
    expect(microsoft.pieces).toBeGreaterThanOrEqual(4);
    const local = await readFile(path.join(dir, 'main', 'backups', name!));
    expect(microsoft.files.get(name!)!.equals(local)).toBe(true);
  });

  it('keeps only as many as asked, through rotating sign-ins', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T04:00:00Z'));
    const cookies = { mise_session: await setUpKitchen(app) };
    await connect(cookies);
    await app.inject({ method: 'PATCH', url: '/api/backups', cookies, payload: { keepRemote: 1 } });

    for (const day of ['21', '22']) {
      vi.setSystemTime(new Date(`2026-10-${day}T04:00:00Z`));
      await app.backups.run({ force: true });
    }
    expect([...microsoft.files.keys()]).toEqual(['mise-backup-20261022-040000.mise']);
    // Each run used the refresh token the one before it was handed.
    expect((await status(cookies)).lastError).toBeNull();
    expect(microsoft.issued).toBe(4);
  });

  it('says so when Microsoft no longer accepts the sign-in, and can be disconnected', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    await connect(cookies);

    microsoft.valid.clear();
    await app.backups.run({ force: true });
    expect(await status(cookies)).toMatchObject({ lastError: 'onedrive_auth', problem: 'failed' });

    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/api/backups/onedrive',
      cookies,
    });
    expect(disconnected.json()).toMatchObject({
      destination: 'local',
      onedrive: { account: null },
    });
  });

  it('reports a sign-in turned down at Microsoft', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    await app.inject({ method: 'POST', url: '/api/backups/onedrive', cookies });
    microsoft.declined = true;
    await until(async () => (await status(cookies)).onedrive.connectError !== null);
    expect((await status(cookies)).onedrive).toMatchObject({
      account: null,
      connecting: null,
      connectError: 'declined',
    });
  });

  it('wants OneDrive connected before it can be chosen', async () => {
    const cookies = { mise_session: await setUpKitchen(app) };
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/backups',
      cookies,
      payload: { destination: 'onedrive' },
    });
    expect(response.statusCode).toBe(400);
  });
});
