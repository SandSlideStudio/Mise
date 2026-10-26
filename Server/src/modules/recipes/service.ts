import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { CreateRecipe, CreateRecipeComponent, UpdateRecipe } from '@mise/contracts';
import {
  findCycle,
  rollUpAllergens,
  toBase,
  wouldCreateCycle,
  type Allergen,
  type AllergenProfile,
  type UnitCode,
} from '@mise/domain';
import type { Database, Executor } from '../../db/client.js';
import { recipeComponents, recipePhotos, recipes } from '../../db/schema.js';
import { loadRecipeBook } from './book.js';

/**
 * The recipe library.
 *
 * The one rule that makes this a restaurant spec rather than a blog post is
 * that a component points at either an ingredient or another recipe. Enforcing
 * that, and refusing the loops it makes possible, is most of what this file
 * does.
 */

type StoredRecipe = typeof recipes.$inferSelect;

/**
 * Explicit outcomes rather than inferred unions, so callers narrow on a
 * discriminant instead of on whether a property happens to be present.
 */
export type CreateRecipeResult =
  { outcome: 'created'; recipe: StoredRecipe } | { outcome: 'cycle'; through: string[] };

export type UpdateRecipeResult =
  | { outcome: 'updated'; recipe: StoredRecipe }
  | { outcome: 'cycle'; through: string[] }
  | { outcome: 'not_found' };

function quantityColumns(quantity: { value: number; unit: string }) {
  const unit = quantity.unit as UnitCode;
  return {
    quantityBase: toBase({ value: quantity.value, unit }),
    quantityEntered: quantity.value,
    unitEntered: quantity.unit,
  };
}

