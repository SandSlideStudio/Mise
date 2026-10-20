import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Two kinds of secret live in this system and they are protected differently.
 *
 * Passwords and PINs are low entropy and chosen by people, so they get argon2id
 * with a deliberately slow cost. Session and device tokens are 256 random bits
 * that we generated ourselves, so a plain SHA-256 is enough: there is nothing
 * to brute force, and the lookup has to be fast on every request.
 */

const ARGON2_OPTIONS = {
  // Sensible interactive parameters: 19 MiB, two passes.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashSecret(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a password or PIN. Never throws on a malformed stored hash; a broken
 * row is a failed sign-in, not a 500.
 */
export async function verifySecret(storedHash: string | null, plain: string): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

/** A high-entropy opaque token, safe to put in a cookie. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** What we actually store for a token. The token itself is never persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Constant-time comparison for anything derived from user input. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A real argon2id hash of a value nobody will ever supply, computed once on
 * first use. Verifying against it costs the same as verifying a genuine
 * credential, which is the whole point.
 */
let dummyHash: Promise<string> | null = null;

/**
 * Burn roughly the same time a real verification would, so an attacker cannot
 * tell a missing account from a wrong password by timing the response.
 */
export async function dummyVerify(): Promise<void> {
  dummyHash ??= hashSecret(generateToken());
  await verifySecret(await dummyHash, 'not-the-password');
}
