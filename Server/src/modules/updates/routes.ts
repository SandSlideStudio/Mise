import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { errorSchema, updateVersionCheckSchema, versionInfoSchema } from '@mise/contracts';
import { kitchens } from '../../db/schema.js';
import { isNewer } from './service.js';

const updateRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  async function info(isAdmin: boolean) {
    const enabled = await app.updates.enabled();
    const state = app.updates.state();
    const latest = isAdmin && enabled ? state.latest : null;
    return {
      current: app.updates.current,
      checkEnabled: enabled,
      latest: latest?.version ?? null,
      newer: latest ? isNewer(latest.version, app.updates.current) : false,
      releaseUrl: latest?.url ?? null,
      checkedAt: isAdmin && enabled ? (state.checkedAt?.toISOString() ?? null) : null,
      checkFailed: isAdmin && enabled ? state.failed : false,
    };
  }

  r.get(
    '/version',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: versionInfoSchema, 401: errorSchema } },
    },
    async (request) => info(request.user!.role === 'admin'),
  );

  r.put(
    '/version/check',
    {
      onRequest: [app.requireRole('admin')],
      schema: {
        body: updateVersionCheckSchema,
        response: { 200: versionInfoSchema, 403: errorSchema },
      },
    },
    async (request) => {
      await app.db.update(kitchens).set({ updateCheck: request.body.enabled });
      // Switched on: answer now rather than tomorrow.
      if (request.body.enabled) await app.updates.check();
      return info(true);
    },
  );
};

export default updateRoutes;
