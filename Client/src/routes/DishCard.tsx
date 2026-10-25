import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { LANGUAGES, type DishCard, type DishCardTheme, type Language } from '@mise/contracts';
import { RequestFailed } from '../api/client.js';
import { useDishCard } from '../api/dishcards.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell } from '../components/AppShell.js';
import { DishCardSheet } from '../components/DishCardSheet.js';
import { createTranslator, errorMessage, LANGUAGE_NAMES, useT } from '../i18n/index.js';
import { loadCardFonts } from '../lib/dishcard/fonts.js';
import { layoutDishCard, type CardPage } from '../lib/dishcard/layout.js';
import { renderDishCardPdf } from '../lib/dishcard/pdf.js';

/**
 * A dish card: preview, print, download.
 *
 * The card speaks whichever language is chosen here, not the screen's, so a
 * Dutch kitchen can hand an English card to a server who reads English. Day
 * or night starts at the kitchen's choice and can be turned for one print.
 */
export function DishCardPage() {
  const { recipeId } = useParams({ from: '/recipes/$recipeId/card' });
  const translator = useT();
  const { t } = translator;
  const card = useDishCard(recipeId);

  return (
    <AppShell>
      <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
        <Link
          to="/recipes/$recipeId"
          params={{ recipeId }}
          className="no-print eyebrow hover:text-ink mb-4 inline-block"
        >
          {t('card.back')}
        </Link>

        {card.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {card.isError ? <p className="text-danger">{failure(translator, card.error)}</p> : null}
        {card.data ? <CardView card={card.data} /> : null}
      </main>
    </AppShell>
  );
}

function failure(translator: ReturnType<typeof useT>, error: unknown): string {
  if (error instanceof RequestFailed) {
    if (error.status === 400) return translator.t('card.notADish');
    if (error.status === 403) return translator.t('card.noAccess');
    if (error.code === 'card_unavailable') return translator.t('card.unavailable');
  }
  return errorMessage(translator, error);
}

function CardView({ card }: { card: DishCard }) {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const kitchenLanguage = user?.kitchenLanguage ?? 'en';
  const [language, setLanguage] = useState<Language>(kitchenLanguage);
  const [theme, setTheme] = useState<DishCardTheme>(card.settings.theme);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const [printing, setPrinting] = useState(false);

  const fonts = useQuery({ queryKey: ['card-fonts'], queryFn: loadCardFonts, staleTime: Infinity });
  const [printedAt] = useState(() => new Date());
  const pages = useMemo<CardPage[] | null>(
    () =>
      fonts.data
        ? layoutDishCard(card, fonts.data, { language, kitchenLanguage, theme, printedAt })
        : null,
    [card, fonts.data, language, kitchenLanguage, theme, printedAt],
  );
  const cardT = createTranslator(language).t;
  const title = `${cardT('card.title')} – ${card.dish.name}`;

  // The printout is the card and nothing else, on landscape sheets with no margin.
  useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 landscape; margin: 0; }';
    document.head.append(style);
    root.classList.add('printing-card');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      root.classList.remove('printing-card');
      style.remove();
    };
  }, [printing]);

  async function download() {
    if (!pages || !fonts.data) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const blob = await renderDishCardPdf(pages, fonts.data, { title, language });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${cardT('card.title')} - ${card.dish.name}.pdf`.replace(/[\\/:*?"<>|]/g, '');
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  const attention = [
    card.attention.veganUnknown.length > 0
      ? t('card.attentionVegan', { names: card.attention.veganUnknown.join(', ') })
      : null,
    card.attention.missingDetails.length > 0
      ? t('card.attentionDetails', { names: card.attention.missingDetails.join(', ') })
      : null,
    card.dish.photoUrl ? null : t('card.attentionPhoto'),
    card.dish.status === 'draft' ? t('card.attentionDraft') : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className="flex flex-col gap-5">
      <div className="no-print flex flex-wrap items-end gap-x-5 gap-y-3">
        <div className="mr-auto">
          <h1 className="text-[32px] leading-none sm:text-[36px]">{card.dish.name}</h1>
          <p className="text-ink-soft mt-1">{t('card.title')}</p>
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
          <button
            type="button"
            className="btn-quiet min-h-11"
            disabled={!pages}
            onClick={() => setPrinting(true)}
          >
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

      {downloadFailed ? (
        <p role="alert" className="no-print text-danger">
          {t('card.downloadFailed')}
        </p>
      ) : null}

      {attention.length > 0 ? (
        <div className="no-print border-accent bg-accent-wash border-l-4 px-4 py-3">
          <p className="font-display text-lg font-semibold tracking-[0.1em] uppercase">
            {t('card.attentionTitle')}
          </p>
          <ul className="mt-1 flex flex-col gap-1 text-[15px]">
            {attention.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {card.attention.veganUnknown.length + card.attention.missingDetails.length > 0 ? (
            <Link to="/ingredients" className="text-accent mt-2 inline-block underline">
              {t('card.fixIngredients')}
            </Link>
          ) : null}
        </div>
      ) : null}

      {fonts.isError ? <p className="text-danger">{t('common.loadFailed')}</p> : null}
      {!pages && !fonts.isError ? <p className="text-ink-soft">{t('common.loading')}</p> : null}

      {pages ? (
        <div className="no-print flex flex-col gap-6">
          {pages.map((page, index) => (
            <div key={index} className="border-line border shadow-sm">
              <DishCardSheet page={page} label={`${title} · ${index + 1}/2`} />
            </div>
          ))}
        </div>
      ) : null}

      {pages && printing
        ? createPortal(
            <div className="print-card">
              {pages.map((page, index) => (
                <div key={index} className="print-card-page">
                  <DishCardSheet page={page} label={`${title} · ${index + 1}/2`} />
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
