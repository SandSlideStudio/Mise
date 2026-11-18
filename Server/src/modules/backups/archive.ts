import { promisify } from 'node:util';
import { gunzip as gunzipCallback, gzip as gzipCallback } from 'node:zlib';
import { BackupFailure } from './failure.js';

/**
 * What goes inside the encryption: a plain run of named entries, each a
 * 4-byte header length, a small JSON header and the bytes. Tables are
 * compressed; photos are already compressed and go in as they are.
 */

const gzip = promisify(gzipCallback);
const gunzip = promisify(gunzipCallback);

export interface Entry {
  name: string;
  data: Buffer;
  compress?: boolean;
}

interface EntryHeader {
  name: string;
  size: number;
  gzip: boolean;
}

/** Larger than any real header; anything bigger means a damaged file. */
const MAX_HEADER_BYTES = 64 * 1024;

export async function* packEntries(entries: AsyncIterable<Entry> | Iterable<Entry>) {
  for await (const entry of entries) {
    const body = entry.compress ? await gzip(entry.data) : entry.data;
    const header: EntryHeader = { name: entry.name, size: body.length, gzip: !!entry.compress };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length);
    yield length;
    yield headerBytes;
    yield body;
  }
}

/**
 * Read the entries back out of a stream of plain chunks, one at a time. Only
 * ever one entry (and the chunk being read) is held in memory.
 */
export async function* unpackEntries(chunks: AsyncIterable<Buffer>): AsyncGenerator<Entry> {
  const iterator = chunks[Symbol.asyncIterator]();
  let buffered: Buffer = Buffer.alloc(0);
  let finished = false;

  const read = async (length: number): Promise<Buffer> => {
    const parts: Buffer[] = [];
    let have = 0;
    while (have < length) {
      if (buffered.length === 0) {
        const next = finished ? { done: true as const } : await iterator.next();
        if (next.done) {
          finished = true;
          throw new BackupFailure('not_a_backup', 'entry runs past the end');
        }
        buffered = next.value;
        continue;
      }
      const take = Math.min(buffered.length, length - have);
      parts.push(buffered.subarray(0, take));
      buffered = buffered.subarray(take);
      have += take;
    }
    return Buffer.concat(parts);
  };

  // Whether anything is left to read. This pulls the final chunk too, which is
  // where a changed file is caught.
  const more = async (): Promise<boolean> => {
    while (buffered.length === 0) {
      if (finished) return false;
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        return false;
      }
      buffered = next.value;
    }
    return true;
  };

  while (await more()) {
    const headerLength = (await read(4)).readUInt32BE(0);
    if (headerLength > MAX_HEADER_BYTES) throw new BackupFailure('not_a_backup', 'header too long');
    let header: EntryHeader;
    try {
      header = JSON.parse((await read(headerLength)).toString('utf8')) as EntryHeader;
    } catch {
      throw new BackupFailure('not_a_backup', 'unreadable header');
    }
    const body = await read(header.size);
    yield { name: header.name, data: header.gzip ? await gunzip(body) : body };
  }
}
