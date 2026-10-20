import { open } from 'node:fs/promises';
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

/** Read the entries back out of a decrypted file, one at a time. */
export async function* unpackEntries(filePath: string): AsyncGenerator<Entry> {
  const file = await open(filePath, 'r');
  try {
    const { size } = await file.stat();
    let position = 0;
    const read = async (length: number): Promise<Buffer> => {
      if (position + length > size)
        throw new BackupFailure('not_a_backup', 'entry runs past the end');
      const buffer = Buffer.alloc(length);
      await file.read(buffer, 0, length, position);
      position += length;
      return buffer;
    };

    while (position < size) {
      const headerLength = (await read(4)).readUInt32BE(0);
      if (headerLength > MAX_HEADER_BYTES)
        throw new BackupFailure('not_a_backup', 'header too long');
      let header: EntryHeader;
      try {
        header = JSON.parse((await read(headerLength)).toString('utf8')) as EntryHeader;
      } catch {
        throw new BackupFailure('not_a_backup', 'unreadable header');
      }
      const body = await read(header.size);
      yield { name: header.name, data: header.gzip ? await gunzip(body) : body };
    }
  } finally {
    await file.close();
  }
}
