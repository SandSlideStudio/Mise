import { useT } from '../i18n/index.js';
import { SOURCE_URL, VERSION } from '../version.js';

/** Which Mise this is, and where its code lives. */
export function AboutLine({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <p className={`text-ink-faint font-mono text-xs ${className}`}>
      Mise {VERSION} ·{' '}
      <a
        href={SOURCE_URL}
        target="_blank"
        rel="noreferrer"
        className="hover:text-ink underline underline-offset-4"
      >
        {t('shell.sourceCode')}
      </a>
    </p>
  );
}
