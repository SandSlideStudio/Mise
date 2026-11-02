import { isStaleAppError, useUpdatedVersion } from '../lib/freshness.js';
import { useT } from '../i18n/index.js';

/** "Mise was updated": one tap to the new version. Shown on every page in the app. */
export function UpdatedBanner() {
  const { t } = useT();
  const version = useUpdatedVersion();
  if (!version) return null;
  return (
    <div
      role="status"
      className="no-print border-accent bg-accent-wash mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 sm:mx-7 sm:px-5"
    >
      <p className="text-lg">
        {version === 'new' ? t('updated.body') : t('updated.bodyVersion', { version })}
      </p>
      <button
        type="button"
        className="btn-primary min-h-11"
        onClick={() => window.location.reload()}
      >
        {t('updated.reload')}
      </button>
    </div>
  );
}

/**
 * A page that couldn't open. When its code is gone because Mise was updated,
 * a reload is the whole fix, so say that rather than show an error.
 */
export function RouteError({ error }: { error: unknown }) {
  const { t } = useT();
  const stale = isStaleAppError(error);
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 text-center">
      <h1 className="text-[32px]">{stale ? t('updated.title') : t('error.pageTitle')}</h1>
      <p className="text-ink-soft mt-2">{stale ? t('updated.body') : t('error.pageBody')}</p>
      <button type="button" className="btn-primary mt-6" onClick={() => window.location.reload()}>
        {t('updated.reload')}
      </button>
    </div>
  );
}
