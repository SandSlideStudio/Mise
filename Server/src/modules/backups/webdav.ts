import { createReadStream } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { BackupFailure } from './failure.js';

/**
 * Just enough WebDAV to keep backups on a NAS or Nextcloud: put a file, list
 * the folder, delete old files. Synology, QNAP and Nextcloud all speak it.
 */

export interface WebdavTarget {
  url: string;
  username: string | null;
  password: string | null;
}

interface Answer {
  status: number;
  text: string;
}

/** Long enough for a large upload over a slow link, short enough to notice a dead NAS. */
const TIMEOUT_MS = 120_000;

function folder(target: WebdavTarget): URL {
  const url = new URL(target.url);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}

function call(
  method: string,
  url: URL,
  target: WebdavTarget,
  options: {
    headers?: Record<string, string | number>;
    body?: Buffer | string;
    file?: string;
  } = {},
): Promise<Answer> {
  const transport = url.protocol === 'https:' ? https : http;
  const headers: Record<string, string | number> = { ...options.headers };
  if (target.username) {
    const token = Buffer.from(`${target.username}:${target.password ?? ''}`).toString('base64');
    headers.authorization = `Basic ${token}`;
  }

  return new Promise((resolve, reject) => {
    const request = transport.request(url, { method, headers, timeout: TIMEOUT_MS }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        // A folder listing is all we ever read; anything longer is cut off.
        if (text.length < 1_000_000) text += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('timed out')));
    request.on('error', (error) =>
      reject(new BackupFailure('unreachable', `${url.host}: ${error.message}`)),
    );
    if (options.file) createReadStream(options.file).on('error', reject).pipe(request);
    else request.end(options.body);
  });
}

function check(answer: Answer, what: string): void {
  if (answer.status >= 200 && answer.status < 300) return;
  if (answer.status === 401 || answer.status === 403) throw new BackupFailure('auth', what);
  if (answer.status === 404 || answer.status === 405 || answer.status === 409) {
    throw new BackupFailure('folder', `${what}: ${answer.status}`);
  }
  throw new BackupFailure('remote', `${what}: ${answer.status}`);
}

export async function upload(
  target: WebdavTarget,
  name: string,
  file: string,
  size: number,
): Promise<void> {
  const answer = await call('PUT', new URL(encodeURIComponent(name), folder(target)), target, {
    headers: { 'content-type': 'application/octet-stream', 'content-length': size },
    file,
  });
  check(answer, `upload ${name}`);
}

/** The names of the files in the backup folder. */
export async function list(target: WebdavTarget): Promise<string[]> {
  const answer = await call('PROPFIND', folder(target), target, {
    headers: { depth: 1, 'content-type': 'application/xml' },
    body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>',
  });
  check(answer, 'list folder');
  const names: string[] = [];
  for (const match of answer.text.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/g)) {
    const href = decodeURIComponent(match[1]!.trim()).replace(/\/+$/, '');
    names.push(href.slice(href.lastIndexOf('/') + 1));
  }
  return names;
}

export async function remove(target: WebdavTarget, name: string): Promise<void> {
  const answer = await call('DELETE', new URL(encodeURIComponent(name), folder(target)), target);
  if (answer.status !== 404) check(answer, `delete ${name}`);
}

/** Write and remove a small file, to prove the address and the password work. */
export async function test(target: WebdavTarget): Promise<void> {
  const probe = '.mise-check';
  const answer = await call('PUT', new URL(probe, folder(target)), target, {
    headers: { 'content-type': 'text/plain' },
    body: 'Mise checked it can write here.',
  });
  check(answer, 'write a test file');
  await remove(target, probe);
}
