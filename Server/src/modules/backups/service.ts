import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type {
  BackupDestination,
  BackupFailureCode,
  BackupProblem,
  BackupStatus,
  RestoreResult,
  UpdateBackupSettings,
} from '@mise/contracts';
import type { Database } from '../../db/client.js';
import {
  backupSettings,
  dishCardSettings,
  kitchens,
  recipePhotos,
  users,
} from '../../db/schema.js';
import { VERSION } from '../../lib/version.js';
import { packEntries, unpackEntries, type Entry } from './archive.js';
import { decryptToFile, formatRecoveryKey, generateRecoveryKey, writeEncrypted } from './crypto.js';
import { exportTables, restoreTables } from './data.js';
import { BackupFailure, failureCode } from './failure.js';
import type { DeviceCode, Onedrive } from './onedrive.js';
import * as webdav from './webdav.js';

/**
 * Nightly backups, kept on this machine and optionally sent to a NAS.
 *
 * A backup is the kitchen's data and its plating photos in one encrypted file.
 * When nothing has changed since the last one, no new file is written, which
 * spares an SD card and the upload.
 */

/** Bumped when the inside of a backup changes in a way older versions can't read. */
const FORMAT = 1;
const SETTINGS_ID = '00000000-0000-4000-8000-000000000001';
const FILE_PATTERN = /^mise-backup-\d{8}-\d{6}\.mise$/;
const HOUR = 3_600_000;

type Settings = typeof backupSettings.$inferSelect;

/** Restoring is only for a server nobody has set up yet. */
export class AlreadySetUpError extends Error {}

interface Manifest {
  format: number;
  app: string;
  version: string;
  createdAt: string;
  kitchenName: string;
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function hourIn(now: Date, timeZone: string): number {
  const zone = validTimeZone(timeZone) ? timeZone : 'UTC';
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(
      now,
    ),
  );
}

/**
 * Whether the scheduled backup should run now: at the chosen hour, or as soon
 * as possible when the last good one is over a day old because the machine
 * was off or the backup failed.
 */
export function isDue(
  settings: Pick<Settings, 'hour' | 'timeZone' | 'lastAttemptAt' | 'lastSuccessAt'>,
  now: Date,
): boolean {
  const since = (moment: Date | null) => (moment ? now.getTime() - moment.getTime() : Infinity);
  if (
    hourIn(now, settings.timeZone) === settings.hour &&
    since(settings.lastAttemptAt) > 2 * HOUR
  ) {
    return true;
  }
  return since(settings.lastSuccessAt) > 26 * HOUR && since(settings.lastAttemptAt) > 6 * HOUR;
}

export function problemOf(
  settings: Pick<Settings, 'lastError' | 'lastSuccessAt' | 'keyConfirmedAt'>,
  kitchenCreatedAt: Date | null,
  now: Date,
): BackupProblem | null {
  if (settings.lastError) return 'failed';
  const since = settings.lastSuccessAt ?? kitchenCreatedAt;
  if (since && now.getTime() - since.getTime() > 48 * HOUR) return 'stale';
  if (!settings.keyConfirmedAt) return 'key_unconfirmed';
  return null;
}

function fileName(moment: Date): string {
  const stamp = moment.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `mise-backup-${stamp}.mise`;
}

export interface BackupServiceOptions {
  db: Database;
  uploadDir: string;
  backupDir: string;
  log: FastifyBaseLogger;
  onedrive: Onedrive;
}

