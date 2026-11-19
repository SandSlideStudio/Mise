import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language } from '@mise/contracts';
import { createTranslator } from '../i18n/index.js';

/**
 * The notice that tells guests to ask about allergens.
 *
 * In the Netherlands a restaurant may tell guests about the allergens in a
 * dish by word of mouth, but only if a notice they can clearly see tells them
 * to ask. This is that notice: large, black on white, in the kitchen's own
 * language and in English beside it for guests from elsewhere.
 *
 * A4 and A5 have the same proportions, so the sheet is drawn once in units of
 * its own width and comes out the same on either, and in the preview.
 */

export type NoticeSize = 'A4' | 'A5';

// A hair short of the paper, so rounding never spills a blank second page.
const SHEET: Record<NoticeSize, { width: string; height: string }> = {
  A4: { width: '210mm', height: '296mm' },
  A5: { width: '148mm', height: '209mm' },
};

function NoticeText({
  language,
  main,
}: {
  language: Language;
  /** The kitchen's own language is the larger of the two. */
  main: boolean;
}) {
  const { t } = createTranslator(language);
  return (
    <div lang={language} className={main ? '' : 'border-t-[length:0.5cqw] border-black pt-[5cqw]'}>
      <h2
        className="font-display leading-[1.02] font-semibold text-balance"
        style={{ fontSize: main ? '10.5cqw' : '6.4cqw' }}
      >
        {t('notice.heading')}
      </h2>
      <p
        className="mt-[3cqw] leading-[1.25] text-pretty"
        style={{ fontSize: main ? '5.4cqw' : '3.6cqw' }}
      >
        {t('notice.body')}
      </p>
    </div>
  );
}

/** The sheet itself, as wide as whatever holds it. */
export function AllergenNotice({
  kitchenName,
  language,
}: {
  kitchenName: string;
  /** The kitchen's language; English is added when it is another. */
  language: Language;
}) {
  return (
    <article
      className="flex aspect-[210/297] w-full flex-col bg-white text-black [container-type:inline-size]"
      aria-label={createTranslator(language).t('notice.title')}
    >
      <div className="flex flex-1 flex-col justify-center gap-[9cqw] px-[11cqw] py-[12cqw]">
        <NoticeText language={language} main />
        {language !== 'en' ? <NoticeText language="en" main={false} /> : null}
      </div>
      <p
        className="font-display px-[11cqw] pb-[9cqw] font-medium tracking-[0.12em] uppercase"
        style={{ fontSize: '3.4cqw' }}
      >
        {kitchenName}
      </p>
    </article>
  );
}

/**
 * Prints the notice alone, on its own paper size with no margin; the rest of
 * the app is hidden from the paper while it prints.
 */
export function usePrintNotice(size: NoticeSize): [printing: boolean, print: () => void] {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    const style = document.createElement('style');
    style.textContent = `@page { size: ${size} portrait; margin: 0; }`;
    document.head.append(style);
    root.classList.add('printing-notice');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // After the sheet has been drawn.
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      root.classList.remove('printing-notice');
      style.remove();
    };
  }, [printing, size]);

  return [printing, () => setPrinting(true)];
}

/** The sheet as it goes to the printer, at the size of the paper. */
export function NoticeSheet({
  size,
  ...props
}: Parameters<typeof AllergenNotice>[0] & { size: NoticeSize }) {
  return createPortal(
    <div className="print-notice overflow-hidden" style={SHEET[size]}>
      <AllergenNotice {...props} />
    </div>,
    document.body,
  );
}
