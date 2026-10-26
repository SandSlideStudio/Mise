import type { FastifyBaseLogger } from 'fastify';

/**
 * Whether a newer Mise is out. Once a day the server asks GitHub for the
 * latest release, if the kitchen allows it, and remembers the answer until the
 * next time. Nothing is sent but the request itself: no kitchen name, no
 * counts, no identifier.
 */

export const RELEASES_URL = 'https://api.github.com/repos/SandSlideStudio/Mise/releases/latest';
const DAY_MS = 86_400_000;
const FIRST_CHECK_MS = 60_000;

export interface LatestRelease {
  version: string;
  url: string;
}

export interface UpdateState {
  latest: LatestRelease | null;
  checkedAt: Date | null;
  failed: boolean;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** "v2.1.0" or "2.1.0" as numbers, or null for anything else ("dev", "2.1.0-rc.1"). */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** True only when both are plain versions and the first is newer. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
}

export function createUpdateChecker(options: {
  current: string;
  enabled: () => Promise<boolean>;
  log: FastifyBaseLogger;
  fetch?: Fetch;
}) {
  const fetchRelease = options.fetch ?? ((url, init) => fetch(url, init));
  const state: UpdateState = { latest: null, checkedAt: null, failed: false };
  const timers: NodeJS.Timeout[] = [];

  async function check(): Promise<UpdateState> {
    try {
      const response = await fetchRelease(RELEASES_URL, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': `Mise/${options.current}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
      const body = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
      const version = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/, '') : '';
      if (!parseVersion(version) || typeof body.html_url !== 'string') {
        throw new Error('GitHub sent no usable release');
      }
      state.latest = { version, url: body.html_url };
      state.failed = false;
    } catch (error) {
      // A kitchen without internet is normal; say so quietly and try tomorrow.
      options.log.info({ error: String(error) }, 'could not check for a newer Mise');
      state.failed = true;
    }
    state.checkedAt = new Date();
    return state;
  }

  async function checkIfAllowed(): Promise<void> {
    if (await options.enabled()) await check();
  }

  return {
    state: () => state,
    current: options.current,
    /** Whether the kitchen allows the daily check. */
    enabled: options.enabled,
    check,
    /** A minute after start, then once a day. */
    start() {
      timers.push(setTimeout(() => void checkIfAllowed(), FIRST_CHECK_MS).unref());
      timers.push(setInterval(() => void checkIfAllowed(), DAY_MS).unref());
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
    },
  };
}

export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
