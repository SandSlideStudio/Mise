import type { ApiError } from '@mise/contracts';

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
  const response = await fetch(buildUrl(path, options.query), {
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

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new RequestFailed(response.status, parsed as ApiError | null, response.statusText);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
