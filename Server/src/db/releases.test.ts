import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance } from 'fastify';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashSecret } from '../lib/crypto.js';
import { generateRecoveryKey } from '../modules/backups/crypto.js';
import { backupBeforeMigrating } from '../modules/backups/premigration.js';
import { SETTINGS_ID } from '../modules/backups/service.js';
import { TEST_CONFIG, cookieFrom, createTestDatabase } from '../test/harness.js';
import type { Database } from './client.js';
import { pendingMigrations } from './migrate.js';
import { rows } from './rows.js';
import * as schema from './schema.js';

/**
 * Every released version, upgraded to this one.
 *
 * Each database is built the way that release left it: its own migrations,
 * run by the real migrator, so the bookkeeping is exactly what a kitchen has.
 * It is filled with what a kitchen on that version would have, backed up the
 * way an update does before touching it, then upgraded with this version's
 * migrations. The server is started on the result and asked, through its API,
 * whether everything is still there and still works. Finally the backup made
 * before the upgrade is restored onto an empty server.
 *
 * Add a line to RELEASES with every release that adds a migration.
 */
const RELEASES = [
  { version: '1.0.0', last: '0008' },
  { version: '1.1.0', last: '0009' },
  { version: '2.0.1', last: '0013' },
  { version: '2.1.0', last: '0015' },
] as const;

const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const scratch = mkdtempSync(path.join(tmpdir(), 'mise-releases-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STATION = id(1);
const ADMIN = id(2);
const BUTTER = id(3);
const COD = id(4);
const SAUCE = id(5);
const DISH = id(6);
const SERVICE = id(7);
const MENU = id(8);
const PASSWORD = 'correct-horse-battery';

/** A copy of the migrations folder that stops where the release did. */
function migrationsUpTo(last: string): string {
  const folder = path.join(scratch, `up-to-${last}`);
  mkdirSync(path.join(folder, 'meta'), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  journal.entries = journal.entries.filter((entry) => entry.tag.slice(0, 4) <= last);
  writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
  for (const file of readdirSync(DRIZZLE).filter((name) => name.endsWith('.sql'))) {
    if (file.slice(0, 4) <= last) copyFileSync(path.join(DRIZZLE, file), path.join(folder, file));
  }
  return folder;
}

/** What a kitchen on that release would have in it. */
async function fill(db: Database, last: string) {
  const at = (migration: string) => last >= migration;
  const run = (query: string) => db.execute(sql.raw(query));
  const adminHash = await hashSecret(PASSWORD);
  const pinHash = await hashSecret('4821');

  await run(`insert into kitchen (name) values ('De Proefkeuken')`);
  await run(`insert into station (id, name) values ('${STATION}', 'Saus')`);
  await run(`insert into app_user (id, display_name, email, password_hash, role)
             values ('${ADMIN}', 'Teun', 'chef@example.com', '${adminHash}', 'admin')`);
  await run(`insert into app_user (display_name, pin_hash, role, default_station_id)
             values ('Marco', '${pinHash}', 'cook', '${STATION}')`);
  await run(`insert into ingredient (id, name, base_unit, allergens) values
             ('${BUTTER}', 'Boter', 'g', '["milk"]'), ('${COD}', 'Kabeljauw', 'g', '["fish"]')`);
  await run(`insert into recipe (id, name, type, status, station_id, yield_base, yield_entered, yield_unit, portions) values
             ('${SAUCE}', 'Beurre blanc', 'prep', 'published', '${STATION}', 1000, 1, 'l', null),
             ('${DISH}', 'Kabeljauw, beurre blanc', 'dish', 'published', null, 10, 10, 'each', 10)`);
  await run(`insert into recipe_component (recipe_id, sort_order, quantity_base, quantity_entered, unit_entered, ingredient_id, child_recipe_id) values
             ('${SAUCE}', 0, 250, 250, 'g', '${BUTTER}', null),
             ('${DISH}', 0, 1500, 1500, 'g', '${COD}', null),
             ('${DISH}', 1, 500, 0.5, 'l', null, '${SAUCE}')`);
  // Every release so far sent backups to one place; this one, a NAS.
  await run(`insert into backup_settings (id, recovery_key, destination, webdav_url)
             values ('${SETTINGS_ID}', '${generateRecoveryKey()}', 'webdav', 'http://nas.local/dav')`);

  if (!at('0010')) {
    // 1.x: tonight's service with an open line, and one on the running list.
    await run(
      `insert into service (id, date, period) values ('${SERVICE}', current_date, 'dinner')`,
    );
    await run(`insert into prep_task (service_id, description, status) values
               ('${SERVICE}', 'Beurre blanc maken', 'open'), (null, 'Sjalotten snijden', 'open')`);
  } else {
    await run(`insert into prep_task (description, status${at('0011') ? ', recipe_id' : ''}) values
               ('Beurre blanc maken', 'open'${at('0011') ? `, '${SAUCE}'` : ''}),
               ('Sjalotten snijden', 'open'${at('0011') ? ', null' : ''})`);
  }
  if (at('0009')) {
    if (!at('0014')) await run(`update recipe set seasons = '["autumn"]' where id = '${DISH}'`);
    await run(
      `insert into dish_card_settings (hidden) values ('${at('0014') ? '["menu"]' : '["season"]'}')`,
    );
  }
  if (at('0012')) {
    await run(
      `update kitchen set handover_note = 'Vis komt om drie uur', handover_note_by = 'Teun'`,
    );
  }
  if (at('0013')) {
    await run(`insert into menu (id, name, status) values ('${MENU}', 'Herfstmenu', 'active')`);
    await run(
      `insert into menu_dish (menu_id, recipe_id, sort_order) values ('${MENU}', '${DISH}', 0)`,
    );
  }
  if (at('0015')) await run(`update kitchen set update_check = false`);
}

async function serve(db: Database, name: string): Promise<FastifyInstance> {
  const app = await buildApp(
    {
      ...TEST_CONFIG,
      UPLOAD_DIR: path.join(scratch, name, 'uploads'),
      BACKUP_DIR: path.join(scratch, name, 'backups'),
    },
    { db, serveClient: false },
  );
  await app.ready();
  return app;
}

describe.each(RELEASES)('a kitchen on $version', ({ version, last }) => {
  it('upgrades to this version with everything intact', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      await migrate(db as never, { migrationsFolder: migrationsUpTo(last) });
      await fill(db, last);

      const total = readdirSync(DRIZZLE).filter((name) => name.endsWith('.sql')).length;
      const before = await pendingMigrations(db);
      expect(before).toEqual({ pending: total - (Number(last) + 1), hasKitchen: true });

      // What an update does first: a backup of the kitchen as this release left it.
      const backupDir = path.join(scratch, `before-${version}`);
      const said: string[] = [];
      const file = await backupBeforeMigrating(db, {
        uploadDir: path.join(scratch, 'no-photos'),
        backupDir,
        version: 'next',
        say: (message) => said.push(message),
      });
      expect(file).toMatch(/^mise-backup-\d{8}-\d{6}\.mise$/);
      expect(said).toHaveLength(1);

      await migrate(db as never, { migrationsFolder: DRIZZLE });
      expect(await pendingMigrations(db)).toEqual({ pending: 0, hasKitchen: true });

      const app = await serve(db, `upgraded-${version}`);
      try {
        const login = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'chef@example.com', password: PASSWORD },
        });
        expect(login.statusCode).toBe(200);
        const cookies = { mise_session: cookieFrom(login, 'mise_session')! };
        const get = async (url: string) => {
          const response = await app.inject({ method: 'GET', url, cookies });
          expect(response.statusCode, url).toBe(200);
          return response.json();
        };

        expect(
          (await get('/api/users')).map((u: { displayName: string }) => u.displayName).sort(),
        ).toEqual(['Marco', 'Teun']);
        expect((await get('/api/recipes')).map((r: { name: string }) => r.name).sort()).toEqual([
          'Beurre blanc',
          'Kabeljauw, beurre blanc',
        ]);

        const card = await get(`/api/recipes/${DISH}/card`);
        expect(card.whole.contains).toEqual(['fish', 'milk']);
        expect(card.dish.menus).toEqual(last >= '0013' ? ['Herfstmenu'] : []);
        // A hidden season on 1.1 and 2.0 is a hidden menu now.
        if (last >= '0009') expect(card.settings.hidden).toEqual(['menu']);

        const tasks = (await get('/api/running/tasks')).map(
          (t: { description: string }) => t.description,
        );
        // Tonight's open service line joined the one list on the way to 2.0.
        expect(tasks.sort()).toEqual(['Beurre blanc maken', 'Sjalotten snijden']);

        const note = await get('/api/running/note');
        expect(note.text).toBe(last >= '0012' ? 'Vis komt om drie uur' : null);
        expect((await get('/api/version')).checkEnabled).toBe(last < '0015');
        // Still sending to the NAS, now as one of the places a backup goes.
        expect(await get('/api/backups')).toMatchObject({
          sendTo: ['webdav'],
          webdavUrl: 'http://nas.local/dav',
        });
      } finally {
        await app.close();
      }

      // And the backup from before the upgrade opens on a new server.
      const empty = await createTestDatabase();
      const target = await serve(empty.db, `restored-${version}`);
      try {
        const [settings] = await rows<{ recovery_key: string }>(
          db,
          sql`select recovery_key from backup_settings`,
        );
        const restored = await target.backups.restore(
          path.join(backupDir, file!),
          settings!.recovery_key,
        );
        expect(restored).toMatchObject({ kitchenName: 'De Proefkeuken', staff: 2, recipes: 2 });
      } finally {
        await target.close();
        await empty.client.close();
      }
    } finally {
      await client.close();
    }
  });
});

