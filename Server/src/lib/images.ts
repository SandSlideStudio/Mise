import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError } from './errors.js';

/**
 * What a photograph really is, from its first bytes. The type an upload
 * claims is only what the browser guessed from the file name, so a text or
 * SVG file renamed to .jpg would carry it. Only what the content proves is
 * stored and served.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif';

export const IMAGE_EXTENSION: Record<ImageKind, string> = {
  jpeg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
};

/** Enough bytes to tell every kind apart: an AVIF's brand sits in the first box. */
const HEAD_BYTES = 32;

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

const has = (head: Buffer, at: number, text: string) =>
  head.length >= at + text.length && head.toString('latin1', at, at + text.length) === text;

export function sniffImage(head: Buffer): ImageKind | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (has(head, 0, 'RIFF') && has(head, 8, 'WEBP')) return 'webp';
  // An ISO media file starts with a box: its size, then "ftyp", then the main
  // brand and a list of compatible ones. AVIF says so in one of them.
  if (has(head, 4, 'ftyp') && head.length >= 12) {
    const size = Math.min(head.readUInt32BE(0), head.length);
    const brands = [8, ...Array.from({ length: 4 }, (_, i) => 16 + i * 4)].filter(
      (at) => at + 4 <= size,
    );
    if (brands.some((at) => has(head, at, 'avif') || has(head, at, 'avis'))) return 'avif';
  }
  return null;
}

/**
 * Store an upload once its first bytes prove it is one of `allowed`. The file
 * is streamed to disk, never held whole: only the first few bytes are looked
 * at before the rest follows. Returns the stored name, or throws `image_type`
 * having written nothing.
 */
export async function storeImage(
  stream: Readable & { truncated?: boolean },
  options: {
    dir: string;
    name: (extension: string) => string;
    allowed: readonly ImageKind[];
    tooLarge: ApiError;
  },
): Promise<string> {
  const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const chunks: Buffer[] = [];
  let length = 0;
  let ended = false;
  while (length < HEAD_BYTES && !ended) {
    const next = await iterator.next();
    if (next.done) ended = true;
    else {
      chunks.push(next.value);
      length += next.value.length;
    }
  }
  const head = Buffer.concat(chunks);
  const kind = sniffImage(head.subarray(0, HEAD_BYTES));
  if (!kind || !options.allowed.includes(kind)) {
    stream.destroy();
    throw new ApiError(
      400,
      'image_type',
      "That file isn't a photo Mise can show. Use a JPEG, PNG, WebP or AVIF.",
    );
  }

  const storedName = options.name(IMAGE_EXTENSION[kind]);
  const absolute = path.join(options.dir, storedName);
  async function* all() {
    yield head;
    while (!ended) {
      const next = await iterator.next();
      if (next.done) break;
      yield next.value;
    }
  }
  await pipeline(Readable.from(all()), createWriteStream(absolute));
  if (stream.truncated) {
    await unlink(absolute).catch(() => {});
    throw options.tooLarge;
  }
  return storedName;
}
