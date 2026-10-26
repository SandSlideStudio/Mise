import { access, constants, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildApp, setupCodeAlways } from './app.js';
import { loadConfig, type Config } from './config.js';
import { createDatabase } from './db/client.js';
import { pendingMigrations, runMigrations } from './db/migrate.js';
import { VERSION } from './lib/version.js';
import { backupBeforeMigrating } from './modules/backups/premigration.js';

/**
 * Mise may run as any user, such as the one TrueNAS gives its apps. Say so
 * plainly at start when that user can't write the data folders, rather than
 * failing on the first photo or the first nightly backup.
 */
async function checkDataFolders(config: Config): Promise<void> {
  const user = process.getuid?.() ?? 'this user';
  for (const folder of [config.UPLOAD_DIR, config.BACKUP_DIR]) {
    const absolute = path.resolve(folder);
    try {
      await mkdir(absolute, { recursive: true });
      await access(absolute, constants.W_OK);
    } catch {
      throw new Error(
        `Mise runs as user ${user} and can't write to ${absolute}. Give that folder to this user, or run Mise as its owner.`,
      );
    }
  }
}

/**
 * Boot order matters for a self-hosted box: migrate first, then listen. An
 * admin pulling a newer image should never have to remember a separate step.
 */
/**
 * An update that changes the database makes a backup of the kitchen first, as
 * the older version left it. If that backup can't be made, nothing is changed
 * and Mise stops: the data is untouched and the previous image still runs it.
 */
async function backUpIfUpdating(config: Config): Promise<void> {
  const { db, sql } = createDatabase(config.DATABASE_URL, { max: 1 });
  try {
    const { pending, hasKitchen } = await pendingMigrations(db);
    if (pending === 0 || !hasKitchen) return;
    try {
      await backupBeforeMigrating(db, {
        uploadDir: path.resolve(config.UPLOAD_DIR),
        backupDir: path.resolve(config.BACKUP_DIR),
        version: VERSION,
        // Before the server exists, so before its logger does.
        say: (message) => console.log(message),
      });
    } catch (error) {
      throw new Error(
        `Mise ${VERSION} needs to update the database, but couldn't back it up first (${String(error)}). Nothing was changed. Free some space or fix the backup folder and start again, or go back to the previous version.`,
      );
    }
  } finally {
    await sql.end();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  await checkDataFolders(config);
  await backUpIfUpdating(config);
  await runMigrations(config.DATABASE_URL);

  const app = await buildApp(config);

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });

  // Whether a newer Mise is out: a minute after start, then daily, if allowed.
  app.updates.start();

  // Expired sessions are cleared out at start and then once an hour.
  const purge = () =>
    app.auth.purgeExpiredSessions().catch((error: unknown) => {
      app.log.warn({ error }, 'could not clear expired sessions');
    });
  await purge();
  setInterval(() => void purge(), 3_600_000).unref();

  // The nightly backup checks whether it's due every five minutes. The first
  // look waits two minutes, so a slow machine finishes starting up first.
  const backup = () =>
    app.backups.tick().catch((error: unknown) => {
      app.log.warn({ error }, 'could not check whether a backup is due');
    });
  setTimeout(() => void backup(), 120_000).unref();
  setInterval(() => void backup(), 300_000).unref();

  if (await app.auth.needsSetup()) {
    const query = app.setupToken ? `?token=${app.setupToken}` : '';
    app.log.info(`Mise needs setting up. Open http://<this machine>:${config.PORT}/setup${query}`);
    if (app.setupToken && !setupCodeAlways(config)) {
      app.log.info(
        'From the kitchen network setup needs no code; from anywhere else it asks for this one.',
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
