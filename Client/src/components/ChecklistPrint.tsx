import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChecklistItem, Station } from '@mise/contracts';
import { formatQuantity, unit } from '@mise/domain';
import { groupChecklist } from '../api/checklist.js';
import { useT } from '../i18n/index.js';

/**
 * The checklist on paper, for kitchens that tick on paper: a box and a name
 * per line, by station, with the kitchen and the day. A line with a par says
 * it, with a space to write how much is there, so the sheet is also the
 * morning count. The same look as the printed prep list, so as little ink as
 * it can be.
 */
export function ChecklistPrint({
  kitchenName,
  items,
  stations,
  date = new Date(),
}: {
  kitchenName: string;
  items: ChecklistItem[];
  stations: Station[];
  date?: Date;
}) {
  const { t, locale } = useT();
  const groups = groupChecklist(items, stations);
  const day = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <article className="text-black">
      <header className="flex items-baseline justify-between gap-6 border-b-[0.5px] border-black pb-2">
        <h1 className="text-[18pt] font-medium">{t('checklistPrint.title')}</h1>
        <p className="text-[9.5pt]">
          {kitchenName} · {day}
        </p>
      </header>

      {groups.length === 0 ? <p className="mt-6 text-[12pt]">{t('checklistPrint.empty')}</p> : null}

      {groups.map(({ station, items: lines }) => (
        <section key={station?.id ?? 'anywhere'} className="keep-together">
          <h2 className="font-display mt-[5.5mm] mb-1 text-[10pt] font-medium tracking-[0.14em] uppercase">
            {station?.name ?? t('common.anywhere')}
          </h2>
          {lines.map((item) => (
            <p key={item.id} className="flex items-center gap-[3.5mm] py-[1.6mm] text-[12.5pt]">
              <span
                aria-hidden
                className="h-[4.6mm] w-[4.6mm] shrink-0 border-[0.6px] border-black"
              />
              <span className="min-w-0 flex-1">{item.name}</span>
              {item.par ? (
                <>
                  <span className="text-[10pt]">
                    {t('checklistPrint.par', { amount: formatQuantity(item.par) })}
                  </span>
                  <span className="flex items-end gap-[1.5mm] text-[10pt]">
                    {t('checklistPrint.there')}
                    <span
                      data-there
                      aria-hidden
                      className="h-[6mm] w-[18mm] border-[0.6px] border-black"
                    />
                    {/* A bare count needs no unit, the same as on the screen. */}
                    {item.par.unit === 'each' ? '' : unit(item.par.unit).abbr}
                  </span>
                </>
              ) : null}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}

/**
 * Prints the checklist alone: the sheet is put straight under the page while
 * printing, and the rest of the app, the prep list's own printout included,
 * is hidden from the paper.
 */
export function usePrintChecklist(): [printing: boolean, print: () => void] {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const root = document.documentElement;
    root.classList.add('printing-checklist');
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    // After the sheet has been drawn.
    const timer = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
      root.classList.remove('printing-checklist');
    };
  }, [printing]);

  return [printing, () => setPrinting(true)];
}

export function ChecklistSheet(props: Parameters<typeof ChecklistPrint>[0]) {
  return createPortal(
    <div className="print-checklist">
      <ChecklistPrint {...props} />
    </div>,
    document.body,
  );
}
