import {
  BASE_UNIT_FOR,
  createRecipeBook,
  dimensionOf,
  dishCardMatrix,
  expandRecipe,
  factorFor,
  MAX_LINES,
  rollUpAllergens,
  toBase,
  type Ingredient as BookIngredient,
  type Recipe as BookRecipe,
  type RecipeBook,
} from '@mise/domain';
import type { Checklist } from './checklist.js';
import { recipeCostAt, type CostSettings } from './costing.js';
import {
  dishCardFacts,
  type DishCard,
  type DishCardSettings,
  type DishSummary,
} from './dishcards.js';
import type { Station } from './kitchen.js';
import type { Menu, MenuOverview, MenuSummary } from './menus.js';
import type {
  AllergenChange,
  ComponentRef as RecipeRef,
  Recipe,
  RecipeComponent,
  RecipeSummary,
} from './recipes.js';

/**
 * Everything a tablet loads ahead for offline use, in one answer.
 *
 * What the tablet ends up with is exactly what each matching endpoint gives,
 * but most of it is not sent: it is worked out on the tablet with the same
 * kitchen maths the server uses. Each recipe comes once, with the
 * ingredients it uses, and from those the tablet makes the recipe book again
 * and works out every expanded tree, allergen list, used-by list, cost and
 * dish card itself. Sending them made a kitchen of 300 recipes a download of
 * several megabytes, nearly all of it the same lines again, since a sauce is
 * written out in full inside every dish that uses it.
 *
 * Where the server's own reading would come out differently from what the
 * tablet can work out (an amount stored rounded, two lines in the same
 * place, a name changed under a line), the server says so in the bundle and
 * the tablet takes that instead of its own: it checks every recipe and card
 * before sending, so the two never differ.
 */

/**
 * Raised whenever the shape of the bundle changes. A tablet asks for the
 * format it can read, and a server that can't give that one refuses, rather
 * than an app saved on a tablet before an update reading a bundle it doesn't
 * understand and filling its screens with half of it.
 */
export const OFFLINE_BUNDLE_FORMAT = 2;

/**
 * A recipe as the endpoint gives it, less what the tablet can put back. A
 * line's name is left out where it is the name of what it refers to, and
 * what it refers to is a number where it can be: the place of the
 * ingredient in the bundle's ingredients, or for a recipe, minus one minus
 * its place in the recipe entries. Most of a recipe is the ids of its lines
 * and of what they refer to, and an id is long and squeezes badly.
 */
export type OfflineRecipe = Omit<Recipe, 'components'> & {
  components: (Omit<RecipeComponent, 'ref'> & { ref: RecipeRef | number })[];
};

export interface OfflineRecipeEntry {
  recipe: OfflineRecipe;
  /**
   * The amounts the server keeps in base units, where they are not exactly
   * the entered ones converted (they are stored to four decimals): the
   * yield first, then each line in the order of recipe.components. Null
   * where they are. Left out when none differ.
   */
  base?: (number | null)[];
  /** The recipe as the book has it, when that is not what the tablet would make of it. */
  book?: BookRecipe;
  /** A dish's allergen record, newest first. Null for what is not a dish. */
  allergenHistory: AllergenChange[] | null;
  /**
   * The ingredients a dish card asks someone to look at. Given, not worked
   * out, because they are in name order and names sort differently in
   * different languages. Present: the card is worked out from the rest.
   */
  cardAttention?: DishCard['attention'];
  /** The card as it is, when the tablet would not work out the same one. */
  card?: Omit<DishCard, 'settings'>;
}

export interface OfflineBundle {
  format: typeof OFFLINE_BUNDLE_FORMAT;
  /** The data version this was built at. Stored by the tablet, compared next time. */
  version: string;
  stations: Station[];
  checklist: Checklist;
  dishes: DishSummary[];
  menus: MenuSummary[];
  dishCardSettings: DishCardSettings;
  /** What dish cards are headed with. Null when no cards are sent. */
  kitchenName: string | null;
  /** For working costs out. Only in a chef's bundle: a cook's carries no costs at all. */
  costSettings?: CostSettings;
  /** Every ingredient a recipe uses; without prices in a cook's bundle. */
  ingredients: BookIngredient[];
  /** In the order of the recipe list. */
  recipeEntries: OfflineRecipeEntry[];
  menuEntries: {
    menu: Menu;
    overview: Omit<MenuOverview, 'settings'> | null;
  }[];
}

