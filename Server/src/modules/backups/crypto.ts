import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { open } from 'node:fs/promises';
import { BackupFailure } from './failure.js';

/**
 * Every backup is encrypted with the kitchen's recovery key, so a copy on a
 * NAS or in someone's cloud drive is unreadable without the printed key.
 *
 * The file is: "MISEBAK1", a random salt and nonce, the AES-256-GCM
 * ciphertext, and the 16-byte tag that proves nothing was changed. The key is
 * 160 random bits, so a plain HKDF is enough to turn it into an AES key; there
 * is no password to slow guessing down for.
 */

const MAGIC = Buffer.from('MISEBAK1', 'ascii');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const KEY_BYTES = 20;

// Crockford's base32: no I, L, O or U, so the key can be read off paper.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A new recovery key, as printed: eight groups of four characters. */
export function generateRecoveryKey(): string {
  const chars = encode(randomBytes(KEY_BYTES));
  return chars.match(/.{4}/g)!.join('-');
}

/**
 * Read a key the way someone types it from paper: any case, with or without
 * dashes or spaces, and with O for 0 or I and L for 1.
 */
export function parseRecoveryKey(typed: string): Buffer {
  const cleaned = typed
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== 32 || /[^0-9A-HJKMNP-TV-Z]/.test(cleaned)) {
    throw new BackupFailure('bad_key');
  }
  return decode(cleaned);
}

/** The key in its printed form, whatever form it was typed in. */
export function formatRecoveryKey(typed: string): string {
  return encode(parseRecoveryKey(typed)).match(/.{4}/g)!.join('-');
}

function encode(bytes: Buffer): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decode(chars: string): Buffer {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of chars) {
    value = ((value << 5) | ALPHABET.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function deriveKey(keyBytes: Buffer, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', keyBytes, salt, 'mise backup v1', 32));
}

/** Encrypt a stream of chunks into a new file. Returns the file's size. */
export async function writeEncrypted(
  filePath: string,
  recoveryKey: string,
  chunks: AsyncIterable<Buffer>,
): Promise<number> {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(parseRecoveryKey(recoveryKey), salt), iv);
  const file = await open(filePath, 'w');
  let size = 0;
  const write = async (buffer: Buffer) => {
    if (buffer.length === 0) return;
    await file.write(buffer);
    size += buffer.length;
  };
  try {
    await write(Buffer.concat([MAGIC, salt, iv]));
    for await (const chunk of chunks) await write(cipher.update(chunk));
    await write(cipher.final());
    await write(cipher.getAuthTag());
    // On disk before anyone counts on it, power cut or not.
    await file.sync();
  } finally {
    await file.close();
  }
  return size;
}

/**
 * Decrypt a backup into a plain file. Nothing in the output may be trusted
 * until this returns: the tag is only checked at the very end.
 */
export async function decryptToFile(
  source: string,
  destination: string,
  recoveryKey: string,
): Promise<void> {
  const keyBytes = parseRecoveryKey(recoveryKey);
  const input = await open(source, 'r');
  try {
    const { size } = await input.stat();
    if (size < HEADER_BYTES + TAG_BYTES) throw new BackupFailure('not_a_backup');

    const header = Buffer.alloc(HEADER_BYTES);
    await input.read(header, 0, HEADER_BYTES, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupFailure('not_a_backup');
    const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
    const iv = header.subarray(MAGIC.length + SALT_BYTES);

    const tag = Buffer.alloc(TAG_BYTES);
    await input.read(tag, 0, TAG_BYTES, size - TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', deriveKey(keyBytes, salt), iv);
    decipher.setAuthTag(tag);

    const output = await open(destination, 'w');
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      const end = size - TAG_BYTES;
      for (let position = HEADER_BYTES; position < end;) {
        const { bytesRead } = await input.read(
          chunk,
          0,
          Math.min(chunk.length, end - position),
          position,
        );
        if (bytesRead === 0) break;
        await output.write(decipher.update(chunk.subarray(0, bytesRead)));
        position += bytesRead;
      }
      try {
        await output.write(decipher.final());
      } catch {
        throw new BackupFailure('wrong_key');
      }
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}
