import { useEffect } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { RecipeType } from '@mise/contracts';

/**
 * Dishes live under the Dishes tab, everything else under Recipes: their
 * own pages, their own editor, their own print page. Keeping them apart is
 * the point of having two tabs.
 */

export type RecipePage = 'view' | 'edit' | 'card';

/** Where a recipe's page lives. A card only exists for a dish. */
export function sectionPath(id: string, type: RecipeType, page: RecipePage): string {
  if (type === 'dish') {
    return page === 'view' ? `/dishes/${id}/recipe` : `/dishes/${id}/${page}`;
  }
  return page === 'edit' ? `/recipes/${id}/edit` : `/recipes/${id}`;
}

/**
 * Opened under the other tab, by an older link or a bookmark: go to the same
 * page under the right one, keeping anything asked for in the address.
 */
export function useRightSection(
  recipe: { id: string; type: RecipeType } | undefined,
  page: RecipePage,
): void {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  useEffect(() => {
    if (!recipe) return;
    const home = recipe.type === 'dish' ? '/dishes/' : '/recipes/';
    if (pathname.startsWith(home)) return;
    void navigate({
      href: sectionPath(recipe.id, recipe.type, page) + window.location.search,
      replace: true,
    });
  }, [recipe, page, pathname, navigate]);
}