export function createRecipesService(db: Database) {
  async function listRecipes(filters: {
    search?: string;
    type?: string;
    status?: string;
    stationId?: string;
    tag?: string;
  }) {
    const conditions: SQL[] = [];
    if (filters.search) conditions.push(ilike(recipes.name, `%${filters.search}%`));
    if (filters.type)
      conditions.push(eq(recipes.type, filters.type as 'dish' | 'prep' | 'component'));
    if (filters.status)
      conditions.push(eq(recipes.status, filters.status as 'draft' | 'published' | 'archived'));
    if (filters.stationId) conditions.push(eq(recipes.stationId, filters.stationId));
    if (filters.tag) conditions.push(sql`${recipes.tags} ? ${filters.tag}`);

    return db
      .select({
        id: recipes.id,
        name: recipes.name,
        type: recipes.type,
        status: recipes.status,
        stationId: recipes.stationId,
        yieldEntered: recipes.yieldEntered,
        yieldUnit: recipes.yieldUnit,
        portions: recipes.portions,
        tags: recipes.tags,
        updatedAt: recipes.updatedAt,
      })
      .from(recipes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(recipes.name));
  }

  async function getRecipe(id: string) {
    const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    if (!row) return null;

    const components = await db
      .select()
      .from(recipeComponents)
      .where(eq(recipeComponents.recipeId, id))
      .orderBy(asc(recipeComponents.sortOrder));

    const photos = await db
      .select()
      .from(recipePhotos)
      .where(eq(recipePhotos.recipeId, id))
      .orderBy(asc(recipePhotos.createdAt));

    return { ...row, components, photos };
  }

  /** Allergens for the whole tree beneath a recipe. */
  async function allergensFor(id: string): Promise<AllergenProfile> {
    const book = await loadRecipeBook(db);
    const result = rollUpAllergens(id, book);
    // A missing reference cannot under-declare an allergen silently: fall back
    // to whatever the recipe itself declares rather than reporting nothing.
    if (!result.ok) {
      const recipe = book.recipe(id);
      return {
        contains: (recipe?.declaredAllergens ?? []) as Allergen[],
        mayContain: (recipe?.mayContain ?? []) as Allergen[],
      };
    }
    return result.value;
  }

  /**
   * Check every sub-recipe reference before writing, so a loop can never reach
   * the database. Checked here rather than only in the UI, because a cycle
   * makes scaling and prep explosion non-terminating.
   */
  async function findCycleIn(
    exec: Executor,
    recipeId: string,
    components: CreateRecipeComponent[],
  ): Promise<string[] | null> {
    const children = components
      .filter((c) => c.ref.kind === 'recipe')
      .map((c) => (c.ref as { kind: 'recipe'; recipeId: string }).recipeId);
    if (children.length === 0) return null;

    const book = await loadRecipeBook(exec);
    for (const childId of children) {
      if (wouldCreateCycle(recipeId, childId, book)) {
        const child = book.recipe(childId);
        return [book.recipe(recipeId)?.name ?? 'This recipe', child?.name ?? 'that recipe'];
      }
    }
    return null;
  }

  async function replaceComponents(
    exec: Executor,
    recipeId: string,
    components: CreateRecipeComponent[],
  ): Promise<void> {
    await exec.delete(recipeComponents).where(eq(recipeComponents.recipeId, recipeId));
    if (components.length === 0) return;

    await exec.insert(recipeComponents).values(
      components.map((component, index) => ({
        recipeId,
        sortOrder: component.sortOrder ?? index,
        section: component.section ?? null,
        note: component.note ?? null,
        ...quantityColumns(component.quantity),
        ingredientId: component.ref.kind === 'ingredient' ? component.ref.ingredientId : null,
        childRecipeId: component.ref.kind === 'recipe' ? component.ref.recipeId : null,
      })),
    );
  }

  async function createRecipe(
    input: CreateRecipe,
    createdBy: string | null,
  ): Promise<CreateRecipeResult> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .insert(recipes)
        .values({
          name: input.name,
          type: input.type,
          status: input.status,
          stationId: input.stationId ?? null,
          ...yieldColumns(input.yield),
          portions: input.portions ?? null,
          prepMinutes: input.prepMinutes ?? null,
          cookMinutes: input.cookMinutes ?? null,
          shelfLifeHours: input.shelfLifeHours ?? null,
          storage: input.storage ?? null,
          method: input.method,
          tags: input.tags,
          declaredAllergens: input.declaredAllergens,
          mayContain: input.mayContain,
          flavourProfile: input.flavourProfile,
          servingTemperature: input.servingTemperature,
          course: input.course,
          drinkPairings: input.drinkPairings,
          cutlery: input.cutlery,
          createdBy,
        })
        .returning();
      if (!row) throw new Error('Insert returned no recipe');

      // A brand new recipe cannot close a loop through itself, but it can point
      // at one that already exists, so the same check runs.
      const cycle = await findCycleIn(tx, row.id, input.components);
      if (cycle) {
        await tx.delete(recipes).where(eq(recipes.id, row.id));
        return { outcome: 'cycle', through: cycle };
      }

      await replaceComponents(tx, row.id, input.components);
      return { outcome: 'created', recipe: row };
    });
  }

  async function updateRecipe(id: string, input: UpdateRecipe): Promise<UpdateRecipeResult> {
    const existing = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    if (existing.length === 0) return { outcome: 'not_found' };

    if (input.components) {
      const cycle = await findCycleIn(db, id, input.components);
      if (cycle) return { outcome: 'cycle', through: cycle };
    }

    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(recipes)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
          ...(input.yield !== undefined ? yieldColumns(input.yield) : {}),
          ...(input.portions !== undefined ? { portions: input.portions } : {}),
          ...(input.prepMinutes !== undefined ? { prepMinutes: input.prepMinutes } : {}),
          ...(input.cookMinutes !== undefined ? { cookMinutes: input.cookMinutes } : {}),
          ...(input.shelfLifeHours !== undefined ? { shelfLifeHours: input.shelfLifeHours } : {}),
          ...(input.storage !== undefined ? { storage: input.storage } : {}),
          ...(input.method !== undefined ? { method: input.method } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.declaredAllergens !== undefined
            ? { declaredAllergens: input.declaredAllergens }
            : {}),
          ...(input.mayContain !== undefined ? { mayContain: input.mayContain } : {}),
          ...(input.flavourProfile !== undefined ? { flavourProfile: input.flavourProfile } : {}),
          ...(input.servingTemperature !== undefined
            ? { servingTemperature: input.servingTemperature }
            : {}),
          ...(input.course !== undefined ? { course: input.course } : {}),
          ...(input.drinkPairings !== undefined ? { drinkPairings: input.drinkPairings } : {}),
          ...(input.cutlery !== undefined ? { cutlery: input.cutlery } : {}),
          version: sql`${recipes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(recipes.id, id))
        .returning();

      if (input.components) await replaceComponents(tx, id, input.components);
      return { outcome: 'updated' as const, recipe: row! };
    });
  }

  async function deleteRecipe(id: string): Promise<boolean> {
    const removed = await db
      .delete(recipes)
      .where(eq(recipes.id, id))
      .returning({ id: recipes.id });
    return removed.length > 0;
  }

  /** Copying a spec is how most new dishes start life. */
  async function duplicateRecipe(id: string, name: string) {
    const source = await getRecipe(id);
    if (!source) return null;

    return db.transaction(async (tx) => {
      const [copy] = await tx
        .insert(recipes)
        .values({
          name,
          type: source.type,
          // A copy always starts as a draft, whatever the original was.
          status: 'draft',
          stationId: source.stationId,
          yieldBase: source.yieldBase,
          yieldEntered: source.yieldEntered,
          yieldUnit: source.yieldUnit,
          portions: source.portions,
          prepMinutes: source.prepMinutes,
          cookMinutes: source.cookMinutes,
          shelfLifeHours: source.shelfLifeHours,
          storage: source.storage,
          method: source.method,
          tags: source.tags,
          declaredAllergens: source.declaredAllergens,
          mayContain: source.mayContain,
          flavourProfile: source.flavourProfile,
          servingTemperature: source.servingTemperature,
          course: source.course,
          drinkPairings: source.drinkPairings,
          cutlery: source.cutlery,
          createdBy: source.createdBy,
        })
        .returning();
      if (!copy) return null;

      if (source.components.length > 0) {
        await tx.insert(recipeComponents).values(
          source.components.map((component) => ({
            recipeId: copy.id,
            sortOrder: component.sortOrder,
            section: component.section,
            note: component.note,
            quantityBase: component.quantityBase,
            quantityEntered: component.quantityEntered,
            unitEntered: component.unitEntered,
            ingredientId: component.ingredientId,
            childRecipeId: component.childRecipeId,
          })),
        );
      }
      return copy;
    });
  }

  /** Which recipes use this one, so deleting it can say what would break. */
  async function usedBy(id: string) {
    return db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipeComponents)
      .innerJoin(recipes, eq(recipes.id, recipeComponents.recipeId))
      .where(eq(recipeComponents.childRecipeId, id));
  }

  /** Recipes containing a given allergen anywhere in their tree. */
  async function idsWithAllergen(allergen: Allergen): Promise<Set<string>> {
    const book = await loadRecipeBook(db);
    const all = await db.select({ id: recipes.id }).from(recipes);
    const matching = new Set<string>();
    for (const { id } of all) {
      const profile = rollUpAllergens(id, book);
      if (profile.ok && profile.value.contains.includes(allergen)) matching.add(id);
    }
    return matching;
  }

  /** Any loop already in the library, used by a health check in the tests. */
  async function detectCycle(recipeId: string): Promise<string[] | null> {
    return findCycle(recipeId, await loadRecipeBook(db));
  }

  async function recipesByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return db.select().from(recipes).where(inArray(recipes.id, ids));
  }

  return {
    listRecipes,
    getRecipe,
    allergensFor,
    createRecipe,
    updateRecipe,
    deleteRecipe,
    duplicateRecipe,
    usedBy,
    idsWithAllergen,
    detectCycle,
    recipesByIds,
    findCycleIn,
  };
}

/** A batch yield, stored in base units alongside the unit the chef chose. */
function yieldColumns(quantity: { value: number; unit: string }) {
  const unit = quantity.unit as UnitCode;
  return {
    yieldBase: toBase({ value: quantity.value, unit }),
    yieldEntered: quantity.value,
    yieldUnit: quantity.unit,
  };
}

export type RecipesService = ReturnType<typeof createRecipesService>;
