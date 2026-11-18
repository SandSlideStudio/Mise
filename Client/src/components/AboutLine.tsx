import { useT } from '../i18n/index.js';
import { SOURCE_URL, VERSION } from '../version.js';

const link = 'hover:text-ink inline-flex min-h-11 items-center underline underline-offset-4';

/** Which Mise this is, where its code lives, and whose work it is built on. */
export function AboutLine({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <p className={`text-ink-faint font-mono text-xs ${className}`}>
      Mise {VERSION} ·{' '}
      <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={link}>
        GitHub
      </a>{' '}
      · {/* Written by scripts/licenses.mjs and copied into the build by vite.config.ts. */}
      <a href="/THIRD-PARTY-NOTICES.txt" target="_blank" rel="noreferrer" className={link}>
        {t('about.licences')}
      </a>
    </p>
  );
}
