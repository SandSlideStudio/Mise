import { ApiError } from '../../lib/errors.js';
import { and, asc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import type { CreateRecipe, CreateRecipeComponent, UpdateRecipe } from '@mise/contracts';
import {
  findCycle,
  rollUpAllergens,
  toBase,
  factorForYield,
  wouldCreateCycle,
  type Allergen,
  type AllergenProfile,
  type RecipeBook,
  type UnitCode,
} from '@mise/domain';
import type { Database, Executor } from '../../db/client.js';
import { recipeComponents, recipePhotos, recipes } from '../../db/schema.js';
import { lockRecipeGraph, recordAllergenChanges } from './allergenHistory.js';
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
/**
 * A sub-recipe measured in a kind of unit its yield can't be turned into:
 * millilitres of a sauce that makes kilos. With no density to go by, Mise
 * can't tell how much of the sauce that is, so the edit is refused.
 * `usedIn` is set when the yield being changed is what breaks it, for a
 * recipe that already uses this one.
 */
export interface UnitProblem {
  child: string;
  unit: string;
  makes: string;
  usedIn: string | null;
}

export type CreateRecipeResult =
  | { outcome: 'created'; recipe: StoredRecipe }
  | { outcome: 'cycle'; through: string[] }
  | { outcome: 'units'; problem: UnitProblem };

export type UpdateRecipeResult =
  | { outcome: 'updated'; recipe: StoredRecipe }
  | { outcome: 'cycle'; through: string[] }
  | { outcome: 'units'; problem: UnitProblem }
  | { outcome: 'changed' }
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

  /**
   * Every recipe as getRecipe gives it, in three queries instead of three per
   * recipe. Same orders, so what comes out is what one-by-one would give.
   */
  async function allRecipes() {
    const [rows, components, photos] = await Promise.all([
      db.select().from(recipes).orderBy(asc(recipes.name)),
      db
        .select()
        .from(recipeComponents)
        .orderBy(asc(recipeComponents.sortOrder), asc(recipeComponents.id)),
      db.select().from(recipePhotos).orderBy(asc(recipePhotos.createdAt)),
    ]);
    const componentsOf = new Map<string, typeof components>();
    for (const component of components) {
      const list = componentsOf.get(component.recipeId) ?? [];
      list.push(component);
      componentsOf.set(component.recipeId, list);
    }
    const photosOf = new Map<string, typeof photos>();
    for (const photo of photos) {
      const list = photosOf.get(photo.recipeId) ?? [];
      list.push(photo);
      photosOf.set(photo.recipeId, list);
    }
    return rows.map((row) => ({
      ...row,
      components: componentsOf.get(row.id) ?? [],
      photos: photosOf.get(row.id) ?? [],
    }));
  }

  async function getRecipe(id: string) {
    const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    if (!row) return null;

    const components = await db
      .select()
      .from(recipeComponents)
      .where(eq(recipeComponents.recipeId, id))
      .orderBy(asc(recipeComponents.sortOrder), asc(recipeComponents.id));

    const photos = await db
      .select()
      .from(recipePhotos)
      .where(eq(recipePhotos.recipeId, id))
      .orderBy(asc(recipePhotos.createdAt));

    return { ...row, components, photos };
  }

  /** Allergens for the whole tree beneath a recipe. */
  async function allergensFor(
    id: string,
    loaded?: Awaited<ReturnType<typeof loadRecipeBook>>,
  ): Promise<AllergenProfile> {
    const book = loaded ?? (await loadRecipeBook(db));
    const result = rollUpAllergens(id, book);
    // Never fewer allergens than are really in it: when the tree can't be
    // followed all the way down (a missing reference, a loop), that is an
    // error, not a shorter list.
    if (!result.ok) {
      throw new ApiError(
        422,
        'allergens_unknown',
        'The allergens of this recipe can’t be worked out: something in it is missing or refers back to itself. Check what goes into it in the editor.',
      );
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
    bookOf: () => Promise<RecipeBook> = () => loadRecipeBook(exec),
  ): Promise<string[] | null> {
    const children = components
      .filter((c) => c.ref.kind === 'recipe')
      .map((c) => (c.ref as { kind: 'recipe'; recipeId: string }).recipeId);
    if (children.length === 0) return null;

    const book = await bookOf();
    for (const childId of children) {
      if (wouldCreateCycle(recipeId, childId, book)) {
        const child = book.recipe(childId);
        return [book.recipe(recipeId)?.name ?? 'This recipe', child?.name ?? 'that recipe'];
      }
    }
    return null;
  }

  /**
   * Every sub-recipe line has to be in a unit its yield converts to, both for
   * the lines being saved and, when the yield changes, for every recipe that
   * already uses this one.
   */
  async function findUnitProblem(
    exec: Executor,
    recipeId: string,
    components: CreateRecipeComponent[] | undefined,
    newYield: { value: number; unit: string } | undefined,
    bookOf: () => Promise<RecipeBook> = () => loadRecipeBook(exec),
  ): Promise<UnitProblem | null> {
    // Nothing to check for an edit that touches no sub-recipe line and not the yield.
    const usesRecipes = (components ?? []).some((c) => c.ref.kind === 'recipe');
    if (!usesRecipes && !newYield) return null;
    const book = await bookOf();
    // Said in the units the chef typed, not the base units the maths uses.
    const childIds = (components ?? []).flatMap((c) =>
      c.ref.kind === 'recipe' ? [c.ref.recipeId] : [],
    );
    const enteredYield = new Map(
      childIds.length === 0
        ? []
        : (
            await exec
              .select({ id: recipes.id, unit: recipes.yieldUnit })
              .from(recipes)
              .where(inArray(recipes.id, childIds))
          ).map((row) => [row.id, row.unit]),
    );
    for (const component of components ?? []) {
      if (component.ref.kind !== 'recipe') continue;
      const child = book.recipe(component.ref.recipeId);
      if (!child) continue;
      const quantity = {
        value: component.quantity.value,
        unit: component.quantity.unit as UnitCode,
      };
      const fits = factorForYield(child, quantity);
      if (!fits.ok && fits.error.kind === 'incompatible_units') {
        return {
          child: child.name,
          unit: quantity.unit,
          makes: enteredYield.get(child.id) ?? child.yield.unit,
          usedIn: null,
        };
      }
    }

    const self = book.recipe(recipeId);
    if (!newYield || !self) return null;
    const changed = { ...self, yield: { value: newYield.value, unit: newYield.unit as UnitCode } };
    const uses = await exec
      .select({
        parent: recipes.name,
        value: recipeComponents.quantityEntered,
        unit: recipeComponents.unitEntered,
      })
      .from(recipeComponents)
      .innerJoin(recipes, eq(recipes.id, recipeComponents.recipeId))
      .where(eq(recipeComponents.childRecipeId, recipeId));
    for (const use of uses) {
      const fits = factorForYield(changed, { value: use.value, unit: use.unit as UnitCode });
      if (!fits.ok && fits.error.kind === 'incompatible_units') {
        return { child: self.name, unit: use.unit, makes: newYield.unit, usedIn: use.parent };
      }
    }
    return null;
  }

  /** Reads the book the first time it is asked for, so one save reads it at most once. */
  function readOnce(exec: Executor): () => Promise<RecipeBook> {
    let book: Promise<RecipeBook> | null = null;
    return () => (book ??= loadRecipeBook(exec));
  }

  /** One edit to the recipe graph at a time, so two can't make a loop together. */
  async function lockGraph(tx: Executor): Promise<void> {
    await lockRecipeGraph(tx);
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
      await lockGraph(tx);
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
          kept: input.kept ?? null,
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
          // Only a dish is sold.
          sellPrice: input.type === 'dish' ? (input.sellPrice ?? null) : null,
          createdBy,
        })
        .returning();
      if (!row) throw new Error('Insert returned no recipe');

      // A brand new recipe cannot close a loop through itself, but it can point
      // at one that already exists, so the same check runs.
      const bookOf = readOnce(tx);
      const cycle = await findCycleIn(tx, row.id, input.components, bookOf);
      if (cycle) {
        await tx.delete(recipes).where(eq(recipes.id, row.id));
        return { outcome: 'cycle', through: cycle };
      }
      const units = await findUnitProblem(tx, row.id, input.components, undefined, bookOf);
      if (units) {
        await tx.delete(recipes).where(eq(recipes.id, row.id));
        return { outcome: 'units', problem: units };
      }

      await replaceComponents(tx, row.id, input.components);
      await recordAllergenChanges(tx, { name: row.name, recipeId: row.id, userId: createdBy });
      return { outcome: 'created', recipe: row };
    });
  }

  /**
   * unchanged says whether the edit started from the recipe as it is now; it
   * is asked under the row's lock, in the save itself, so two edits from the
   * same version can't both go through.
   */
  async function updateRecipe(
    id: string,
    input: UpdateRecipe,
    unchanged: (updatedAt: Date) => boolean = () => true,
    changedBy: string | null = null,
  ): Promise<UpdateRecipeResult> {
    const existing = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1);
    if (existing.length === 0) return { outcome: 'not_found' };

    return db.transaction(async (tx) => {
      // Checked inside the save, one save at a time: two edits at once can't
      // slip a loop or a broken unit past each other.
      await lockGraph(tx);
      const [locked] = await tx
        .select({ updatedAt: recipes.updatedAt })
        .from(recipes)
        .where(eq(recipes.id, id))
        .for('update');
      if (!locked) return { outcome: 'not_found' as const };
      if (!unchanged(locked.updatedAt)) return { outcome: 'changed' as const };
      const bookOf = readOnce(tx);
      if (input.components) {
        const cycle = await findCycleIn(tx, id, input.components, bookOf);
        if (cycle) return { outcome: 'cycle' as const, through: cycle };
      }
      const units = await findUnitProblem(tx, id, input.components, input.yield, bookOf);
      if (units) return { outcome: 'units' as const, problem: units };

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
          ...(input.kept !== undefined ? { kept: input.kept } : {}),
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
          ...(input.sellPrice !== undefined ? { sellPrice: input.sellPrice } : {}),
          version: sql`${recipes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(recipes.id, id))
        .returning();

      if (input.components) await replaceComponents(tx, id, input.components);
      // Its own allergens, a new type, new lines: whatever it is in may now
      // declare something else. Nothing changed means no new line.
      await recordAllergenChanges(tx, { name: row!.name, recipeId: id, userId: changedBy });
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
  async function duplicateRecipe(id: string, name: string, copiedBy: string | null = null) {
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
          kept: source.kept,
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
          sellPrice: source.sellPrice,
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
      await recordAllergenChanges(tx, { name: copy.name, recipeId: copy.id, userId: copiedBy });
      return copy;
    });
  }

  /** Which recipes use this one, so deleting it can say what would break. */
  async function usedBy(id: string) {
    return (
      db
        .select({ id: recipes.id, name: recipes.name })
        .from(recipeComponents)
        .innerJoin(recipes, eq(recipes.id, recipeComponents.recipeId))
        .where(eq(recipeComponents.childRecipeId, id))
        // The order the recipe book lists them in, and the order a tablet works
        // the list out in offline, so the page reads the same either way.
        .orderBy(asc(recipes.name), asc(recipeComponents.sortOrder), asc(recipeComponents.id))
    );
  }

  /**
   * Recipes that can't be called free from an allergen: they contain it or may
   * contain it anywhere in their tree, or their allergens can't be worked out.
   * "Free from" is what someone with the allergy is shown, so doubt counts.
   */
  async function idsWithAllergen(allergen: Allergen): Promise<Set<string>> {
    const book = await loadRecipeBook(db);
    const all = await db.select({ id: recipes.id }).from(recipes);
    const matching = new Set<string>();
    for (const { id } of all) {
      const profile = rollUpAllergens(id, book);
      if (
        !profile.ok ||
        profile.value.contains.includes(allergen) ||
        profile.value.mayContain.includes(allergen)
      )
        matching.add(id);
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
    allRecipes,
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
