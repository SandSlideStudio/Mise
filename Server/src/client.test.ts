import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { TEST_CONFIG, useTestContext } from './test/harness.js';

const ctx = useTestContext();

/** A built app in miniature: its page, and one file of code. */
let dir = '';
let app: FastifyInstance | null = null;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mise-client-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Mise</title>');
  writeFileSync(path.join(dir, 'assets', 'app-NEW.js'), 'export {};');
});
afterAll(async () => {
  await app?.close();
  rmSync(dir, { recursive: true, force: true });
});

async function served(): Promise<FastifyInstance> {
  app ??= await buildApp({ ...TEST_CONFIG, CLIENT_DIR: dir }, { db: ctx.db });
  return app;
}

describe('the built app', () => {
  it('opens on any page of the app, for the router to handle', async () => {
    const response = await (await served()).inject({ method: 'GET', url: '/recipes/whatever' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('serves its own files', async () => {
    const response = await (await served()).inject({ method: 'GET', url: '/assets/app-NEW.js' });
    expect(response.statusCode).toBe(200);
  });

  it('answers a file from an older version with "not found", not the page', async () => {
    // A tablet left open across an update asks for the file names it knew.
    const response = await (await served()).inject({ method: 'GET', url: '/assets/app-OLD.js' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).not.toContain('text/html');
  });
});
