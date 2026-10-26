import type { DishCard, DishCardTheme, Language } from '@mise/contracts';
import { api } from '../../api/client.js';
import { loadCardFonts } from './fonts.js';
import { layoutDishCard, type CardPage } from './layout.js';
import { renderDishCardPdf } from './pdf.js';

/**
 * Every dish card on a menu in one PDF, in menu order: the binder for a new
 * member of the floor staff, or the stack to brief from before a menu change.
 *
 * Loaded only when asked for, with the fonts and the PDF code.
 */
export async function renderMenuCards(options: {
  dishIds: string[];
  /** Printed on every card as the menu the dish is on. */
  menuName: string;
  title: string;
  language: Language;
  kitchenLanguage: Language;
  theme: DishCardTheme;
  onProgress: (done: number) => void;
}): Promise<Blob> {
  const fonts = await loadCardFonts();
  const printedAt = new Date();
  const pages: CardPage[] = [];
  for (const [index, id] of options.dishIds.entries()) {
    const card = await api.get<DishCard>(`/recipes/${id}/card`);
    const onThisMenu = { ...card, dish: { ...card.dish, menus: [options.menuName] } };
    pages.push(
      ...layoutDishCard(onThisMenu, fonts, {
        language: options.language,
        kitchenLanguage: options.kitchenLanguage,
        theme: options.theme,
        printedAt,
      }),
    );
    options.onProgress(index + 1);
  }
  return renderDishCardPdf(pages, fonts, { title: options.title, language: options.language });
}
