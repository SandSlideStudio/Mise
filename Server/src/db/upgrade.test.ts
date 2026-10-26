import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Upgrading a kitchen from 1.x to 2.0.
 *
 * Services and generated prep lists are gone in 2.0. The migration that
 * removes them must keep the work still in front of the brigade: open lines
 * on today's service or a later one join the one list, and the rest goes.
 */

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const files = readdirSync(folder)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const statements = (file: string) =>
  readFileSync(path.join(folder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((sql) => sql.trim())
    .filter(Boolean);

let db: PGlite;

async function run(file: string) {
  for (const sql of statements(file)) await db.exec(sql);
}

beforeAll(async () => {
  db = new PGlite();
  // Everything up to and including 1.1.0.
  for (const file of files.filter((name) => name < '0010')) await run(file);
});

afterAll(async () => {
  await db.close();
});

describe('upgrading to one prep list', () => {
  it('keeps open work from today on, and lets the rest go', async () => {
    await db.exec(`
      insert into service (id, date, period) values
        ('00000000-0000-0000-0000-00000000000a', current_date - 1, 'dinner'),
        ('00000000-0000-0000-0000-00000000000b', current_date, 'dinner'),
        ('00000000-0000-0000-0000-00000000000c', current_date + 1, 'lunch');
      insert into prep_task (service_id, description, status) values
        ('00000000-0000-0000-0000-00000000000a', 'Yesterday, never done', 'open'),
        ('00000000-0000-0000-0000-00000000000b', 'Tonight, open', 'open'),
        ('00000000-0000-0000-0000-00000000000b', 'Tonight, being made', 'in_progress'),
        ('00000000-0000-0000-0000-00000000000b', 'Tonight, done', 'done'),
        ('00000000-0000-0000-0000-00000000000c', 'Tomorrow, open', 'open'),
        (null, 'Already on the running list', 'open');
    `);

    await run(files.find((name) => name.startsWith('0010'))!);

    const { rows } = await db.query<{ description: string; status: string }>(
      'select description, status from prep_task order by description',
    );
    expect(rows.map((row) => row.description)).toEqual([
      'Already on the running list',
      'Tomorrow, open',
      'Tonight, being made',
      'Tonight, open',
    ]);

    const tables = await db.query<{ name: string }>(
      `select table_name as name from information_schema.tables where table_name in ('service', 'service_dish')`,
    );
    expect(tables.rows).toEqual([]);

    const kitchenColumns = await db.query<{ name: string }>(
      `select column_name as name from information_schema.columns where table_name = 'kitchen'`,
    );
    expect(kitchenColumns.rows.map((row) => row.name)).not.toContain('prep_mode');
  });
});