export function createBackupService({
  db,
  uploadDir,
  backupDir,
  log,
  onedrive,
}: BackupServiceOptions) {
  let running: Promise<void> | null = null;
  /** A OneDrive sign-in waiting for someone to type the code in at Microsoft. */
  let signIn: (DeviceCode & { timer?: NodeJS.Timeout }) | null = null;
  let signInError: 'declined' | 'expired' | 'failed' | null = null;

  async function settings(): Promise<Settings> {
    const find = () =>
      db.select().from(backupSettings).where(eq(backupSettings.id, SETTINGS_ID)).limit(1);
    const [row] = await find();
    if (row) return row;
    await db
      .insert(backupSettings)
      .values({ id: SETTINGS_ID, recoveryKey: generateRecoveryKey() })
      .onConflictDoNothing();
    const [created] = await find();
    return created!;
  }

  async function record(values: Partial<Settings>): Promise<void> {
    await db.update(backupSettings).set(values).where(eq(backupSettings.id, SETTINGS_ID));
  }

  /** Backups kept on this machine, newest first. */
  async function listFiles() {
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter((name) => FILE_PATTERN.test(name));
    const files = await Promise.all(
      names.map(async (name) => {
        const info = await stat(path.join(backupDir, name));
        return { name, size: info.size, createdAt: info.mtime };
      }),
    );
    return files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** The full path of a kept backup, or null for any name that isn't one. */
  async function filePath(name: string): Promise<string | null> {
    if (!FILE_PATTERN.test(name)) return null;
    const file = path.join(backupDir, name);
    try {
      await stat(file);
      return file;
    } catch {
      return null;
    }
  }

  async function status(now = new Date()): Promise<BackupStatus> {
    const current = await settings();
    const [kitchen] = await db.select({ createdAt: kitchens.createdAt }).from(kitchens).limit(1);
    const files = await listFiles();
    return {
      destination: current.destination as BackupDestination,
      webdavUrl: current.webdavUrl,
      webdavUsername: current.webdavUsername,
      hasWebdavPassword: Boolean(current.webdavPassword),
      onedrive: {
        account: current.onedriveRefreshToken ? current.onedriveAccount : null,
        connecting: signIn
          ? {
              userCode: signIn.userCode,
              verificationUri: signIn.verificationUri,
              expiresAt: signIn.expiresAt.toISOString(),
            }
          : null,
        connectError: signInError,
      },
      hour: current.hour,
      timeZone: current.timeZone,
      keepLocal: current.keepLocal,
      keepRemote: current.keepRemote,
      keyConfirmed: current.keyConfirmedAt !== null,
      lastAttemptAt: current.lastAttemptAt?.toISOString() ?? null,
      lastSuccessAt: current.lastSuccessAt?.toISOString() ?? null,
      lastError: (current.lastError as BackupFailureCode | null) ?? null,
      running: running !== null,
      problem: problemOf(current, kitchen?.createdAt ?? null, now),
      files: files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
    };
  }

  /** Refuses a NAS without an address, or OneDrive before it's connected. */
  async function update(
    input: UpdateBackupSettings,
  ): Promise<'ok' | 'needs_address' | 'needs_onedrive'> {
    const current = await settings();
    const destination = input.destination ?? current.destination;
    const webdavUrl = input.webdavUrl !== undefined ? input.webdavUrl : current.webdavUrl;
    if (destination === 'webdav' && !webdavUrl) return 'needs_address';
    if (destination === 'onedrive' && !current.onedriveRefreshToken) return 'needs_onedrive';

    // A new place to send to hasn't got this kitchen yet, changed or not.
    const moved = destination !== current.destination || webdavUrl !== current.webdavUrl;
    await record({
      ...input,
      ...(moved ? { lastFingerprint: null } : {}),
      updatedAt: new Date(),
    });
    return 'ok';
  }

  async function confirmKey(): Promise<void> {
    await settings();
    await record({ keyConfirmedAt: new Date() });
  }

  async function recoveryKey(): Promise<string> {
    return (await settings()).recoveryKey;
  }

  /** Run a backup now, or wait for the one already running. */
  function run(options: { force: boolean }): Promise<void> {
    running ??= runOnce(options.force).finally(() => {
      running = null;
    });
    return running;
  }

  async function runOnce(force: boolean): Promise<void> {
    const current = await settings();
    const attemptAt = new Date();
    try {
      await mkdir(backupDir, { recursive: true });
      await clearLeftovers();

      const tables = await exportTables(db);
      const photoRows = await db.select({ path: recipePhotos.path }).from(recipePhotos);
      // The dish card logo travels with the photos and comes back the same way.
      const logoRows = await db.select({ path: dishCardSettings.logoPath }).from(dishCardSettings);
      const stored = [...photoRows, ...logoRows].flatMap((row) => (row.path ? [row.path] : []));
      const photos: { name: string; file: string; size: number; mtime: number }[] = [];
      for (const name of new Set(stored.map((file) => path.basename(file)))) {
        const file = path.join(uploadDir, name);
        try {
          const info = await stat(file);
          photos.push({ name, file, size: info.size, mtime: info.mtimeMs });
        } catch {
          // A photo missing from disk isn't worth losing the whole backup over.
        }
      }

      const hash = createHash('sha256');
      for (const table of tables) hash.update(table.name).update(table.json);
      for (const photo of photos) hash.update(`${photo.name}:${photo.size}:${photo.mtime}`);
      const fingerprint = hash.digest('hex');

      const kept = await listFiles();
      if (!force && fingerprint === current.lastFingerprint && kept.length > 0) {
        await record({ lastAttemptAt: attemptAt, lastSuccessAt: attemptAt, lastError: null });
        return;
      }

      const [kitchen] = await db.select({ name: kitchens.name }).from(kitchens).limit(1);
      const manifest: Manifest = {
        format: FORMAT,
        app: 'mise',
        version: VERSION,
        createdAt: attemptAt.toISOString(),
        kitchenName: kitchen?.name ?? '',
      };
      async function* entries(): AsyncGenerator<Entry> {
        yield { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) };
        for (const table of tables) {
          yield { name: `table/${table.name}.json`, data: Buffer.from(table.json), compress: true };
        }
        for (const photo of photos) {
          const data = await readFile(photo.file).catch(() => null);
          if (data) yield { name: `photo/${photo.name}`, data };
        }
      }

      const name = fileName(attemptAt);
      const finished = path.join(backupDir, name);
      const partial = path.join(backupDir, `.${name}.partial`);
      let size: number;
      try {
        size = await writeEncrypted(partial, current.recoveryKey, packEntries(entries()));
        await rename(partial, finished);
      } catch (error) {
        await unlink(partial).catch(() => {});
        throw error instanceof BackupFailure ? error : new BackupFailure('local', String(error));
      }

      for (const old of (await listFiles()).slice(current.keepLocal)) {
        await unlink(path.join(backupDir, old.name)).catch(() => {});
      }

      if (current.destination === 'webdav' && current.webdavUrl) {
        const target = {
          url: current.webdavUrl,
          username: current.webdavUsername,
          password: current.webdavPassword,
        };
        await webdav.upload(target, name, finished, size);
        const remote = (await webdav.list(target))
          .filter((file) => FILE_PATTERN.test(file))
          .sort()
          .reverse();
        for (const old of remote.slice(current.keepRemote)) await webdav.remove(target, old);
      }

      if (current.destination === 'onedrive' && current.onedriveRefreshToken) {
        const token = await onedrive.refresh(current.onedriveRefreshToken);
        if (token.refreshToken !== current.onedriveRefreshToken) {
          await record({ onedriveRefreshToken: token.refreshToken });
        }
        await onedrive.upload(token.accessToken, name, finished, size);
        const remote = (await onedrive.list(token.accessToken))
          .filter((item) => FILE_PATTERN.test(item.name))
          .sort((a, b) => b.name.localeCompare(a.name));
        for (const old of remote.slice(current.keepRemote)) {
          await onedrive.remove(token.accessToken, old.id);
        }
      }

      await record({
        lastAttemptAt: attemptAt,
        lastSuccessAt: new Date(),
        lastError: null,
        lastFingerprint: fingerprint,
      });
      log.info({ file: name, size }, 'backup written');
    } catch (error) {
      log.error({ err: error }, 'backup failed');
      await record({ lastAttemptAt: attemptAt, lastError: failureCode(error) });
    }
  }

  /** Half-written files from a power cut or an interrupted upload. */
  async function clearLeftovers(): Promise<void> {
    for (const name of await readdir(backupDir)) {
      if (!name.startsWith('.')) continue;
      const file = path.join(backupDir, name);
      const info = await stat(file).catch(() => null);
      if (info && Date.now() - info.mtimeMs > HOUR) await unlink(file).catch(() => {});
    }
  }

  /** Called every few minutes; runs the nightly backup when it's due. */
  async function tick(now = new Date()): Promise<void> {
    if (running) return;
    const [anyone] = await db.select({ id: users.id }).from(users).limit(1);
    if (!anyone) return;
    if (isDue(await settings(), now)) await run({ force: false });
  }

  // --- OneDrive ----------------------------------------------------------

  /** Ask Microsoft for a code, then keep checking until someone types it in. */
  async function connectOnedrive(): Promise<void> {
    stopSignIn();
    signInError = null;
    signIn = await onedrive.startSignIn();
    checkAgainIn(signIn.intervalSeconds);
  }

  function checkAgainIn(seconds: number): void {
    if (!signIn) return;
    signIn.timer = setTimeout(() => void check(), seconds * 1000);
    signIn.timer.unref();
  }

  async function check(): Promise<void> {
    const current = signIn;
    if (!current) return;
    if (Date.now() > current.expiresAt.getTime()) {
      signIn = null;
      signInError = 'expired';
      return;
    }
    try {
      const result = await onedrive.poll(current.deviceCode);
      if (signIn !== current) return;
      if (result.kind === 'waiting') {
        if (result.slowDown) current.intervalSeconds += 5;
        checkAgainIn(current.intervalSeconds);
        return;
      }
      if (result.kind !== 'connected') {
        signIn = null;
        signInError = result.kind;
        return;
      }
      const account = await onedrive.account(result.accessToken);
      await settings();
      await record({
        onedriveRefreshToken: result.refreshToken,
        onedriveAccount: account,
        destination: 'onedrive',
        lastFingerprint: null,
        updatedAt: new Date(),
      });
      signIn = null;
      // A first copy straight away, so the folder shows up in OneDrive.
      void run({ force: false });
    } catch (error) {
      if (signIn !== current) return;
      if (failureCode(error) === 'onedrive_unreachable') {
        checkAgainIn(current.intervalSeconds);
        return;
      }
      log.warn({ err: error }, 'OneDrive sign-in failed');
      signIn = null;
      signInError = 'failed';
    }
  }

  function stopSignIn(): void {
    if (signIn?.timer) clearTimeout(signIn.timer);
    signIn = null;
  }

  /** Forget the OneDrive. Backups after this stay on the machine only. */
  async function disconnectOnedrive(): Promise<void> {
    stopSignIn();
    signInError = null;
    const current = await settings();
    await record({
      onedriveRefreshToken: null,
      onedriveAccount: null,
      ...(current.destination === 'onedrive' ? { destination: 'local' } : {}),
      updatedAt: new Date(),
    });
  }

  async function testWebdav(target: webdav.WebdavTarget): Promise<void> {
    const current = await settings();
    await webdav.test({
      url: target.url,
      username: target.username,
      password: target.password ?? current.webdavPassword,
    });
  }

  /**
   * Put a backup back onto a server that hasn't been set up. The file is
   * decrypted and checked in full before anything is written.
   */
  async function restore(upload: string, typedKey: string): Promise<RestoreResult> {
    const key = formatRecoveryKey(typedKey);
    await mkdir(backupDir, { recursive: true });
    const plain = path.join(backupDir, `.restore-${randomUUID()}`);
    try {
      await decryptToFile(upload, plain, key);

      let manifest: Manifest | null = null;
      const tables = new Map<string, string>();
      for await (const entry of unpackEntries(plain)) {
        if (entry.name === 'manifest.json') {
          manifest = JSON.parse(entry.data.toString('utf8')) as Manifest;
        } else if (entry.name.startsWith('table/') && entry.name.endsWith('.json')) {
          tables.set(
            entry.name.slice('table/'.length, -'.json'.length),
            entry.data.toString('utf8'),
          );
        }
      }
      if (!manifest || manifest.app !== 'mise') throw new BackupFailure('not_a_backup');
      if (manifest.format > FORMAT) throw new BackupFailure('too_new', manifest.version);

      const counts = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mise-setup'))`);
        const [existing] = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
        if ((existing?.count ?? 0) > 0) throw new AlreadySetUpError();
        const restored = await restoreTables(tx, tables);
        // A lockout from before the backup shouldn't follow anyone here.
        await tx.update(users).set({ failedAttempts: 0, lockedUntil: null });
        return restored;
      });

      // Photos second, streamed from the file, so they never all sit in memory.
      await mkdir(uploadDir, { recursive: true });
      let photos = 0;
      for await (const entry of unpackEntries(plain)) {
        if (!entry.name.startsWith('photo/')) continue;
        const name = path.basename(entry.name);
        if (!/^[\w-]+\.[a-z0-9]+$/i.test(name)) continue;
        await writeFile(path.join(uploadDir, name), entry.data);
        photos += 1;
      }

      // The key that opened this backup keeps opening the next ones.
      await settings();
      await record({ recoveryKey: key, keyConfirmedAt: new Date(), lastFingerprint: null });

      return {
        kitchenName: manifest.kitchenName,
        staff: counts.get('app_user') ?? 0,
        recipes: counts.get('recipe') ?? 0,
        photos,
      };
    } finally {
      await unlink(plain).catch(() => {});
    }
  }

  return {
    status,
    update,
    connectOnedrive,
    disconnectOnedrive,
    close: stopSignIn,
    confirmKey,
    recoveryKey,
    run,
    tick,
    filePath,
    testWebdav,
    restore,
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
