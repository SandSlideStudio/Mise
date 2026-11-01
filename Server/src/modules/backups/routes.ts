import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  backupStatusSchema,
  errorSchema,
  recoveryKeySchema,
  restoreResultSchema,
  testBackupDestinationSchema,
  updateBackupSettingsSchema,
} from '@mise/contracts';
import { safeEqual } from '../../lib/crypto.js';
import { describeAgent } from '../access/service.js';
import { ApiError } from '../../lib/errors.js';
import { BackupFailure } from './failure.js';
import { AlreadySetUpError, validTimeZone } from './service.js';

/** Big enough for years of plating photos. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

export function failed(error: unknown): never {
  if (error instanceof BackupFailure) {
    throw new ApiError(400, `backup_${error.code}`, error.message);
  }
  throw error;
}

const backupRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const admin = { onRequest: [app.requireRole('admin')] };

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
        response: { 200: backupStatusSchema, 400: errorSchema, 403: errorSchema },
      },
    },
    async (request) => {
      if (request.body.timeZone !== undefined && !validTimeZone(request.body.timeZone)) {
        throw ApiError.badRequest('That time zone is not one this server knows.');
      }
      const result = await app.backups.update(request.body);
      if (result === 'needs_address') {
        throw ApiError.badRequest('Enter the address of the NAS to send backups to.');
      }
      if (result === 'needs_onedrive') {
        throw ApiError.badRequest('Connect OneDrive first.');
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
        response: { 204: z.null(), 400: errorSchema, 403: errorSchema },
      },
    },
    async (request, reply) => {
      await app.backups
        .testWebdav({
          url: request.body.webdavUrl,
          username: request.body.webdavUsername ?? null,
          password: request.body.webdavPassword ?? null,
        })
        .catch(failed);
      return reply.status(204).send(null);
    },
  );

  r.post(
    '/backups/onedrive',
    {
      ...admin,
      schema: { response: { 200: backupStatusSchema, 400: errorSchema, 403: errorSchema } },
    },
    async () => {
      await app.backups.connectOnedrive().catch(failed);
      return app.backups.status();
    },
  );

  r.delete(
    '/backups/onedrive',
    { ...admin, schema: { response: { 200: backupStatusSchema, 403: errorSchema } } },
    async () => {
      await app.backups.disconnectOnedrive();
      return app.backups.status();
    },
  );

  r.get(
    '/backups/key',
    { ...admin, schema: { response: { 200: recoveryKeySchema, 403: errorSchema } } },
    async () => ({ recoveryKey: await app.backups.recoveryKey() }),
  );

  r.post(
    '/backups/key/confirm',
    { ...admin, schema: { response: { 204: z.null(), 403: errorSchema } } },
    async (_request, reply) => {
      await app.backups.confirmKey();
      return reply.status(204).send(null);
    },
  );

  r.get(
    '/backups/files/:name',
    { ...admin, schema: { params: z.object({ name: z.string().max(100) }) } },
    async (request, reply) => {
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
          if (part.file.truncated) throw ApiError.badRequest('That file is too large.');
          received = true;
        }
        if (!received) throw ApiError.badRequest('Attach the backup file.');

        const result = await app.backups
          .restore(upload, fields.recoveryKey ?? '')
          .catch((error) => {
            if (error instanceof AlreadySetUpError) {
              throw ApiError.conflict('This server has already been set up.');
            }
            return failed(error);
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
