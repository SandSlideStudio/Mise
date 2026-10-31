import { beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { sampleCard, sampleOverview, testFonts } from '../../test/cards.js';
import type { CardFonts } from './fonts.js';
import { layoutDishCard } from './layout.js';
import { layoutMenuOverview } from './menuLayout.js';
import { renderDishCardPdf } from './pdf.js';

let fonts: CardFonts;
beforeAll(async () => {
  fonts = await testFonts();
});

const printedAt = new Date('2026-10-31T12:00:00Z');
const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

async function open(blob: Blob) {
  return PDFDocument.load(new Uint8Array(await blob.arrayBuffer()), { updateMetadata: false });
}

describe('the PDF of a dish card', () => {
  for (const language of ['en', 'nl', 'de'] as const) {
    it(`is two A4 landscape pages with its title and language (${language})`, async () => {
      const pages = layoutDishCard(sampleCard(), fonts, {
        language,
        kitchenLanguage: 'en',
        theme: 'night',
        printedAt,
      });
      const pdf = await open(
        await renderDishCardPdf(pages, fonts, { title: 'Pear tart', language }),
      );
      expect(pdf.getPageCount()).toBe(2);
      for (const page of pdf.getPages()) {
        expect(page.getWidth()).toBeCloseTo(A4_LANDSCAPE.width, 0);
        expect(page.getHeight()).toBeCloseTo(A4_LANDSCAPE.height, 0);
      }
      expect(pdf.getTitle()).toBe('Pear tart');
      expect(pdf.getCreator()).toBe('Mise');
    });
  }

  it('sets a dish with letters outside plain Latin', async () => {
    const card = sampleCard();
    card.dish.name = 'Żurek, łosoś, Größe, crème brûlée';
    const pages = layoutDishCard(card, fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    const pdf = await open(
      await renderDishCardPdf(pages, fonts, { title: card.dish.name, language: 'en' }),
    );
    expect(pdf.getPageCount()).toBe(2);
  });
});

describe('the PDF of a menu overview', () => {
  it('has as many pages as the layout', async () => {
    const pages = layoutMenuOverview(sampleOverview(48), fonts, {
      language: 'en',
      kitchenLanguage: 'en',
      theme: 'day',
      printedAt,
    });
    const pdf = await open(
      await renderDishCardPdf(pages, fonts, { title: 'Long menu', language: 'en' }),
    );
    expect(pdf.getPageCount()).toBe(pages.length);
    expect(pages.length).toBeGreaterThan(1);
  });
});
