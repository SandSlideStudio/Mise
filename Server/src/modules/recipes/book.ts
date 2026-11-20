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
  // Only the columns the domain works with: the method, notes and timestamps
  // are the bulk of every row and nothing here reads them.
  const [recipeRows, componentRows, ingredientRows] = await Promise.all([
    db
      .select({
        id: recipes.id,
        name: recipes.name,
        type: recipes.type,
        stationId: recipes.stationId,
        yieldBase: recipes.yieldBase,
        yieldUnit: recipes.yieldUnit,
        portions: recipes.portions,
        declaredAllergens: recipes.declaredAllergens,
        mayContain: recipes.mayContain,
      })
      .from(recipes),
    db
      .select({
        id: recipeComponents.id,
        recipeId: recipeComponents.recipeId,
        sortOrder: recipeComponents.sortOrder,
        section: recipeComponents.section,
        note: recipeComponents.note,
        quantityBase: recipeComponents.quantityBase,
        unitEntered: recipeComponents.unitEntered,
        ingredientId: recipeComponents.ingredientId,
        childRecipeId: recipeComponents.childRecipeId,
      })
      .from(recipeComponents),
    db
      .select({
        id: ingredients.id,
        name: ingredients.name,
        baseUnit: ingredients.baseUnit,
        allergens: ingredients.allergens,
        mayContain: ingredients.mayContain,
        vegan: ingredients.vegan,
        allergenDetails: ingredients.allergenDetails,
        densityGPerMl: ingredients.densityGPerMl,
        itemWeightG: ingredients.itemWeightG,
        yieldPercent: ingredients.yieldPercent,
        price: ingredients.price,
        purchaseQuantity: ingredients.purchaseQuantity,
        purchaseUnit: ingredients.purchaseUnit,
      })
      .from(ingredients),
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

  return createRecipeBook(domainRecipes, ingredientRows.map(domainIngredient));
}

/** The columns of an ingredient the domain needs; a full row has them all. */
type IngredientForDomain = Pick<
  typeof ingredients.$inferSelect,
  | 'id'
  | 'name'
  | 'baseUnit'
  | 'allergens'
  | 'mayContain'
  | 'vegan'
  | 'allergenDetails'
  | 'densityGPerMl'
  | 'itemWeightG'
  | 'yieldPercent'
  | 'price'
  | 'purchaseQuantity'
  | 'purchaseUnit'
>;

/** One ingredient as the domain works with it, price and all. */
export function domainIngredient(row: IngredientForDomain): DomainIngredient {
  return {
    id: row.id,
    name: row.name,
    baseUnit: row.baseUnit,
    allergens: toAllergens(row.allergens),
    mayContain: toAllergens(row.mayContain),
    vegan: row.vegan,
    allergenDetails: row.allergenDetails,
    densityGPerMl: row.densityGPerMl,
    itemWeightG: row.itemWeightG,
    yieldPercent: row.yieldPercent,
    price: priceOf(row),
  };
}

/** A price is only a price with what it buys; anything less is unknown. */
function priceOf(row: IngredientForDomain): DomainIngredient['price'] {
  if (row.price === null || row.purchaseQuantity === null || !row.purchaseUnit) return null;
  if (!isUnitCode(row.purchaseUnit)) return null;
  return { amount: row.price, quantity: { value: row.purchaseQuantity, unit: row.purchaseUnit } };
}

/**
 * The names a recipe's lines refer to, so a component can be rendered without
 * the client fetching every ingredient separately.
 */
export async function loadComponentNames(
  db: Database,
  recipeId?: string,
): Promise<Map<string, string>> {
  const query = db
    .select({
      componentId: recipeComponents.id,
      ingredientName: ingredients.name,
      recipeName: recipes.name,
    })
    .from(recipeComponents)
    .leftJoin(ingredients, eq(ingredients.id, recipeComponents.ingredientId))
    .leftJoin(recipes, eq(recipes.id, recipeComponents.childRecipeId));
  // No recipe named: every line of every recipe, for the bundle for offline use.
  const rows = await (recipeId ? query.where(eq(recipeComponents.recipeId, recipeId)) : query);

  return new Map(
    rows.map((row) => [row.componentId, row.ingredientName ?? row.recipeName ?? 'Unknown']),
  );
}
