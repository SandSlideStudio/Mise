import { eq } from 'drizzle-orm';
import {
  BASE_UNIT_FOR,
  createRecipeBook,
  dimensionOf,
  isAllergen,
  isUnitCode,
  type Allergen,
  type Ingredient as DomainIngredient,
  type Recipe as DomainRecipe,
  type RecipeBook,
  type RecipeComponent as DomainComponent,
  type UnitCode,
} from '@mise/domain';
import type { Database, Executor } from '../../db/client.js';
import { ingredients, recipeComponents, recipes } from '../../db/schema.js';

/**
 * Loading the recipe graph into the shape the domain package works with.
 *
 * Cycle detection and allergen roll-up both need to walk the whole graph, so
 * the whole graph is loaded in three queries and assembled in memory. A
 * kitchen has hundreds of recipes, not millions, and doing it this way keeps
 * the maths in one tested place instead of spread through recursive SQL.
 */

/** Everything in the domain is in base units, so quantities are normalised here. */
function baseUnitFor(enteredUnit: string): UnitCode {
  if (!isUnitCode(enteredUnit)) return 'g';
  return BASE_UNIT_FOR[dimensionOf(enteredUnit)];
}

function toAllergens(values: string[]): Allergen[] {
  return values.filter(isAllergen);
}

export async function loadRecipeBook(db: Executor): Promise<RecipeBook> {
  const [recipeRows, componentRows, ingredientRows] = await Promise.all([
    db.select().from(recipes),
    db.select().from(recipeComponents),
    db.select().from(ingredients),
  ]);

  const componentsByRecipe = new Map<string, DomainComponent[]>();
  for (const row of componentRows) {
    const list = componentsByRecipe.get(row.recipeId) ?? [];
    list.push({
      id: row.id,
      sortOrder: row.sortOrder,
      section: row.section,
      note: row.note,
      quantity: { value: row.quantityBase, unit: baseUnitFor(row.unitEntered) },
      ref: row.childRecipeId
        ? { kind: 'recipe', recipeId: row.childRecipeId }
        : { kind: 'ingredient', ingredientId: row.ingredientId! },
    });
    componentsByRecipe.set(row.recipeId, list);
  }

  const domainRecipes: DomainRecipe[] = recipeRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    stationId: row.stationId,
    yield: { value: row.yieldBase, unit: baseUnitFor(row.yieldUnit) },
    portions: row.portions,
    components: (componentsByRecipe.get(row.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder),
    declaredAllergens: toAllergens(row.declaredAllergens),
    mayContain: toAllergens(row.mayContain),
  }));

  const domainIngredients: DomainIngredient[] = ingredientRows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUnit: row.baseUnit,
    allergens: toAllergens(row.allergens),
    densityGPerMl: row.densityGPerMl,
    itemWeightG: row.itemWeightG,
    yieldPercent: row.yieldPercent,
    requiresPrep: row.requiresPrep,
    vegan: row.vegan,
    allergenDetails: row.allergenDetails,
  }));

  return createRecipeBook(domainRecipes, domainIngredients);
}

/**
 * The names a recipe's lines refer to, so a component can be rendered without
 * the client fetching every ingredient separately.
 */
export async function loadComponentNames(
  db: Database,
  recipeId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      componentId: recipeComponents.id,
      ingredientName: ingredients.name,
      recipeName: recipes.name,
    })
    .from(recipeComponents)
    .leftJoin(ingredients, eq(ingredients.id, recipeComponents.ingredientId))
    .leftJoin(recipes, eq(recipes.id, recipeComponents.childRecipeId))
    .where(eq(recipeComponents.recipeId, recipeId));

  return new Map(
    rows.map((row) => [row.componentId, row.ingredientName ?? row.recipeName ?? 'Unknown']),
  );
}
