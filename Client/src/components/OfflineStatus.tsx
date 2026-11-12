import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  discardSetAside,
  dismissDropped,
  keepMine,
  keepTheirs,
  retrySetAside,
  useDroppedChanges,
} from '../api/outbox.js';
import { useCurrentUser } from '../api/session.js';
import { useConnectivity } from '../lib/connectivity.js';
import { goingOut, useOutbox, type OutboxEntry } from '../lib/outbox.js';
import { clockTime, errorMessage, useT, type MessageKey, type Translator } from '../i18n/index.js';
import { fieldName, namingFrom, showValue } from './conflictValues.js';

/**
 * Says plainly when Mise can't be reached, what is being shown meanwhile, and
 * what is waiting to be sent; and asks, when someone else changed the same
 * thing, which version to keep.
 */
export function OfflineStatus() {
  const translator = useT();
  const { t, plural, locale } = translator;
  const { data: user } = useCurrentUser();
  const { reachable, since } = useConnectivity();
  const waiting = useOutbox(user?.id);
  const dropped = useDroppedChanges();
  const conflict = waiting.find((entry) => entry.conflict);
  const setAside = waiting.filter((entry) => entry.setAside && !entry.conflict);
  const pending = goingOut(waiting).filter((entry) => !entry.conflict).length;
  const queryClient = useQueryClient();
  // Put off with Escape: the choice waits in the notice instead of on top of everything.
  const [later, setLater] = useState<string | null>(null);

  if (reachable && waiting.length === 0 && dropped.length === 0) return null;

  return (
    <div className="no-print mx-4 mt-4 flex flex-col gap-3 sm:mx-7">
      {!reachable ? (
        <p
          role="status"
          className="border-accent bg-accent-wash border-2 px-4 py-3 text-lg sm:px-5"
        >
          <span className="font-display font-semibold tracking-[0.04em]">{t('offline.title')}</span>{' '}
          {t('offline.body', { time: clockTime(locale, new Date(since).toISOString()) })}
          {pending > 0 ? ` ${plural('offline.waiting', pending)}` : ''}
        </p>
      ) : pending > 0 ? (
        <p role="status" className="border-accent border-2 px-4 py-3 text-lg sm:px-5">
          {plural('offline.sending', pending)}
        </p>
      ) : null}

      {dropped.length > 0 ? (
        <div
          role="alert"
          className="border-danger flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 sm:px-5"
        >
          <ul className="text-danger flex flex-col gap-1 text-lg">
            {dropped.map(({ entry, error }) => (
              <li key={entry.id}>
                {sentence(
                  t('offline.dropped', {
                    what: labelOf(translator, entry),
                    reason: errorMessage(translator, error),
                  }),
                  locale,
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-small" onClick={dismissDropped}>
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}

      {setAside.length > 0 ? (
        <div role="alert" className="border-danger flex flex-col gap-2 border-2 px-4 py-3 sm:px-5">
          {setAside.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-danger text-lg">
                {sentence(t('offline.setAside', { what: labelOf(translator, entry) }), locale)}
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-small" onClick={() => retrySetAside(entry)}>
                  {t('offline.tryAgain')}
                </button>
                <button
                  type="button"
                  className="btn-small"
                  onClick={() => discardSetAside(entry, queryClient)}
                >
                  {t('offline.letGo')}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {conflict && conflict.id === later ? (
        <div
          role="status"
          className="border-accent flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 sm:px-5"
        >
          <p className="text-lg">
            {sentence(
              t('offline.conflictWaiting', { what: labelOf(translator, conflict) }),
              locale,
            )}
          </p>
          <button type="button" className="btn-small" onClick={() => setLater(null)}>
            {t('offline.choose')}
          </button>
        </div>
      ) : conflict ? (
        <ConflictDialog entry={conflict} onLater={() => setLater(conflict.id)} />
      ) : null}
    </div>
  );
}

/** "the recipe …" opens a sentence here: "The recipe …". */
function sentence(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function labelOf(translator: Translator, entry: OutboxEntry): string {
  return translator.t(entry.label.key as MessageKey, entry.label.vars ?? {});
}

/**
 * Both versions, field by field, for what this person changed. Only the
 * fields that now differ are shown: the rest agree, whichever is kept.
 */
function ConflictDialog({ entry, onLater }: { entry: OutboxEntry; onLater: () => void }) {
  const translator = useT();
  const { t } = translator;
  const queryClient = useQueryClient();
  const mine = (entry.body ?? {}) as Record<string, unknown>;
  const current = (entry.conflict?.current ?? {}) as Record<string, unknown>;
  const kind = entry.path.split('/')[1] ?? '';
  const naming = namingFrom(queryClient);
  const show = (key: string, value: unknown) => showValue(translator, kind, key, value, naming);
  const fields = Object.keys(mine).filter(
    (key) => show(key, mine[key]) !== show(key, current[key]),
  );
  const box = useRef<HTMLDivElement>(null);

  // Into the dialog when it opens, and back where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('h2')?.focus();
    return () => before?.focus?.();
  }, [entry.id]);

  // Escape puts the choice off; Tab stays inside, as nothing behind can be used.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onLater();
      return;
    }
    if (event.key !== 'Tab' || !box.current) return;
    const focusable = [...box.current.querySelectorAll<HTMLElement>('button, [tabindex="-1"]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-body"
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div
        ref={box}
        className="bg-surface-raised border-line max-h-[90dvh] w-full max-w-2xl overflow-y-auto border-2 p-5 sm:p-6"
      >
        <h2 id="conflict-title" tabIndex={-1} className="text-2xl outline-none">
          {t('offline.conflictTitle')}
        </h2>
        <p id="conflict-body" className="text-ink-soft mt-1.5">
          {t('offline.conflictBody', { what: labelOf(translator, entry) })}
        </p>

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
          <p className="eyebrow">{t('offline.yours')}</p>
          <p className="eyebrow">{t('offline.theirs')}</p>
          {(fields.length ? fields : Object.keys(mine)).map((key) => (
            <div key={key} className="border-line col-span-2 grid grid-cols-subgrid border-t pt-3">
              <p className="text-ink-faint col-span-2 mb-1 text-xs">{fieldName(translator, key)}</p>
              <p className="whitespace-pre-wrap break-words">{show(key, mine[key])}</p>
              <p className="whitespace-pre-wrap break-words">{show(key, current[key])}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="btn-primary" onClick={() => keepMine(entry)}>
            {t('offline.keepMine')}
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => keepTheirs(entry, queryClient)}
          >
            {t('offline.keepTheirs')}
          </button>
          <button type="button" className="btn-quiet" onClick={onLater}>
            {t('offline.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
