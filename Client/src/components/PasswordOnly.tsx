import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useCurrentUser } from '../api/session.js';
import { useT, type MessageKey } from '../i18n/index.js';

/**
 * Something that touches security: backups, staff accounts, devices, how
 * Mise is reached. Signed in with a PIN, it stays in view but greyed out,
 * with a note saying the password is needed for it. Everything else a PIN
 * can do as before. The server refuses these too; this only says so first.
 */
export function PasswordOnly({ note, children }: { note: MessageKey; children: ReactNode }) {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  if (!user?.onTablet) return <>{children}</>;

  return (
    <div>
      <div className="relative mb-5 inline-block max-w-[60ch]">
        <p
          role="note"
          className="bg-surface-raised border-accent border-2 px-4 py-2.5 text-[15px] text-pretty"
        >
          {t(note)}{' '}
          <Link to="/login" className="text-accent font-medium underline underline-offset-4">
            {t('passwordOnly.signIn')}
          </Link>
        </p>
        {/* The little tail that makes it a speech bubble, pointing at what's greyed out. */}
        <span
          aria-hidden
          className="border-accent bg-surface-raised absolute -bottom-[7px] left-6 h-3 w-3 rotate-45 border-r-2 border-b-2"
        />
      </div>
      <fieldset disabled aria-disabled className="pointer-events-none opacity-45 select-none">
        {children}
      </fieldset>
    </div>
  );
}
