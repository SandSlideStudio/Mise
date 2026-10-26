import { asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { CreateMenu, Menu, MenuOverview, UpdateMenu } from '@mise/contracts';
import { COURSES, dishCardMatrix } from '@mise/domain';
import type { Database, Executor } from '../../db/client.js';
import {
  ingredients,
  kitchens,
  menuDishes,
  menus,
  recipeComponents,
  recipes,
} from '../../db/schema.js';
import { loadRecipeBook } from '../recipes/book.js';
import { createDishCardService, serialiseSettings } from '../dishcards/service.js';

/**
 * Menus.
 *
 * A menu is a name and an ordered list of dishes. Everything it prints, the
 * allergen overview and the dish cards, is worked out from the recipes at the
 * moment it is asked for, so a menu can never show yesterday's allergens.
 */

type StoredMenu = typeof menus.$inferSelect;

export type MenuFailure =
  | { kind: 'not_found' }
  | { kind: 'duplicate_name' }
  | { kind: 'not_dishes'; names: string[] }
  | { kind: 'broken'; names: string[] };

/** Course order, then the chef's own order; dishes with no course come last. */
function courseRank(course: string | null): number {
  const index = course ? COURSES.indexOf(course as (typeof COURSES)[number]) : -1;
  return index === -1 ? COURSES.length : index;
}

export function createMenusService(db: Database) {
  const dishCards = createDishCardService(db);

  async function nameTaken(name: string, exceptId: string | null): Promise<boolean> {
    const rows = await db
      .select({ id: menus.id })
      .from(menus)
      .where(sql`lower(${menus.name}) = lower(${name})`);
    return rows.some((row) => row.id !== exceptId);
  }

  /** Every id must be a dish in the book; returns the names of any that are not. */
  async function checkDishes(ids: string[]): Promise<string[] | null> {
    if (ids.length === 0) return null;
    const rows = await db
      .select({ id: recipes.id, name: recipes.name, type: recipes.type })
      .from(recipes)
      .where(inArray(recipes.id, ids));
    const found = new Map(rows.map((row) => [row.id, row]));
    const wrong = ids.filter((id) => found.get(id)?.type !== 'dish');
    return wrong.length > 0 ? wrong.map((id) => found.get(id)?.name ?? id) : null;
  }

  async function replaceDishes(exec: Executor, menuId: string, ids: string[]) {
    await exec.delete(menuDishes).where(eq(menuDishes.menuId, menuId));
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    await exec
      .insert(menuDishes)
      .values(unique.map((recipeId, sortOrder) => ({ menuId, recipeId, sortOrder })));
  }

  async function listMenus() {
    const rows = await db
      .select({
        id: menus.id,
        name: menus.name,
        description: menus.description,
        status: menus.status,
        updatedAt: menus.updatedAt,
        dishCount: count(menuDishes.id),
      })
      .from(menus)
      .leftJoin(menuDishes, eq(menuDishes.menuId, menus.id))
      .groupBy(menus.id)
      .orderBy(asc(menus.name));
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
  }

  /** The dishes on a menu, in menu order, with what the recipes say about them now. */
  async function dishesOf(menuId: string) {
    const rows = await db
      .select({
        recipeId: menuDishes.recipeId,
        sortOrder: menuDishes.sortOrder,
        name: recipes.name,
        course: recipes.course,
        status: recipes.status,
      })
      .from(menuDishes)
      .innerJoin(recipes, eq(recipes.id, menuDishes.recipeId))
      .where(eq(menuDishes.menuId, menuId));
    return rows.sort(
      (a, b) => courseRank(a.course) - courseRank(b.course) || a.sortOrder - b.sortOrder,
    );
  }

  /**
   * When each dish last changed, counting everything a card is drawn from:
   * the dish, its sub-recipes all the way down, and their ingredients.
   */
  async function lastChanged(dishIds: string[]): Promise<Map<string, Date>> {
    const result = new Map<string, Date>();
    if (dishIds.length === 0) return result;
    const [recipeRows, componentRows, ingredientRows] = await Promise.all([
      db.select({ id: recipes.id, updatedAt: recipes.updatedAt }).from(recipes),
      db
        .select({
          recipeId: recipeComponents.recipeId,
          childRecipeId: recipeComponents.childRecipeId,
          ingredientId: recipeComponents.ingredientId,
        })
        .from(recipeComponents),
      db.select({ id: ingredients.id, updatedAt: ingredients.updatedAt }).from(ingredients),
    ]);
    const recipeTime = new Map(recipeRows.map((row) => [row.id, row.updatedAt]));
    const ingredientTime = new Map(ingredientRows.map((row) => [row.id, row.updatedAt]));
    const children = new Map<string, typeof componentRows>();
    for (const row of componentRows) {
      const list = children.get(row.recipeId) ?? [];
      list.push(row);
      children.set(row.recipeId, list);
    }

    for (const dishId of dishIds) {
      let latest = recipeTime.get(dishId) ?? new Date(0);
      const seen = new Set<string>();
      const stack = [dishId];
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const time = recipeTime.get(id);
        if (time && time > latest) latest = time;
        for (const component of children.get(id) ?? []) {
          if (component.childRecipeId) stack.push(component.childRecipeId);
          const ingredient = component.ingredientId && ingredientTime.get(component.ingredientId);
          if (ingredient && ingredient > latest) latest = ingredient;
        }
      }
      result.set(dishId, latest);
    }
    return result;
  }

  async function serialise(row: StoredMenu): Promise<Menu> {
    const dishes = await dishesOf(row.id);
    const changed = await lastChanged(dishes.map((dish) => dish.recipeId));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      dishCount: dishes.length,
      updatedAt: row.updatedAt.toISOString(),
      cardsPrintedAt: row.cardsPrintedAt?.toISOString() ?? null,
      dishes: dishes.map((dish) => ({
        recipeId: dish.recipeId,
        name: dish.name,
        course: dish.course,
        status: dish.status,
        // Never printed counts as changed: every card still needs printing.
        changedSinceCards:
          row.cardsPrintedAt === null ||
          (changed.get(dish.recipeId) ?? new Date(0)) > row.cardsPrintedAt,
      })),
    };
  }

  async function row(id: string) {
    const [found] = await db.select().from(menus).where(eq(menus.id, id)).limit(1);
    return found ?? null;
  }

  async function getMenu(id: string): Promise<Menu | null> {
    const found = await row(id);
    return found ? serialise(found) : null;
  }

  async function createMenu(
    input: CreateMenu,
  ): Promise<{ ok: true; menu: Menu } | { ok: false; error: MenuFailure }> {
    if (await nameTaken(input.name, null)) return { ok: false, error: { kind: 'duplicate_name' } };
    const wrong = await checkDishes(input.dishes);
    if (wrong) return { ok: false, error: { kind: 'not_dishes', names: wrong } };

    const created = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(menus)
        .values({ name: input.name, description: input.description || null, status: input.status })
        .returning();
      await replaceDishes(tx, inserted!.id, input.dishes);
      return inserted!;
    });
    return { ok: true, menu: await serialise(created) };
  }

  async function updateMenu(
    id: string,
    input: UpdateMenu,
  ): Promise<{ ok: true; menu: Menu } | { ok: false; error: MenuFailure }> {
    const existing = await row(id);
    if (!existing) return { ok: false, error: { kind: 'not_found' } };
    if (input.name !== undefined && (await nameTaken(input.name, id))) {
      return { ok: false, error: { kind: 'duplicate_name' } };
    }
    if (input.dishes) {
      const wrong = await checkDishes(input.dishes);
      if (wrong) return { ok: false, error: { kind: 'not_dishes', names: wrong } };
    }

    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx
        .update(menus)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(menus.id, id))
        .returning();
      if (input.dishes) await replaceDishes(tx, id, input.dishes);
      return changed!;
    });
    return { ok: true, menu: await serialise(updated) };
  }

  async function deleteMenu(id: string): Promise<boolean> {
    const removed = await db.delete(menus).where(eq(menus.id, id)).returning({ id: menus.id });
    return removed.length > 0;
  }

  /** A new season usually starts from the last one. The copy starts as a draft. */
  async function duplicateMenu(id: string, name: string) {
    const source = await row(id);
    if (!source) return { ok: false as const, error: { kind: 'not_found' } as MenuFailure };
    const dishes = await dishesOf(id);
    return createMenu({
      name,
      description: source.description,
      status: 'draft',
      dishes: dishes.map((dish) => dish.recipeId),
    });
  }

  async function markCardsPrinted(id: string): Promise<Menu | null> {
    const [updated] = await db
      .update(menus)
      .set({ cardsPrintedAt: new Date() })
      .where(eq(menus.id, id))
      .returning();
    return updated ? serialise(updated) : null;
  }

  /**
   * The allergen overview: every dish on the menu with everything it contains,
   * worked out now. A dish whose allergens can't be worked out stops the
   * overview rather than appearing on it with a guess.
   */
  async function overview(
    id: string,
  ): Promise<{ ok: true; overview: MenuOverview } | { ok: false; error: MenuFailure }> {
    const found = await row(id);
    if (!found) return { ok: false, error: { kind: 'not_found' } };
    const dishes = await dishesOf(id);
    const book = await loadRecipeBook(db);

    const broken: string[] = [];
    const rows: MenuOverview['dishes'] = [];
    for (const dish of dishes) {
      const matrix = dishCardMatrix(dish.recipeId, book);
      if (!matrix.ok) {
        broken.push(dish.name);
        continue;
      }
      const whole = matrix.value.dish;
      rows.push({
        recipeId: dish.recipeId,
        name: dish.name,
        course: dish.course,
        contains: whole.allergens.contains,
        mayContain: whole.allergens.mayContain,
        vegan: whole.vegan,
        gluten: whole.details.gluten,
        nuts: whole.details.nuts,
      });
    }
    if (broken.length > 0) return { ok: false, error: { kind: 'broken', names: broken } };

    const [kitchen] = await db.select({ name: kitchens.name }).from(kitchens).limit(1);
    return {
      ok: true,
      overview: {
        kitchenName: kitchen?.name ?? 'Mise',
        menu: { id: found.id, name: found.name, description: found.description },
        dishes: rows,
        settings: serialiseSettings(await dishCards.settings()),
      },
    };
  }

  return {
    listMenus,
    getMenu,
    createMenu,
    updateMenu,
    deleteMenu,
    duplicateMenu,
    markCardsPrinted,
    overview,
  };
}

export type MenusService = ReturnType<typeof createMenusService>;