describe('a kitchen updated before it ever made a recovery key', () => {
  it('gets its key at the update, and a backup that opens with it', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      await migrate(db as never, { migrationsFolder: migrationsUpTo('0013') });
      await fill(db, '0013');
      await db.execute(sql`delete from backup_settings`);

      const backupDir = path.join(scratch, 'before-without-key');
      const file = await backupBeforeMigrating(db, {
        uploadDir: path.join(scratch, 'no-photos'),
        backupDir,
        version: 'next',
        say: () => {},
      });
      expect(file).not.toBeNull();
      const [settings] = await rows<{ recovery_key: string }>(
        db,
        sql`select recovery_key from backup_settings`,
      );

      const empty = await createTestDatabase();
      const target = await serve(empty.db, 'restored-without-key');
      try {
        const restored = await target.backups.restore(
          path.join(backupDir, file!),
          settings!.recovery_key,
        );
        expect(restored).toMatchObject({ kitchenName: 'De Proefkeuken', recipes: 2 });
      } finally {
        await target.close();
        await empty.client.close();
      }
    } finally {
      await client.close();
    }
  });
});

describe('a new server', () => {
  it('has nothing to back up before its first migrations', async () => {
    const client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Database;
    try {
      const state = await pendingMigrations(db);
      expect(state.hasKitchen).toBe(false);
      expect(state.pending).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});