export type UnpackedEntry = readonly [queryKey: readonly unknown[], data: unknown];

/**
 * The most lines the expanded specs of a whole bundle may come to on a
 * tablet. Each recipe stops at MAX_LINES, but a thousand dishes that each
 * use a sub-recipe of nearly that many came to eight million lines: a
 * gigabyte, and every tablet's page gone at each load. Far more than a real
 * kitchen's specs; past it, the rest are asked for when opened, online.
 */
export const MAX_UNPACKED_LINES = 200_000;

/**
 * A recipe as the recipe book has it, made from the recipe as the endpoint
 * gives it: amounts in base units, lines in order. The server reads the book
 * from its own columns; this is what the tablet makes of the same recipe,
 * and the server compares the two before sending.
 */
export function bookRecipeFrom(recipe: Recipe, base?: readonly (number | null)[]): BookRecipe {
  const baseUnit = (unit: Recipe['yield']['unit']) => BASE_UNIT_FOR[dimensionOf(unit)];
  return {
    id: recipe.id,
    name: recipe.name,
    type: recipe.type,
    stationId: recipe.stationId,
    yield: { value: base?.[0] ?? toBase(recipe.yield), unit: baseUnit(recipe.yield.unit) },
    portions: recipe.portions,
    components: recipe.components
      .map((component, index) => ({
        id: component.id,
        sortOrder: component.sortOrder,
        section: component.section,
        note: component.note,
        quantity: {
          value: base?.[index + 1] ?? toBase(component.quantity),
          unit: baseUnit(component.quantity.unit),
        },
        ref: component.ref,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    declaredAllergens: recipe.declaredAllergens,
    mayContain: recipe.mayContain,
  };
}

/** The name a recipe line shows: of the ingredient or recipe it refers to. */
export function componentName(ref: RecipeRef, book: RecipeBook): string {
  const found =
    ref.kind === 'ingredient' ? book.ingredient(ref.ingredientId) : book.recipe(ref.recipeId);
  return found?.name ?? 'Unknown';
}

/**
 * A dish's card, worked out from its recipe, its line on the Dishes page
 * (the menus it is on, its photo) and the book. Null when the card can't be
 * worked out, as the endpoint then refuses it.
 */
export function dishCardFrom(
  recipe: Recipe,
  summary: DishSummary | undefined,
  kitchenName: string,
  attention: DishCard['attention'],
  book: RecipeBook,
): Omit<DishCard, 'settings'> | null {
  const matrix = dishCardMatrix(recipe.id, book);
  if (!matrix.ok) return null;
  return {
    kitchenName,
    dish: {
      id: recipe.id,
      name: recipe.name,
      status: recipe.status,
      menus: summary?.menus ?? [],
      flavourProfile: recipe.flavourProfile,
      servingTemperature: recipe.servingTemperature,
      course: recipe.course,
      drinkPairings: recipe.drinkPairings,
      cutlery: recipe.cutlery,
      photoUrl: summary?.photoUrl ?? null,
    },
    rows: matrix.value.rows.map((row) => ({
      recipeId: row.recipeId!,
      name: row.name,
      ...dishCardFacts(row),
    })),
    other: matrix.value.other ? dishCardFacts(matrix.value.other) : null,
    whole: dishCardFacts(matrix.value.dish),
    attention,
  };
}

/** A line's reference as sent: a number where the bundle holds what it refers to. */
export function packedRef(
  ref: RecipeRef,
  ingredientAt: ReadonlyMap<string, number>,
  recipeAt: ReadonlyMap<string, number>,
): RecipeRef | number {
  const at =
    ref.kind === 'ingredient' ? ingredientAt.get(ref.ingredientId) : recipeAt.get(ref.recipeId);
  if (at === undefined) return ref;
  return ref.kind === 'ingredient' ? at : -1 - at;
}

/** The bundle as the query cache keys the screens read, each with its endpoint's answer. */
export function unpackOfflineBundle(bundle: OfflineBundle): UnpackedEntry[] {
  const refOf = (ref: RecipeRef | number): RecipeRef => {
    if (typeof ref !== 'number') return ref;
    return ref >= 0
      ? { kind: 'ingredient', ingredientId: bundle.ingredients[ref]!.id }
      : { kind: 'recipe', recipeId: bundle.recipeEntries[-1 - ref]!.recipe.id };
  };
  const withRefs = bundle.recipeEntries.map(({ recipe }) => ({
    ...recipe,
    components: recipe.components.map((component) => ({
      ...component,
      ref: refOf(component.ref),
    })),
  }));
  const book = createRecipeBook(
    withRefs.map(
      (recipe, i) =>
        bundle.recipeEntries[i]!.book ?? bookRecipeFrom(recipe, bundle.recipeEntries[i]!.base),
    ),
    bundle.ingredients,
  );
  const recipes: Recipe[] = withRefs.map((recipe) => ({
    ...recipe,
    components: recipe.components.map((component) => ({
      ...component,
      displayName: component.displayName ?? componentName(component.ref, book),
    })),
  }));
  const summaries = new Map(bundle.dishes.map((dish) => [dish.id, dish]));

  // Which recipes each one is a part of: one entry per line that uses it.
  const usedBy = new Map<string, { id: string; name: string }[]>();
  for (const recipe of recipes) {
    for (const component of book.recipe(recipe.id)?.components ?? []) {
      if (component.ref.kind !== 'recipe') continue;
      const list = usedBy.get(component.ref.recipeId) ?? [];
      list.push({ id: recipe.id, name: recipe.name });
      usedBy.set(component.ref.recipeId, list);
    }
  }

  const entries: UnpackedEntry[] = [
    [['stations'], bundle.stations],
    [['checklist'], bundle.checklist],
    [['dishes'], bundle.dishes],
    [['menus'], bundle.menus],
    [['dish-card-settings'], bundle.dishCardSettings],
    [
      ['recipes', {}],
      recipes.map((recipe) => ({
        id: recipe.id,
        name: recipe.name,
        type: recipe.type,
        status: recipe.status,
        stationId: recipe.stationId,
        yield: recipe.yield,
        portions: recipe.portions,
        tags: recipe.tags,
        updatedAt: recipe.updatedAt,
      })) satisfies RecipeSummary[],
    ],
  ];
  let linesLeft = MAX_UNPACKED_LINES;
  for (const [i, entry] of bundle.recipeEntries.entries()) {
    const recipe = recipes[i]!;
    const id = recipe.id;
    entries.push([['recipe', id], recipe], [['recipe-used-by', id], usedBy.get(id) ?? []]);

    // As the endpoints: what can't be worked out all the way down is not
    // handed out at all, never as a shorter list of allergens.
    const allergens = rollUpAllergens(id, book);
    if (allergens.ok) {
      entries.push([['recipe-allergens', id], allergens.value]);
      const factor = factorFor(id, {}, book);
      const lines = factor.ok && linesLeft > 0 ? expandRecipe(id, factor.value, book) : null;
      // A tree refused for its size took as long to work out as one that size.
      if (lines?.ok) linesLeft -= lines.value.length;
      else if (lines?.error.kind === 'too_many_lines') linesLeft -= MAX_LINES;
      if (factor.ok && lines?.ok) {
        const cost = bundle.costSettings
          ? recipeCostAt(id, factor.value, book, bundle.costSettings, recipe.sellPrice ?? null)
          : null;
        entries.push([
          ['recipe-expanded', id, {}],
          {
            recipe,
            factor: factor.value,
            lines: lines.value,
            allergens: allergens.value,
            ...(cost ? { cost } : {}),
          },
        ]);
      }
    }
    if (entry.allergenHistory) {
      entries.push([['recipe-allergen-history', id], entry.allergenHistory]);
    }
    const card =
      entry.card ??
      (entry.cardAttention && bundle.kitchenName !== null && recipe.type === 'dish'
        ? dishCardFrom(recipe, summaries.get(id), bundle.kitchenName, entry.cardAttention, book)
        : null);
    if (card) {
      entries.push([['dish-card', id], { ...card, settings: bundle.dishCardSettings }]);
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
