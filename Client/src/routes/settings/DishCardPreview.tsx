import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DishCardSettings, Language } from '@mise/contracts';
import { useDishCard } from '../../api/dishcards.js';
import { DishCardSheet } from '../../components/DishCardSheet.js';
import { useT } from '../../i18n/index.js';
import { loadCardFonts } from '../../lib/dishcard/fonts.js';
import { layoutDishCard } from '../../lib/dishcard/layout.js';

/**
 * One of the kitchen's own dishes, on a card drawn with the settings as they
 * stand in the form, so a change shows before it is saved.
 */
export function DishCardPreview({
  recipeId,
  settings,
  kitchenLanguage,
}: {
  recipeId: string;
  settings: DishCardSettings;
  kitchenLanguage: Language;
}) {
  const { t, language } = useT();
  const card = useDishCard(recipeId);
  const fonts = useQuery({ queryKey: ['card-fonts'], queryFn: loadCardFonts, staleTime: Infinity });
  const [printedAt] = useState(() => new Date());

  const pages = useMemo(
    () =>
      card.data && fonts.data
        ? layoutDishCard({ ...card.data, settings }, fonts.data, {
            language,
            kitchenLanguage,
            theme: settings.theme,
            printedAt,
          })
        : null,
    [card.data, fonts.data, settings, language, kitchenLanguage, printedAt],
  );

  if (!pages) return null;
  return (
    <div className="flex flex-col gap-4">
      {pages.map((page, index) => (
        <div key={index} className="border-line border shadow-sm">
          <DishCardSheet page={page} label={`${t('card.title')} · ${index + 1}/2`} />
        </div>
      ))}
    </div>
  );
}
