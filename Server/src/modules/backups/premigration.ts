import { mkdir, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client.js';
import { rows } from '../../db/rows.js';
import { packEntries, type Entry } from './archive.js';
import { generateRecoveryKey, writeEncrypted } from './crypto.js';
import { BACKED_UP } from './data.js';
import { fileName, FORMAT, SETTINGS_ID, type Manifest } from './service.js';

/**
 * A backup made just before a newer Mise changes the database.
 *
 * It runs against the database as the older version left it, so it uses
 * nothing from this version's schema: tables are read whole by Postgres,
 * whatever their columns, and a table the older version didn't have yet is
 * simply not there. The file is an ordinary backup, listed in Settings and
 * restorable like any other.
 */

async function exists(db: Database, table: string): Promise<boolean> {
  const [row] = await rows<{ present: boolean }>(
    db,
    sql`select to_regclass(${`public.${table}`}) is not null as present`,
  );
  return row?.present === true;
}

async function columnExists(db: Database, table: string, column: string): Promise<boolean> {
  const [row] = await rows<{ present: boolean }>(
    db,
    sql`select exists (select 1 from information_schema.columns
        where table_schema = 'public' and table_name = ${table} and column_name = ${column}) as present`,
  );
  return row?.present === true;
}

/**
 * Write the backup and return its file name, or null when there is nothing to
 * keep yet. Throws when it can't: then nothing should be migrated.
 */
export async function backupBeforeMigrating(
  db: Database,
  options: {
    uploadDir: string;
    backupDir: string;
    version: string;
    say: (message: string) => void;
  },
): Promise<string | null> {
  if (!(await exists(db, 'backup_settings'))) return null;
  // The recovery key is normally made a couple of minutes after the first
  // start. A kitchen updated sooner gets it now: the same key Settings will
  // show, so this backup opens like every later one.
  await db.execute(
    sql`insert into backup_settings (id, recovery_key)
        values (${SETTINGS_ID}, ${generateRecoveryKey()}) on conflict do nothing`,
  );
  const [settings] = await rows<{ recovery_key: string }>(
    db,
    sql`select recovery_key from backup_settings limit 1`,
  );
  if (!settings) throw new Error('No recovery key to encrypt the backup with');

  const tables: { name: string; json: string }[] = [];
  for (const table of BACKED_UP) {
    const name = getTableConfig(table).name;
    if (!(await exists(db, name))) continue;
    const [row] = await rows<{ json: string }>(
      db,
      sql`select coalesce(json_agg(t), '[]'::json)::text as json from ${sql.identifier(name)} t`,
    );
    tables.push({ name, json: row?.json ?? '[]' });
  }

  const stored: string[] = [];
  if (await exists(db, 'recipe_photo')) {
    const photos = await rows<{ path: string }>(db, sql`select path from recipe_photo`);
    stored.push(...photos.map((row) => row.path));
  }
  if (await columnExists(db, 'dish_card_settings', 'logo_path')) {
    const logos = await rows<{ path: string | null }>(
      db,
      sql`select logo_path as path from dish_card_settings where logo_path is not null`,
    );
    stored.push(...logos.flatMap((row) => (row.path ? [row.path] : [])));
  }

  const [kitchen] = (await exists(db, 'kitchen'))
    ? await rows<{ name: string }>(db, sql`select name from kitchen limit 1`)
    : [];
  const createdAt = new Date();
  const manifest: Manifest = {
    format: FORMAT,
    app: 'mise',
    version: `before ${options.version}`,
    createdAt: createdAt.toISOString(),
    kitchenName: kitchen?.name ?? '',
  };

  async function* entries(): AsyncGenerator<Entry> {
    yield { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) };
    for (const table of tables) {
      yield { name: `table/${table.name}.json`, data: Buffer.from(table.json), compress: true };
    }
    for (const name of new Set(stored.map((file) => path.basename(file)))) {
      // A photo missing from disk isn't worth losing the whole backup over.
      const data = await readFile(path.join(options.uploadDir, name)).catch(() => null);
      if (data) yield { name: `photo/${name}`, data };
    }
  }

  await mkdir(options.backupDir, { recursive: true });
  const name = fileName(createdAt);
  const partial = path.join(options.backupDir, `.${name}.partial`);
  try {
    await writeEncrypted(partial, settings.recovery_key, packEntries(entries()));
    await rename(partial, path.join(options.backupDir, name));
  } catch (error) {
    await unlink(partial).catch(() => {});
    throw error;
  }
  options.say(`Backed the kitchen up to ${name} before updating the database.`);
  return name;
}
