import { useT } from '../i18n/index.js';

/** Shown instead of a list that failed to load, so it never looks empty. */
export function LoadError({
  onRetry,
  className = '',
}: {
  onRetry: () => void;
  className?: string;
}) {
  const { t } = useT();
  return (
    <div
      role="alert"
      className={`border-danger flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 ${className}`}
    >
      <p className="text-danger">{t('common.loadFailed')}</p>
      <button type="button" className="btn-small" onClick={onRetry}>
        {t('common.tryAgain')}
      </button>
    </div>
  );
}
