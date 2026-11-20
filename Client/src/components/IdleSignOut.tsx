import { BottomNotice } from './BottomNotice.js';
import { useEffect, useRef, useState } from 'react';
import type { SessionUser } from '@mise/contracts';
import { useKitchen } from '../api/kitchen.js';
import { useActivityPing, useLogout } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { watchIdle, type IdleWatch } from '../lib/idle.js';

/** How long the warning shows before the tablet signs out. */
export const WARN_MS = 30_000;
/** If signing out fails (the server answered with an error), try again after this. */
const RETRY_MS = 30_000;

/**
 * Signs a person out of an enrolled shared tablet that has been left alone,
 * as long as the kitchen has chosen a time for it (Settings, Kitchen).
 *
 * Only tablets: a phone or a laptop signed in with a password is the
 * person's own, and the session cookie is the only thing on it.
 */
export function IdleSignOut({ user }: { user: SessionUser }) {
  if (!user.onTablet) return null;
  return <Watching user={user} />;
}

function Watching({ user }: { user: SessionUser }) {
  const { t } = useT();
  const kitchen = useKitchen();
  const minutes = kitchen.data?.idleSignOutMinutes ?? null;
  const logout = useLogout();
  // The mutation object is new on every render; only its method is needed.
  const signOut = useRef(logout.mutate);
  signOut.current = logout.mutate;
  // The server signs out a tablet it hasn't heard from, so a touch tells it.
  const ping = useActivityPing();

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [ending, setEnding] = useState(false);
  // Bumped to start watching again after a sign-out that failed.
  const [attempt, setAttempt] = useState(0);
  const watch = useRef<IdleWatch | null>(null);

  useEffect(() => {
    if (minutes === null) {
      setSecondsLeft(null);
      return;
    }
    let retry: number | undefined;
    const limitMs = minutes * 60_000;
    watch.current = watchIdle({
      userId: user.id,
      limitMs,
      warnMs: Math.min(WARN_MS, limitMs / 2),
      onWarning: setSecondsLeft,
      onActive: ping,
      onExpire: () => {
        // Cover the screen first: whatever was open must not show while the
        // sign-out goes through.
        setEnding(true);
        signOut.current(undefined, {
          onError: () => {
            setEnding(false);
            retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
          },
        });
      },
    });
    return () => {
      watch.current?.stop();
      watch.current = null;
      window.clearTimeout(retry);
    };
  }, [minutes, user.id, attempt, ping]);

  if (ending) {
    return (
      <div
        role="status"
        className="bg-surface text-ink-soft fixed inset-0 z-50 flex items-center justify-center text-xl"
      >
        {t('idle.signingOut')}
      </div>
    );
  }
  if (secondsLeft === null) return null;

  return (
    <BottomNotice>
      <div className="border-accent bg-accent-wash flex max-w-xl flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 shadow-sm sm:px-5">
        {/* The count itself would be read out every second, so it is only drawn. */}
        <p role="status" className="sr-only">
          {t('idle.warningSr')}
        </p>
        <p aria-hidden="true" className="text-lg">
          {t('idle.warning', { seconds: String(secondsLeft) })}
        </p>
        <button
          type="button"
          className="btn-primary min-h-11"
          onClick={() => watch.current?.stay()}
        >
          {t('idle.stay')}
        </button>
      </div>
    </BottomNotice>
  );
}
