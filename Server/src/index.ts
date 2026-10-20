import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { runMigrations } from './db/migrate.js';

/**
 * Boot order matters for a self-hosted box: migrate first, then listen. An
 * admin pulling a newer image should never have to remember a separate step.
 */
async function main(): Promise<void> {
  const config = loadConfig();

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
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
