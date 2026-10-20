import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
  }
}

const configPlugin: FastifyPluginAsync<{ config: Config }> = async (app, opts) => {
  app.decorate('config', opts.config);
};

export default fp(configPlugin, { name: 'config' });
