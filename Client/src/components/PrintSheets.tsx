import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardPage } from '../lib/dishcard/layout.js';
import { DishCardSheet } from './DishCardSheet.js';

/**
 * Printing landscape sheets: a dish card, a menu's allergen overview.
 *
 * While printing, the page holds only the sheets, on A4 landscape with no
 * margin, and the rest of the app is hidden from the printout.
 */
export function usePrinting(): [printing: boolean, print: () => void] {
  const [printing, setPrinting] = useState(false);

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

  return [printing, () => setPrinting(true)];
}

/** The sheets as they go to the printer. Drawn only while printing. */
export function PrintSheets({ pages, title }: { pages: CardPage[]; title: string }) {
  return createPortal(
    <div className="print-card">
      {pages.map((page, index) => (
        <div key={index} className="print-card-page">
          <DishCardSheet page={page} label={`${title} · ${index + 1}/${pages.length}`} />
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** Hand a finished PDF to the browser to save. */
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, '');
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
