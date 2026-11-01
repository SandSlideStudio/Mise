/**
 * Starts Mise for the browser tests: an empty database, then the built server
 * (Server/dist and Client/dist, so run `npm run build` first), as production.
 *
 * E2E_DATABASE_URL names a Postgres database the tests may wipe. CI gives it
 * a service container; locally, for example:
 *   docker run -d -p 5434:5432 -e POSTGRES_USER=mise -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=mise_e2e postgres:16-alpine
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://mise:pw@localhost:5434/mise_e2e';

// Every run starts from nothing, as a new kitchen does.
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql`drop schema if exists public cascade`;
await sql`drop schema if exists drizzle cascade`;
await sql`create schema public`;
await sql.end();

const data = mkdtempSync(path.join(tmpdir(), 'mise-e2e-'));
const server = spawn(process.execPath, ['Server/dist/index.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: url,
    SESSION_SECRET: 'browser-tests-only-secret-that-is-long-enough',
    PORT: process.env.E2E_PORT ?? '3210',
    HTTPS_PORT: process.env.E2E_HTTPS_PORT ?? '3643',
    HOST: '127.0.0.1',
    UPLOAD_DIR: path.join(data, 'uploads'),
    BACKUP_DIR: path.join(data, 'backups'),
    // Nothing in the tests should reach the internet.
    ACME_DIRECTORY: 'https://acme.invalid/directory',
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
