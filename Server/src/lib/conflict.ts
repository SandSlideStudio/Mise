import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

/**
 * "Someone changed this while you were offline."
 *
 * An edit made offline is sent with the version it started from, in
 * X-Mise-Base: the thing's last-changed time, or "none" for something that
 * wasn't there yet. If the thing has changed since, the edit is refused with
 * what is there now, and the device shows both and asks which to keep.
 * Without the header, the edit simply goes through, as always.
 */

/** The version an edit started from: a time, "none", or undefined when not given. */
export function editBase(request: FastifyRequest): Date | 'none' | undefined {
  const value = request.headers['x-mise-base'];
  if (typeof value !== 'string' || !value) return undefined;
  if (value === 'none') return 'none';
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
}

/**
 * Throws when the edit started from another version than the current one.
 * current is the thing's last-changed time now (null: not there yet);
 * describe gives it as the API shows it, for the device to put side by side.
 */
export async function ensureUnchanged(
  request: FastifyRequest,
  current: Date | null,
  describe: () => Promise<unknown> | unknown,
): Promise<void> {
  const base = editBase(request);
  if (base === undefined) return;
  const same =
    base === 'none' ? current === null : current !== null && current.getTime() === base.getTime();
  if (same) return;
  throw new ApiError(409, 'changed_meanwhile', 'Someone changed this while you were offline.', {
    current: await describe(),
  });
}
