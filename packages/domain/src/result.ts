/**
 * A tiny Result type. The domain never throws for expected failures — a
 * missing density is a normal thing for a kitchen to have, not an exception —
 * so callers are forced to handle it at the call site.
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

export function isErr<T, E>(r: Result<T, E>): r is { ok: false; error: E } {
  return !r.ok;
}

/** Unwrap, throwing on failure. For tests and for call sites that already checked. */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`unwrap called on an error result: ${JSON.stringify(r.error)}`);
}

/** Collect a list of results into a result of a list, failing on the first error. */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const r of results) {
    if (!r.ok) return r;
    values.push(r.value);
  }
  return ok(values);
}
