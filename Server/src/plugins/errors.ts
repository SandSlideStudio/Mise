import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { ApiError } from '../lib/errors.js';

/**
 * Postgres error codes we turn into something a person can act on.
 *
 * Both referential codes matter and they are not interchangeable: a column
 * declared "on delete restrict" raises 23001, while 23503 comes from a plain
 * foreign key check. Either way the answer to the user is the same.
 */
const PG_UNIQUE_VIOLATION = '23505';
const PG_RESTRICT_VIOLATION = '23001';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';

/**
 * Find the Postgres error code, wherever it ended up.
 *
 * Drizzle wraps driver errors, so the code can sit a level or two down the
 * cause chain. Postgres codes are always five characters, which keeps this
 * from mistaking a Node or Fastify code such as FST_ERR_VALIDATION for one.
 */
function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

const errorsPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: 'validation_failed',
          message: 'That request did not look right.',
          details: error.validation,
        },
      });
    }

    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response did not match its schema');
      return reply
        .status(500)
        .send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
    }

    // The zod guards above narrow the parameter, so reach for the original
    // shape explicitly rather than relying on what is left of it.
    const failure = error as { code?: string; statusCode?: number; message?: string };
    const pgCode = postgresErrorCode(error);
    if (pgCode === PG_UNIQUE_VIOLATION) {
      return reply.status(409).send({
        error: { code: 'already_exists', message: 'That already exists.' },
      });
    }
    if (pgCode === PG_RESTRICT_VIOLATION || pgCode === PG_FOREIGN_KEY_VIOLATION) {
      return reply.status(409).send({
        error: {
          code: 'still_referenced',
          message: 'That is still used somewhere else, so it cannot be removed.',
        },
      });
    }
    if (pgCode === PG_CHECK_VIOLATION) {
      return reply.status(400).send({
        error: { code: 'invalid_data', message: 'That value is not allowed here.' },
      });
    }

    if (failure.statusCode && failure.statusCode < 500) {
      return reply.status(failure.statusCode).send({
        error: {
          code: failure.code ?? 'request_failed',
          message: failure.message ?? 'That request could not be completed.',
        },
      });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  // The not-found handler lives in app.ts, because Fastify allows exactly one
  // per prefix and it needs to know whether a built client is there to fall
  // back to.
};

export default fp(errorsPlugin, { name: 'errors' });
