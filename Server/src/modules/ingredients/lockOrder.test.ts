import type { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { Database } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { TEST_CONFIG, createTestDatabase, setUpKitchen } from '../../test/harness.js';

/**
 * Which lock an ingredient edit takes first. A recipe save holds the recipe
 * graph's lock while its lines check their ingredient rows; an edit holding
 * an ingredient row while it waits for that lock would wait for the save
 * that waits for it. So every write takes the graph's lock first.
 *
 * One connection can't show the deadlock itself, so this reads the order the
 * statements are sent in.
 */

let client: PGlite;
let app: FastifyInstance;
let cookie: string;
const sent: string[] = [];

beforeAll(async () => {
  ({ client } = await createTestDatabase());
  const db = drizzle(client, {
    schema,
    logger: { logQuery: (query) => void sent.push(query) },
  }) as unknown as Database;
  app = await buildApp(TEST_CONFIG, { db, serveClient: false });
  await app.ready();
  cookie = await setUpKitchen(app);
});

afterAll(async () => {
  await app.close();
  await client.close();
});

async function ok(method: 'POST' | 'PATCH', url: string, payload?: object) {
  const response = await app.inject({ method, url, payload, cookies: { mise_session: cookie } });
  if (response.statusCode !== 200) throw new Error(`${url}: ${response.body}`);
  return response.json();
}

/** Where the graph's lock and the first row lock come in what a request sent. */
async function locksOf(send: () => Promise<unknown>) {
  sent.length = 0;
  await send();
  const graph = sent.findIndex((query) => query.includes('mise-recipe-graph'));
  const row = sent.findIndex((query) => /for update/i.test(query));
  return { graph, row };
}

describe('the order of locks', () => {
  it('takes the recipe graph before the ingredient row, in an edit and a label check', async () => {
    const pesto = await ok('POST', '/api/ingredients', {
      name: 'Pesto',
      baseUnit: 'g',
      allergens: ['milk'],
    });
    for (const send of [
      () => ok('PATCH', `/api/ingredients/${pesto.id}`, { allergens: ['milk', 'nuts'] }),
      () =>
        ok('POST', `/api/ingredients/${pesto.id}/label-checks`, {
          allergens: ['milk'],
          mayContain: [],
        }),
    ]) {
      const { graph, row } = await locksOf(send);
      expect(row).toBeGreaterThan(-1);
      expect(graph).toBeGreaterThan(-1);
      expect(graph).toBeLessThan(row);
    }
  });
});
