import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  backupStatusSchema,
  backupTicketSchema,
  confirmPasswordSchema,
  errorSchema,
  recoveryKeySchema,
  restoreResultSchema,
  testBackupDestinationSchema,
  updateBackupSettingsSchema,
  type BackupStatus,
  type UpdateBackupSettings,
} from '@mise/contracts';
import { generateToken, safeEqual } from '../../lib/crypto.js';
import { describeAgent } from '../access/service.js';
import { ApiError } from '../../lib/errors.js';
import { BackupFailure } from './failure.js';
import { AlreadySetUpError, validTimeZone } from './service.js';

/** Big enough for years of plating photos. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

/** How long a download ticket handed out from outside the kitchen lasts. */
const TICKET_MS = 60_000;

/**
 * Whether saving these settings changes where backups go or how many are
 * kept: from outside the kitchen that asks for the password again, or a
 * signed-in phone that went missing could have every night's copy of the
 * kitchen sent to a server of its own, or the old ones thrown away. The hour
 * and the time zone are no way in, and the form sends everything each time.
 */
function movesBackups(input: UpdateBackupSettings, current: BackupStatus): boolean {
  const changed = <K extends keyof BackupStatus & keyof UpdateBackupSettings>(key: K) =>
    input[key] !== undefined && input[key] !== current[key];
  const sendTo =
    input.sendTo !== undefined &&
    [...input.sendTo].sort().join() !== [...current.sendTo].sort().join();
  return (
    sendTo ||
    changed('webdavUrl') ||
    changed('webdavUsername') ||
    input.webdavPassword !== undefined ||
    changed('keepLocal') ||
    changed('keepRemote')
  );
}

export function failed(error: unknown, log?: FastifyBaseLogger): never {
  if (error instanceof BackupFailure) {
    log?.warn({ err: error }, 'backup step failed');
    // Only what went wrong, never the details (addresses, ports, the other
    // server's words): those are for the log, or the test becomes a way to
    // probe the network.
    throw new ApiError(
      400,
      `backup_${error.code}`,
      `The backup could not be done (${error.code}).`,
    );
  }
  throw error;
}

const backupRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  // Backups hold the whole kitchen and the key to it: never on a PIN alone.
  const admin = { onRequest: [app.requireRole('admin'), app.requirePassword] };

  /** Download tickets handed out from outside: each good for one file, once. */
  const tickets = new Map<string, { name: string; userId: string; expiresAt: number }>();
  function takeTicket(ticket: string, name: string, userId: string): boolean {
    const now = Date.now();
    for (const [key, held] of tickets) if (held.expiresAt <= now) tickets.delete(key);
    const held = tickets.get(ticket);
    if (!held) return false;
    tickets.delete(ticket);
    return held.name === name && held.userId === userId;
  }

  r.get(
    '/backups',
    { ...admin, schema: { response: { 200: backupStatusSchema, 403: errorSchema } } },
    async () => app.backups.status(),
  );

  r.patch(
    '/backups',
    {
      ...admin,
      schema: {
        body: updateBackupSettingsSchema,
        response: { 200: backupStatusSchema, 400: errorSchema, 403: errorSchema, 429: errorSchema },
      },
    },
    async (request) => {
      const { currentPassword, ...settings } = request.body;
      if (settings.timeZone !== undefined && !validTimeZone(settings.timeZone)) {
        throw new ApiError(
          400,
          'unknown_time_zone',
          'That time zone is not one this server knows.',
        );
      }
      if (movesBackups(settings, await app.backups.status())) {
        await app.outsideNeedsPassword(request, currentPassword);
      }
      const result = await app.backups.update(settings);
      if (result === 'needs_address') {
        throw new ApiError(
          400,
          'nas_address_needed',
          'Enter the address of the NAS to send backups to.',
        );
      }
      if (result === 'needs_onedrive') {
        throw new ApiError(400, 'onedrive_not_connected', 'Connect OneDrive first.');
      }
      return app.backups.status();
    },
  );

  r.post(
    '/backups/run',
    { ...admin, schema: { response: { 200: backupStatusSchema, 403: errorSchema } } },
    async () => {
      await app.backups.run({ force: true });
      return app.backups.status();
    },
  );

  r.post(
    '/backups/test',
    {
      ...admin,
      schema: {
        body: testBackupDestinationSchema,
        response: { 204: z.null(), 400: errorSchema, 403: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      // From outside, with the password again: a test reaches out to any
      // address it is given, and with the saved name and password.
      await app.outsideNeedsPassword(request, request.body.currentPassword);
      await app.backups
        .testWebdav({
          url: request.body.webdavUrl,
          username: request.body.webdavUsername ?? null,
          password: request.body.webdavPassword ?? null,
        })
        .catch((error: unknown) => failed(error, request.log));
      return reply.status(204).send(null);
    },
  );

  // From outside, with the password again: whichever OneDrive signs in here
  // gets every backup, and taking it away stops them going anywhere else.
  r.post(
    '/backups/onedrive',
    {
      ...admin,
      schema: {
        body: confirmPasswordSchema.nullish(),
        response: { 200: backupStatusSchema, 400: errorSchema, 403: errorSchema, 429: errorSchema },
      },
    },
    async (request) => {
      await app.outsideNeedsPassword(request, request.body?.currentPassword);
      await app.backups.connectOnedrive().catch((error: unknown) => failed(error, request.log));
      return app.backups.status();
    },
  );

  r.delete(
    '/backups/onedrive',
    {
      ...admin,
      schema: {
        body: confirmPasswordSchema.nullish(),
        response: { 200: backupStatusSchema, 403: errorSchema, 429: errorSchema },
      },
    },
    async (request) => {
      // Calling off a sign-in still waiting for its code takes nothing away.
      if ((await app.backups.status()).onedrive.account) {
        await app.outsideNeedsPassword(request, request.body?.currentPassword);
      }
      await app.backups.disconnectOnedrive();
      return app.backups.status();
    },
  );

  /**
   * The recovery key opens every backup, so with a downloaded one it is the
   * whole kitchen. A POST, so that from outside the password can come with it.
   */
  r.post(
    '/backups/key',
    {
      ...admin,
      schema: {
        body: confirmPasswordSchema.nullish(),
        response: { 200: recoveryKeySchema, 403: errorSchema, 429: errorSchema },
      },
    },
    async (request) => {
      await app.outsideNeedsPassword(request, request.body?.currentPassword);
      return { recoveryKey: await app.backups.recoveryKey() };
    },
  );

  r.post(
    '/backups/key/confirm',
    { ...admin, schema: { response: { 204: z.null(), 403: errorSchema } } },
    async (_request, reply) => {
      await app.backups.confirmKey();
      return reply.status(204).send(null);
    },
  );

  /**
   * From outside the kitchen, a download takes the password again, which a
   * link can't carry: it buys a ticket for the one file, used straight away.
   */
  r.post(
    '/backups/files/:name/ticket',
    {
      ...admin,
      schema: {
        params: z.object({ name: z.string().max(100) }),
        body: confirmPasswordSchema.nullish(),
        response: { 200: backupTicketSchema, 403: errorSchema, 404: errorSchema, 429: errorSchema },
      },
    },
    async (request) => {
      if (!(await app.backups.filePath(request.params.name)))
        throw ApiError.notFound('That backup');
      await app.outsideNeedsPassword(request, request.body?.currentPassword);
      const ticket = generateToken();
      tickets.set(ticket, {
        name: request.params.name,
        userId: request.user!.id,
        expiresAt: Date.now() + TICKET_MS,
      });
      return { ticket };
    },
  );

  r.get(
    '/backups/files/:name',
    {
      ...admin,
      schema: {
        params: z.object({ name: z.string().max(100) }),
        querystring: z.object({ ticket: z.string().max(100).optional() }),
      },
    },
    async (request, reply) => {
      // A backup is the whole kitchen: from outside, only with a ticket.
      if (
        !request.inside &&
        !takeTicket(request.query.ticket ?? '', request.params.name, request.user!.id)
      ) {
        throw new ApiError(
          403,
          'download_ticket',
          'From outside the kitchen, downloading a backup asks for your password again.',
        );
      }
      const file = await app.backups.filePath(request.params.name);
      if (!file) throw ApiError.notFound('That backup');
      return reply
        .header('content-type', 'application/octet-stream')
        .header('content-disposition', `attachment; filename="${request.params.name}"`)
        .header('cache-control', 'no-store')
        .send(createReadStream(file));
    },
  );

  /**
   * The other way into a new server: instead of the setup screens, a backup
   * and its recovery key. Same one-time code as setup, same rule that the
   * server must still be empty.
   */
  r.post(
    '/setup/restore',
    {
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
      schema: {
        response: {
          200: restoreResultSchema,
          400: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!(await app.auth.needsSetup())) throw ApiError.notFound('This page');

      const fields: Record<string, string> = {};
      const backupDir = path.resolve(app.config.BACKUP_DIR);
      await mkdir(backupDir, { recursive: true });
      const upload = path.join(backupDir, `.upload-${randomUUID()}`);
      let received = false;

      try {
        for await (const part of request.parts({
          limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
        })) {
          if (part.type === 'field') {
            fields[part.fieldname] = String(part.value);
            continue;
          }
          // The code is checked before a single byte of the file is kept.
          if (
            app.setupCodeNeeded(request) &&
            !safeEqual(fields.setupToken ?? '', app.setupToken ?? '')
          ) {
            part.file.resume();
            throw new ApiError(
              403,
              'setup_token',
              'That setup code is wrong. It is SETUP_TOKEN in the settings, or the code Mise printed in its log.',
            );
          }
          await pipeline(part.file, createWriteStream(upload));
          if (part.file.truncated)
            throw new ApiError(400, 'file_too_large', 'That file is too large.');
          received = true;
        }
        if (!received) throw new ApiError(400, 'backup_file_missing', 'Attach the backup file.');

        const result = await app.backups
          .restore(upload, fields.recoveryKey ?? '')
          .catch((error) => {
            if (error instanceof AlreadySetUpError) {
              throw new ApiError(409, 'already_set_up', 'This server has already been set up.');
            }
            return failed(error, request.log);
          });
        const timeZone = fields.timeZone;
        if (timeZone && validTimeZone(timeZone)) await app.backups.update({ timeZone });
        // Restored from outside, with the setup code: this device may come back in.
        if (!request.inside) {
          const { token } = await app.access.approveNew({
            name: describeAgent(request.headers['user-agent']),
            userAgent: request.headers['user-agent'] ?? null,
            address: request.ip,
            userId: null,
          });
          app.setAccessCookie(reply, token);
        }
        return result;
      } finally {
        await unlink(upload).catch(() => {});
      }
    },
  );
};

export default backupRoutes;
