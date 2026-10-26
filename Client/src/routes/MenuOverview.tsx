import { useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  LANGUAGES,
  type DishCardTheme,
  type Language,
  type MenuOverview as Overview,
} from '@mise/contracts';
import { RequestFailed } from '../api/client.js';
import { useMenuOverview } from '../api/menus.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell } from '../components/AppShell.js';
import { DishCardSheet } from '../components/DishCardSheet.js';
import { PrintSheets, saveFile, usePrinting } from '../components/PrintSheets.js';
import { createTranslator, errorMessage, LANGUAGE_NAMES, useT } from '../i18n/index.js';
import { loadCardFonts } from '../lib/dishcard/fonts.js';
import type { CardPage } from '../lib/dishcard/layout.js';
import { layoutMenuOverview } from '../lib/dishcard/menuLayout.js';
import { renderDishCardPdf } from '../lib/dishcard/pdf.js';

/**
 * A menu's allergen overview: preview, print, download, in any language and
 * in day or night colours, the same as a dish card.
 */
export function MenuOverviewPage() {
  const { menuId } = useParams({ from: '/menus/$menuId/overview' });
  const translator = useT();
  const { t } = translator;
  const overview = useMenuOverview(menuId);

  let failure: string | null = null;
  if (overview.isError) {
    const error = overview.error;
    failure =
      error instanceof RequestFailed && error.status === 403
        ? t('card.noAccess')
        : errorMessage(translator, error);
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/menus/$menuId"
          params={{ menuId }}
          className="no-print eyebrow hover:text-ink mb-4 inline-block"
        >
          {t('menus.backToMenu')}
        </Link>
        {overview.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {failure ? <p className="text-danger">{failure}</p> : null}
        {overview.data ? <OverviewView overview={overview.data} /> : null}
      </main>
    </AppShell>
  );
}

function OverviewView({ overview }: { overview: Overview }) {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const kitchenLanguage = user?.kitchenLanguage ?? 'en';
  const [language, setLanguage] = useState<Language>(kitchenLanguage);
  const [theme, setTheme] = useState<DishCardTheme>(overview.settings.theme);
  const [printing, print] = usePrinting();
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [printedAt] = useState(() => new Date());

  const fonts = useQuery({ queryKey: ['card-fonts'], queryFn: loadCardFonts, staleTime: Infinity });
  const pages = useMemo<CardPage[] | null>(
    () =>
      fonts.data
        ? layoutMenuOverview(overview, fonts.data, { language, kitchenLanguage, theme, printedAt })
        : null,
    [overview, fonts.data, language, kitchenLanguage, theme, printedAt],
  );
  const cardT = createTranslator(language).t;
  const title = `${overview.menu.name} – ${cardT('menus.overviewTitle')}`;

  async function download() {
    if (!pages || !fonts.data) return;
    setDownloading(true);
    setFailed(false);
    try {
      saveFile(await renderDishCardPdf(pages, fonts.data, { title, language }), `${title}.pdf`);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-none sm:text-[36px]">{overview.menu.name}</h1>
          <p className="text-ink-soft mt-1">{t('menus.overviewTitle')}</p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">{t('card.language')}</span>
          <select
            className="field min-h-11"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="eyebrow mb-1">{t('card.theme')}</legend>
          <div className="flex gap-1.5">
            {(['day', 'night'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
                className="toggle min-h-11"
              >
                {value === 'day' ? t('card.themeDay') : t('card.themeNight')}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2.5">
          <button type="button" className="btn-quiet min-h-11" disabled={!pages} onClick={print}>
            {t('card.print')}
          </button>
          <button
            type="button"
            className="btn-primary min-h-11"
            disabled={!pages || downloading}
            onClick={() => void download()}
          >
            {downloading ? t('card.downloading') : t('card.download')}
          </button>
        </div>
      </div>

      {failed ? (
        <p role="alert" className="no-print text-danger">
          {t('card.downloadFailed')}
        </p>
      ) : null}
      {overview.dishes.length === 0 ? (
        <p className="no-print text-ink-soft">{t('menus.noDishes')}</p>
      ) : null}
      {!pages && !fonts.isError ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
      {fonts.isError ? <p className="text-danger">{t('common.loadFailed')}</p> : null}

      {pages ? (
        <div className="no-print flex flex-col gap-6">
          {pages.map((page, index) => (
            <div key={index} className="border-line border shadow-sm">
              <DishCardSheet page={page} label={`${title} · ${index + 1}/${pages.length}`} />
            </div>
          ))}
        </div>
      ) : null}

      {pages && printing ? <PrintSheets pages={pages} title={title} /> : null}
    </div>
  );
}
