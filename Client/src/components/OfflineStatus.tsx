import { useQueryClient } from '@tanstack/react-query';
import { dismissDropped, keepMine, keepTheirs, useDroppedChanges } from '../api/outbox.js';
import { useCurrentUser } from '../api/session.js';
import { useConnectivity } from '../lib/connectivity.js';
import { useOutbox, type OutboxEntry } from '../lib/outbox.js';
import { clockTime, errorMessage, useT, type MessageKey, type Translator } from '../i18n/index.js';

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
  const pending = waiting.filter((entry) => !entry.conflict).length;

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
                {t('offline.dropped', {
                  what: labelOf(translator, entry),
                  reason: errorMessage(translator, error),
                })}
              </li>
            ))}
          </ul>
          <button type="button" className="btn-small" onClick={dismissDropped}>
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}

      {conflict ? <ConflictDialog entry={conflict} /> : null}
    </div>
  );
}

function labelOf(translator: Translator, entry: OutboxEntry): string {
  return translator.t(entry.label.key as MessageKey, entry.label.vars ?? {});
}

/** Field names people know, for the side-by-side view. Anything else is spelled out. */
const FIELD_NAMES: Record<string, MessageKey> = {
  name: 'common.name',
  text: 'offline.field.note',
  notes: 'offline.field.notes',
  method: 'offline.field.method',
  description: 'offline.field.description',
  tags: 'offline.field.tags',
  components: 'offline.field.components',
  dishes: 'offline.field.dishes',
};

function fieldName(translator: Translator, key: string): string {
  const known = FIELD_NAMES[key];
  if (known) return translator.t(known);
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as one readable line: lists by their names, things by their name. */
function show(translator: Translator, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    const names = value.map((item) =>
      item && typeof item === 'object'
        ? String(
            (item as Record<string, unknown>).name ??
              (item as Record<string, unknown>).componentName ??
              (item as Record<string, unknown>).description ??
              '…',
          )
        : String(item),
    );
    return names.every((name) => name === '…')
      ? translator.plural('offline.items', value.length)
      : names.join(', ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record && 'unit' in record)
      return `${String(record.value)} ${String(record.unit)}`;
    if ('name' in record) return String(record.name);
  }
  return JSON.stringify(value).slice(0, 120);
}

/**
 * Both versions, field by field, for what this person changed. Only the
 * fields that now differ are shown: the rest agree, whichever is kept.
 */
function ConflictDialog({ entry }: { entry: OutboxEntry }) {
  const translator = useT();
  const { t } = translator;
  const queryClient = useQueryClient();
  const mine = (entry.body ?? {}) as Record<string, unknown>;
  const current = (entry.conflict?.current ?? {}) as Record<string, unknown>;
  const fields = Object.keys(mine).filter(
    (key) => show(translator, mine[key]) !== show(translator, current[key]),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="bg-surface-raised border-line max-h-[90dvh] w-full max-w-2xl overflow-y-auto border-2 p-5 sm:p-6">
        <h2 id="conflict-title" className="text-2xl">
          {t('offline.conflictTitle')}
        </h2>
        <p className="text-ink-soft mt-1.5">
          {t('offline.conflictBody', { what: labelOf(translator, entry) })}
        </p>

        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3">
          <p className="eyebrow">{t('offline.yours')}</p>
          <p className="eyebrow">{t('offline.theirs')}</p>
          {(fields.length ? fields : Object.keys(mine)).map((key) => (
            <div key={key} className="border-line col-span-2 grid grid-cols-subgrid border-t pt-3">
              <p className="text-ink-faint col-span-2 mb-1 text-xs tracking-[0.12em] uppercase">
                {fieldName(translator, key)}
              </p>
              <p className="whitespace-pre-wrap break-words">{show(translator, mine[key])}</p>
              <p className="whitespace-pre-wrap break-words">{show(translator, current[key])}</p>
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
        </div>
      </div>
    </div>
  );
}
