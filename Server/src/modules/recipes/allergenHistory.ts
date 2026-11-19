import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { AllergenChange } from '@mise/contracts';
import { isAllergen, rollUpAllergens, type Allergen } from '@mise/domain';
import type { Executor } from '../../db/client.js';
import { dishAllergenChanges, recipes, users } from '../../db/schema.js';
import { loadRecipeBook } from './book.js';

/**
 * The written record of each dish's allergens.
 *
 * Dutch and EU rules let front of house tell guests about allergens by word of
 * mouth only if it is also on paper or a screen, for staff and the inspector,
 * and right. A record of when each dish's allergens last changed, and why,
 * is what lets a kitchen show that it is.
 *
 * Every write that can change a dish's allergens calls recordAllergenChanges
 * once, in its own transaction. It works the whole book out again and adds a
 * row for each dish whose allergens are no longer what its last row says. That
 * is one read of the book per write whatever the number of dishes, and
 * nothing has to know which dishes a change deep in a sub-recipe reaches.
 */

/** What the write was, for the rows it causes. */
export interface AllergenCause {
  /** The name of the ingredient or recipe that was changed. */
  name?: string | null;
  /** The recipe that was changed, so a dish changed directly gets no cause. */
  recipeId?: string | null;
  /** Who made the change. */
  userId?: string | null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Add a row for every dish whose allergens changed, and the first row for a
 * dish that has none. Returns how many rows were added. A dish whose
 * allergens can't be worked out (a missing part, a loop) is left until they
 * can: a guess is worse than no row.
 */
export async function recordAllergenChanges(
  exec: Executor,
  cause: AllergenCause = {},
): Promise<number> {
  // The same lock as edits to the recipe graph: two writes at once take turns
  // here, so the second sees the first one's rows and doesn't add them again.
  await exec.execute(sql`select pg_advisory_xact_lock(hashtext('mise-recipe-graph'))`);

  const [book, dishes, latest] = await Promise.all([
    loadRecipeBook(exec),
    exec.select({ id: recipes.id }).from(recipes).where(eq(recipes.type, 'dish')),
    exec
      .selectDistinctOn([dishAllergenChanges.recipeId], {
        recipeId: dishAllergenChanges.recipeId,
        contains: dishAllergenChanges.contains,
        mayContain: dishAllergenChanges.mayContain,
      })
      .from(dishAllergenChanges)
      .orderBy(dishAllergenChanges.recipeId, desc(dishAllergenChanges.changedAt)),
  ]);
  const last = new Map(latest.map((row) => [row.recipeId, row]));

  const changedAt = new Date();
  const rows: (typeof dishAllergenChanges.$inferInsert)[] = [];
  for (const { id } of dishes) {
    const profile = rollUpAllergens(id, book);
    if (!profile.ok) continue;
    const before = last.get(id);
    const { contains, mayContain } = profile.value;
    if (before && sameList(before.contains, contains) && sameList(before.mayContain, mayContain))
      continue;
    rows.push({
      recipeId: id,
      changedAt,
      contains,
      mayContain,
      // The first row is where the record starts, not a change anything caused.
      cause: before && cause.recipeId !== id ? (cause.name ?? null) : null,
      changedBy: cause.userId ?? null,
    });
  }
  if (rows.length > 0) await exec.insert(dishAllergenChanges).values(rows);
  return rows.length;
}

function allergens(values: string[]): Allergen[] {
  return values.filter(isAllergen);
}

/** A dish's record, newest first, with who made each change by name. */
export async function allergenHistory(exec: Executor, recipeId: string): Promise<AllergenChange[]> {
  const found = await historyOf(exec, [recipeId]);
  return found.get(recipeId) ?? [];
}

/** The records of several dishes at once, or of every dish when none are named. */
export async function historyOf(
  exec: Executor,
  recipeIds?: string[],
): Promise<Map<string, AllergenChange[]>> {
  if (recipeIds && recipeIds.length === 0) return new Map();
  const rows = await exec
    .select({
      id: dishAllergenChanges.id,
      recipeId: dishAllergenChanges.recipeId,
      changedAt: dishAllergenChanges.changedAt,
      contains: dishAllergenChanges.contains,
      mayContain: dishAllergenChanges.mayContain,
      cause: dishAllergenChanges.cause,
      changedBy: users.displayName,
    })
    .from(dishAllergenChanges)
    .leftJoin(users, eq(users.id, dishAllergenChanges.changedBy))
    .where(recipeIds ? inArray(dishAllergenChanges.recipeId, recipeIds) : undefined)
    .orderBy(desc(dishAllergenChanges.changedAt), desc(dishAllergenChanges.id));

  const byDish = new Map<string, AllergenChange[]>();
  for (const row of rows) {
    const list = byDish.get(row.recipeId) ?? [];
    list.push({
      id: row.id,
      changedAt: row.changedAt.toISOString(),
      contains: allergens(row.contains),
      mayContain: allergens(row.mayContain),
      cause: row.cause,
      changedBy: row.changedBy ?? null,
    });
    byDish.set(row.recipeId, list);
  }
  return byDish;
}

/** When the allergens of any of these dishes last changed: what a menu's overview is as of. */
export async function allergensAsOf(exec: Executor, recipeIds: string[]): Promise<string | null> {
  if (recipeIds.length === 0) return null;
  const [row] = await exec
    .select({ at: sql<Date | string | null>`max(${dishAllergenChanges.changedAt})` })
    .from(dishAllergenChanges)
    .where(inArray(dishAllergenChanges.recipeId, recipeIds));
  if (!row?.at) return null;
  return new Date(row.at).toISOString();
}
