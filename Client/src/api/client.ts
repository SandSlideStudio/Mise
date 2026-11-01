import type { ApiError } from '@mise/contracts';
import { markReachable, markUnreachable } from '../lib/connectivity.js';
import { add as addToOutbox, entriesFor, newWriteId, type OutboxEntry } from '../lib/outbox.js';

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
    super(body?.error.message ?? fallback);
    this.name = 'RequestFailed';
    this.status = status;
    this.code = body?.error.code ?? 'unknown';
    this.details = body?.error.details;
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
  try {
    response = await send(path, options);
  } catch (error) {
    // No answer at all: the network, or Mise itself, is down.
    if (!(error instanceof DOMException && error.name === 'AbortError')) markUnreachable();
    throw error;
  }
  if (UNREACHABLE.has(response.status)) markUnreachable();
  else markReachable();

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new RequestFailed(response.status, parsed as ApiError | null, response.statusText);
  }
  return parsed as T;
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
function noAnswer(error: unknown): boolean {
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

  if (userId && entriesFor(userId).length > 0) return queue();
  try {
    return await request<T>(path, { method, body, headers: { 'x-mise-write': id } });
  } catch (error) {
    if (noAnswer(error)) return queue();
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
