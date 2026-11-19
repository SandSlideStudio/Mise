import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useCurrentUser } from '../api/session.js';
import {
  AllergenNotice,
  NoticeSheet,
  usePrintNotice,
  type NoticeSize,
} from '../components/AllergenNotice.js';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { LANGUAGE_NAMES, useT } from '../i18n/index.js';

/**
 * The notice for guests, to print and put up: in the kitchen's language, and
 * in English when that is another. For chefs and cooks alike, since whoever
 * opens up may find the old one gone.
 */
export function AllergenNoticePage() {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const [size, setSize] = useState<NoticeSize>('A4');
  const [printing, print] = usePrintNotice(size);

  if (!user) return null;
  const language = user.kitchenLanguage;
  // Each named in itself, as the notice is written.
  const languages =
    language === 'en' ? LANGUAGE_NAMES.en : `${LANGUAGE_NAMES[language]} · ${LANGUAGE_NAMES.en}`;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/dishes" className="eyebrow hover:text-ink mb-4 inline-block">
          ← {t('nav.dishes')}
        </Link>
        <PageHeader title={t('notice.title')} description={t('notice.explain')} />

        <div className="mb-6 flex flex-wrap items-end gap-x-5 gap-y-3">
          <fieldset className="flex flex-col gap-1">
            <legend className="eyebrow mb-1">{t('notice.paper')}</legend>
            <div className="flex gap-1.5">
              {(['A4', 'A5'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={size === value}
                  onClick={() => setSize(value)}
                  className="toggle min-h-11"
                >
                  {value}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mr-auto flex flex-col gap-1">
            <span className="eyebrow">{t('notice.languages')}</span>
            <span className="flex min-h-11 items-center">{languages}</span>
          </div>
          <button type="button" className="btn-primary min-h-11" onClick={print}>
            {t('card.print')}
          </button>
        </div>

        <div className="border-line mx-auto max-w-[460px] border shadow-sm">
          <AllergenNotice kitchenName={user.kitchenName} language={language} />
        </div>

        {printing ? (
          <NoticeSheet size={size} kitchenName={user.kitchenName} language={language} />
        ) : null}
      </main>
    </AppShell>
  );
}
