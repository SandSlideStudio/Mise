import type { Checklist } from './checklist.js';
import type { DishCard, DishCardSettings, DishSummary } from './dishcards.js';
import type { Station } from './kitchen.js';
import type { Menu, MenuOverview, MenuSummary } from './menus.js';
import type {
  AllergenChange,
  AllergenProfile,
  ExpandedRecipe,
  Recipe,
  RecipeSummary,
} from './recipes.js';

/**
 * Everything a tablet loads ahead for offline use, in one answer.
 *
 * Each part is exactly what the matching endpoint gives, except that what
 * would repeat is left out and put back by unpackOfflineBundle: the recipe
 * inside its expanded tree, the allergens beside it, and the card settings
 * inside every dish card and overview. With 200 recipes that is most of the
 * weight.
 */
export interface OfflineBundle {
  /** The data version this was built at. Stored by the tablet, compared next time. */
  version: string;
  stations: Station[];
  checklist: Checklist;
  dishes: DishSummary[];
  menus: MenuSummary[];
  dishCardSettings: DishCardSettings;
  recipes: RecipeSummary[];
  recipeEntries: {
    recipe: Recipe;
    usedBy: { id: string; name: string }[];
    /** Null when the tree can't be worked out; the individual endpoint answers 422. */
    allergens: AllergenProfile | null;
    expanded: Pick<ExpandedRecipe, 'factor' | 'lines'> | null;
    /** Null for what is not a dish, and for a cook where cards are for chefs only. */
    card: Omit<DishCard, 'settings'> | null;
    /** A dish's allergen record, newest first. Null for what is not a dish. */
    allergenHistory: AllergenChange[] | null;
  }[];
  menuEntries: {
    menu: Menu;
    overview: Omit<MenuOverview, 'settings'> | null;
  }[];
}

export type UnpackedEntry = readonly [queryKey: readonly unknown[], data: unknown];

/** The bundle as the query cache keys the screens read, each with its endpoint's answer. */
export function unpackOfflineBundle(bundle: OfflineBundle): UnpackedEntry[] {
  const entries: UnpackedEntry[] = [
    [['stations'], bundle.stations],
    [['checklist'], bundle.checklist],
    [['dishes'], bundle.dishes],
    [['menus'], bundle.menus],
    [['dish-card-settings'], bundle.dishCardSettings],
    [['recipes', {}], bundle.recipes],
  ];
  for (const entry of bundle.recipeEntries) {
    const id = entry.recipe.id;
    entries.push([['recipe', id], entry.recipe], [['recipe-used-by', id], entry.usedBy]);
    if (entry.allergens) {
      entries.push([['recipe-allergens', id], entry.allergens]);
      if (entry.expanded) {
        entries.push([
          ['recipe-expanded', id, {}],
          { recipe: entry.recipe, ...entry.expanded, allergens: entry.allergens },
        ]);
      }
    }
    if (entry.allergenHistory) {
      entries.push([['recipe-allergen-history', id], entry.allergenHistory]);
    }
    if (entry.card) {
      entries.push([['dish-card', id], { ...entry.card, settings: bundle.dishCardSettings }]);
    }
  }
  for (const entry of bundle.menuEntries) {
    entries.push([['menu', entry.menu.id], entry.menu]);
    if (entry.overview) {
      entries.push([
        ['menu-overview', entry.menu.id],
        { ...entry.overview, settings: bundle.dishCardSettings },
      ]);
    }
  }
  return entries;
}
