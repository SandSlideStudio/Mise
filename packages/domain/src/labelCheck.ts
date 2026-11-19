import type { Allergen, AllergenProfile } from './allergens.js';
import { ALLERGENS } from './allergens.js';
import { rollUpAllergens, type RecipeBook } from './recipe.js';

/**
 * What a new label means for the menu, before it is saved.
 *
 * A supplier changes a product; the label at the back door says so. Before
 * the new allergens go on the ingredient, the person checking sees which
 * dishes gain or lose an allergen through it, however deep in a sub-recipe
 * it sits. Worked out with the same roll-up the dish cards use, on whatever
 * book the caller has: on a tablet, the one loaded for offline use.
 */

export interface LabelReading {
  allergens: readonly Allergen[];
  mayContain: readonly Allergen[];
}

/** One dish whose allergens would change, and how. */
export interface DishAllergenShift {
  dishId: string;
  before: AllergenProfile;
  after: AllergenProfile;
  added: Allergen[];
  removed: Allergen[];
  mayAdded: Allergen[];
  mayRemoved: Allergen[];
}

export interface LabelShift {
  /** Dishes whose allergens change, in the order they were given. */
  dishes: DishAllergenShift[];
  /** Dishes that couldn't be worked out, before or after: a part this book doesn't have. */
  unknown: string[];
}

function minus(a: readonly Allergen[], b: readonly Allergen[]): Allergen[] {
  return ALLERGENS.filter((allergen) => a.includes(allergen) && !b.includes(allergen));
}

/** The book with one ingredient reading as the label says. */
function withLabel(book: RecipeBook, ingredientId: string, label: LabelReading): RecipeBook {
  return {
    recipe: (id) => book.recipe(id),
    ingredient: (id) => {
      const found = book.ingredient(id);
      if (!found || id !== ingredientId) return found;
      return {
        ...found,
        allergens: [...label.allergens],
        // A trace of what it contains anyway says nothing more.
        mayContain: label.mayContain.filter((allergen) => !label.allergens.includes(allergen)),
      };
    },
  };
}

export function labelShift(
  book: RecipeBook,
  dishIds: readonly string[],
  ingredientId: string,
  label: LabelReading,
): LabelShift {
  const next = withLabel(book, ingredientId, label);
  const dishes: DishAllergenShift[] = [];
  const unknown: string[] = [];
  for (const dishId of dishIds) {
    const before = rollUpAllergens(dishId, book);
    const after = rollUpAllergens(dishId, next);
    if (!before.ok || !after.ok) {
      unknown.push(dishId);
      continue;
    }
    const shift: DishAllergenShift = {
      dishId,
      before: before.value,
      after: after.value,
      added: minus(after.value.contains, before.value.contains),
      removed: minus(before.value.contains, after.value.contains),
      mayAdded: minus(after.value.mayContain, before.value.mayContain),
      mayRemoved: minus(before.value.mayContain, after.value.mayContain),
    };
    if (shift.added.length + shift.removed.length + shift.mayAdded.length + shift.mayRemoved.length)
      dishes.push(shift);
  }
  return { dishes, unknown };
}
