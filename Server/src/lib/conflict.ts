import type { FastifyRequest } from 'fastify';
import { ApiError } from './errors.js';

/**
 * "Someone changed this while you were offline."
 *
 * An edit is sent with the version it started from, in X-Mise-Base: online
 * from an open form as much as offline from the waiting list: the thing's last-changed time, or "none" for something that
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
 * Whether the edit started from the version that is current. current is the
 * thing's last-changed time now (null: not there yet). True when the edit
 * names no version at all.
 *
 * Writes call this inside the transaction that saves them, on a row they hold
 * locked, so another save can't land between the check and the write.
 */
export function matchesBase(request: FastifyRequest, current: Date | null): boolean {
  const base = editBase(request);
  if (base === undefined) return true;
  return base === 'none'
    ? current === null
    : current !== null && current.getTime() === base.getTime();
}

/** The refusal: describe gives the thing as the API shows it now. */
export async function changedMeanwhile(describe: () => Promise<unknown> | unknown): Promise<never> {
  throw new ApiError(409, 'changed_meanwhile', 'Someone else changed this since you started.', {
    current: await describe(),
  });
}

/**
 * Throws when the edit started from another version than the current one.
 * current is the thing's last-changed time now (null: not there yet);
 * describe gives it as the API shows it, for the device to put side by side.
 *
 * On its own this is only a quick answer: the write itself must check again
 * under a row lock (see matchesBase).
 */
export async function ensureUnchanged(
  request: FastifyRequest,
  current: Date | null,
  describe: () => Promise<unknown> | unknown,
): Promise<void> {
  if (matchesBase(request, current)) return;
  await changedMeanwhile(describe);
}
