import type { ApiError } from '@mise/contracts';
import { markReachable, markUnreachable } from '../lib/connectivity.js';
import {
  add as addToOutbox,
  entriesFor,
  goingOut,
  newWriteId,
  type OutboxEntry,
} from '../lib/outbox.js';
import { noteServerDate } from '../lib/serverClock.js';

/**
 * The one place that knows how to talk to a Mise server.
 *
 * The base URL is configurable even though the web app is served from the same
 * origin as the API, because the mobile and desktop apps will point at whatever
 * server their kitchen runs. Keeping that seam here means those apps reuse this
 * file unchanged.
 */

export const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export class RequestFailed extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: ApiError | null, fallback: string) {
    // Not always Mise answering: a proxy's error page can be any JSON at all.
    super(body?.error?.message ?? fallback);
    this.name = 'RequestFailed';
    this.status = status;
    this.code = body?.error?.code ?? 'unknown';
    this.details = body?.error?.details;
  }

  /** True when the answer is "sign in first", which the shell handles globally. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

/** A proxy in front answering for a Mise that is down. As good as no answer. */
const UNREACHABLE = new Set([502, 503, 504]);

interface RequestOptions {
  headers?: Record<string, string>;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = `${BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  const sentAt = Date.now();
  try {
    response = await send(path, options);
  } catch (error) {
    // No answer at all: the network, or Mise itself, is down.
    if (!(error instanceof DOMException && error.name === 'AbortError')) markUnreachable();
    throw error;
  }
  if (UNREACHABLE.has(response.status)) markUnreachable();
  else {
    markReachable();
    noteServerDate(response.headers.get('date'), sentAt, Date.now());
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = parseJson(text, response.headers.get('content-type'));

  // An error is an error, whatever its body: a web server's HTML error page
  // or a plain "Not found" must be a refusal like any other, never "no answer".
  if (!response.ok) {
    throw new RequestFailed(response.status, parsed as ApiError | null, response.statusText);
  }
  // A success that isn't Mise's JSON came from something in between, such as
  // a hotel wifi login page: as good as no answer.
  if (text && parsed === undefined) {
    markUnreachable();
    throw new TypeError('Not an answer from Mise');
  }
  return (parsed ?? null) as T;
}

/** The body as JSON, or undefined when it isn't. */
function parseJson(text: string, contentType: string | null): unknown {
  if (!text) return null;
  if (contentType && !contentType.includes('json')) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function send(path: string, options: RequestOptions): Promise<Response> {
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // Sessions are httpOnly cookies, so every request has to carry them.
    credentials: 'same-origin',
    signal: options.signal,
  });
}

// --- changes that may wait ---------------------------------------------------

/** What a change that was saved on the device, rather than sent, resolves to. */
export const QUEUED: unique symbol = Symbol('queued');
export type Queued = typeof QUEUED;
export const isQueued = (value: unknown): value is Queued => value === QUEUED;

let currentUserId: string | null = null;
/** Who is signed in, so a waiting change is kept as theirs. Set by the shell. */
export function setOutboxUser(id: string | null): void {
  currentUserId = id;
}

/** Whether the answer means "no answer": try again later rather than give up. */
export function noAnswer(error: unknown): boolean {
  if (error instanceof RequestFailed) return UNREACHABLE.has(error.status);
  return !(error instanceof DOMException && error.name === 'AbortError');
}

/**
 * Send a change, or keep it on the device when Mise can't be reached, to be
 * sent later in order (see api/outbox.ts). Resolves with the server's answer,
 * or QUEUED; the caller then shows the change itself until the real answer
 * comes. Behind any change already waiting, it waits too, so changes never
 * overtake each other.
 */
export async function sendOrQueue<T>(
  method: OutboxEntry['method'],
  path: string,
  body: unknown,
  offline: { label: OutboxEntry['label']; base?: string | null },
): Promise<T | Queued> {
  const id = newWriteId();
  const userId = currentUserId;
  const queue = (): Queued => {
    if (!userId) throw new Error('offline');
    addToOutbox({
      id,
      userId,
      method,
      path,
      body,
      label: offline.label,
      ...(offline.base !== undefined && offline.base !== null ? { base: offline.base } : {}),
    });
    return QUEUED;
  };

  // Behind anything waiting; a change set aside only holds up changes to the same thing.
  if (userId) {
    const entries = entriesFor(userId);
    const behind = goingOut(entries).length > 0 || entries.some((entry) => entry.path === path);
    if (behind) return queue();
  }
  const base = offline.base ?? undefined;
  try {
    return await request<T>(path, {
      method,
      body,
      // The version this edit started from goes along online too, so two
      // people saving the same thing never overwrite each other unseen.
      headers: { 'x-mise-write': id, ...(base ? { 'x-mise-base': base } : {}) },
    });
  } catch (error) {
    if (noAnswer(error)) return queue();
    // Changed by someone else since: kept on the device with what is there
    // now, and the same side-by-side choice as for a change made offline.
    if (error instanceof RequestFailed && error.code === 'changed_meanwhile' && userId) {
      const current = (error.details as { current?: unknown } | undefined)?.current ?? null;
      addToOutbox({
        id,
        userId,
        method,
        path,
        body,
        label: offline.label,
        ...(base ? { base } : {}),
        conflict: { current },
      });
      return QUEUED;
    }
    throw error;
  }
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
