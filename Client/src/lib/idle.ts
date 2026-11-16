/**
 * Noticing that a shared tablet has been left alone.
 *
 * Only real interaction counts (a touch, a key, a wheel turn), never what the
 * page does by itself such as refetching the prep list, so a tablet showing
 * the list all shift still signs out when nobody is using it.
 *
 * The time of the last interaction is kept in localStorage next to the name
 * of the person it belongs to, so every tab of this tablet agrees, and so a
 * tablet that slept past the limit, or was reloaded after it, signs out as
 * soon as it wakes rather than showing the last person's screen. A record
 * that belongs to someone else (or to nobody) is never held against whoever
 * is signed in now.
 */

const KEY = 'mise.lastActivity';

/** What counts as someone being there. Not pointermove or scroll: a tablet can move on its own. */
const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/** Writing storage on every wheel tick would be wasteful; a second is plenty. */
const WRITE_EVERY_MS = 1_000;

function readRecord(userId: string): number | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { userId: owner, at } = parsed as { userId?: unknown; at?: unknown };
    return owner === userId && typeof at === 'number' && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

function writeRecord(userId: string, at: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, at }));
  } catch {
    // Storage blocked: this tab still counts its own time.
  }
}

/** Forget when anyone last touched the tablet, such as when they sign out. */
export function clearActivity(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

export interface IdleWatch {
  /** Count right now as interaction, such as "tap to stay". */
  stay(): void;
  stop(): void;
}

export interface IdleOptions {
  userId: string;
  /** Sign out after this long untouched. */
  limitMs: number;
  /** Warn this long before signing out. */
  warnMs: number;
  /** Seconds left before signing out, or null when the warning is gone. */
  onWarning(secondsLeft: number | null): void;
  /** Time is up. Called once. */
  onExpire(): void;
}

/**
 * Watch for interaction and call back as the limit nears and passes. Nothing
 * to do with React, so it can be tested with fake timers.
 */
export function watchIdle({
  userId,
  limitMs,
  warnMs,
  onWarning,
  onExpire,
}: IdleOptions): IdleWatch {
  // Where this tab last saw interaction. A record from before this page
  // opened counts: that is how a tablet that slept, or was reloaded, knows.
  let own = readRecord(userId) ?? Date.now();
  let lastWritten = 0;
  let timer: number | undefined;
  let done = false;

  if (readRecord(userId) === null) writeRecord(userId, own);

  const lastSeen = () => Math.max(own, readRecord(userId) ?? 0);

  function check(): void {
    if (done) return;
    window.clearTimeout(timer);
    // A clock set back is no reason to wait longer than the limit.
    const idle = Math.min(Math.max(0, Date.now() - lastSeen()), limitMs + warnMs);
    if (idle >= limitMs) {
      done = true;
      onWarning(null);
      onExpire();
      return;
    }
    if (idle >= limitMs - warnMs) {
      onWarning(Math.ceil((limitMs - idle) / 1000));
      timer = window.setTimeout(check, 1_000);
      return;
    }
    onWarning(null);
    timer = window.setTimeout(check, limitMs - warnMs - idle);
  }

  function touched(): void {
    if (done) return;
    const now = Date.now();
    own = now;
    if (now - lastWritten >= WRITE_EVERY_MS || now < lastWritten) {
      lastWritten = now;
      writeRecord(userId, now);
    }
    check();
  }

  // Woken, brought back to the front, or another tab was used: look at once,
  // before a timer that may have been asleep gets its turn.
  const onVisible = () => {
    if (document.visibilityState === 'visible') check();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) check();
  };

  for (const name of EVENTS) {
    window.addEventListener(name, touched, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', check);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  window.addEventListener('storage', onStorage);
  check();

  return {
    stay() {
      lastWritten = 0;
      touched();
    },
    stop() {
      done = true;
      window.clearTimeout(timer);
      for (const name of EVENTS) window.removeEventListener(name, touched, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      window.removeEventListener('storage', onStorage);
    },
  };
}
