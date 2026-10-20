import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { explodeService, isUnitCode, type PrepTaskDraft } from '@mise/domain';
import type { Database } from '../../db/client.js';
import { prepTasks, recipes, serviceDishes, services, type PrepTaskRow } from '../../db/schema.js';
import { loadRecipeBook } from '../recipes/book.js';

/**
 * Turns a service's dishes into a prep list, merging into the list that's there.
 *
 * Generating again never loses work. Lines added by hand aren't generated and
 * aren't touched. Lines that are done, skipped, being made, or that a chef has
 * edited are kept as they are. Other generated lines get their amounts brought
 * up to date, and ones no longer needed are removed.
 */

/** Lines a regeneration leaves exactly as they are. */
function settled(task: PrepTaskRow): boolean {
  return (
    task.status === 'done' ||
    task.status === 'skipped' ||
    task.status === 'in_progress' ||
    task.editedAt !== null
  );
}

export interface GenerateOutcome {
  created: number;
  updated: number;
  removed: number;
  kept: number;
}

export type GenerateFailure = { kind: 'no_dishes' } | { kind: 'explode_failed'; message: string };

/**
 * What a generated line says on the list.
 *
 * Just the name. The quantity travels in its own column, the same as it does
 * for a hand-added task, and the list renders it in front of the description.
 * Putting it in both places prints it twice.
 */
function describe(draft: PrepTaskDraft): string {
  return draft.name;
}

export function createGenerator(db: Database) {
  async function generate(
    serviceId: string,
  ): Promise<{ ok: true; outcome: GenerateOutcome } | { ok: false; error: GenerateFailure }> {
    const dishes = await db
      .select({ recipeId: serviceDishes.recipeId, portions: serviceDishes.plannedPortions })
      .from(serviceDishes)
      .where(eq(serviceDishes.serviceId, serviceId));

    if (dishes.length === 0) return { ok: false, error: { kind: 'no_dishes' } };

    const book = await loadRecipeBook(db);
    const exploded = explodeService(
      dishes.map((dish) => ({ recipeId: dish.recipeId, portions: dish.portions })),
      book,
    );
    if (!exploded.ok) {
      return { ok: false, error: { kind: 'explode_failed', message: explain(exploded.error) } };
    }

    const drafts = exploded.value;

    // One transaction, and one generate per service at a time: two people
    // pressing the button together get one list, not half of each.
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${serviceId}))`);

      const existing = await tx
        .select()
        .from(prepTasks)
        .where(and(eq(prepTasks.serviceId, serviceId), isNotNull(prepTasks.generationKey)));

      const byKey = new Map(existing.map((task) => [task.generationKey!, task]));
      const outcome: GenerateOutcome = { created: 0, updated: 0, removed: 0, kept: 0 };

      for (const [index, draft] of drafts.entries()) {
        const current = byKey.get(draft.key);
        const baseUnit = isUnitCode(draft.quantity.unit) ? draft.quantity.unit : 'g';

        if (!current) {
          await tx.insert(prepTasks).values({
            serviceId,
            stationId: draft.stationId,
            kind: draft.kind,
            sourceRecipeId: draft.kind === 'recipe' ? draft.sourceId : null,
            sourceIngredientId: draft.kind === 'ingredient' ? draft.sourceId : null,
            generationKey: draft.key,
            description: describe(draft),
            quantityBase: draft.quantity.value,
            quantityUnit: baseUnit,
            source: 'generated',
            status: 'open',
            notes: draft.notes,
            usedBy: draft.usedBy.map((use) => ({
              recipeId: use.recipeId,
              recipeName: use.recipeName,
              quantity: use.quantity,
            })),
            sortOrder: index,
          });
          outcome.created += 1;
          continue;
        }

        if (settled(current)) {
          outcome.kept += 1;
          continue;
        }

        await tx
          .update(prepTasks)
          .set({
            stationId: draft.stationId,
            description: describe(draft),
            quantityBase: draft.quantity.value,
            quantityUnit: baseUnit,
            notes: draft.notes,
            usedBy: draft.usedBy.map((use) => ({
              recipeId: use.recipeId,
              recipeName: use.recipeName,
              quantity: use.quantity,
            })),
            sortOrder: index,
            updatedAt: new Date(),
          })
          .where(eq(prepTasks.id, current.id));
        outcome.updated += 1;
      }

      const wanted = new Set(drafts.map((draft) => draft.key));
      const stale = existing.filter((task) => !wanted.has(task.generationKey!) && !settled(task));
      if (stale.length > 0) {
        await tx.delete(prepTasks).where(
          inArray(
            prepTasks.id,
            stale.map((task) => task.id),
          ),
        );
        outcome.removed = stale.length;
      }
      outcome.kept += existing.filter(
        (task) => !wanted.has(task.generationKey!) && settled(task),
      ).length;

      await tx
        .update(services)
        .set({ generatedAt: new Date(), updatedAt: new Date() })
        .where(eq(services.id, serviceId));

      return { ok: true as const, outcome };
    });
  }

  /** Dish names, so a service can list what is on without a second call. */
  // Asked for by every tablet after every tick, so prepared once.
  const dishesWithNamesQuery = db
    .select({
      id: serviceDishes.id,
      recipeId: serviceDishes.recipeId,
      recipeName: recipes.name,
      plannedPortions: serviceDishes.plannedPortions,
    })
    .from(serviceDishes)
    .innerJoin(recipes, eq(recipes.id, serviceDishes.recipeId))
    .where(eq(serviceDishes.serviceId, sql.placeholder('serviceId')))
    .prepare('dishes_with_names');

  async function dishesWithNames(serviceId: string) {
    return dishesWithNamesQuery.execute({ serviceId });
  }

  return { generate, dishesWithNames };
}

/** Domain failures, said in a way that points at what to fix. */
function explain(error: { kind: string } & Record<string, unknown>): string {
  switch (error.kind) {
    case 'no_portions':
      return 'One of these dishes has no portion count, so it cannot be scaled to covers. Set portions on the recipe.';
    case 'cycle':
      return 'One of these recipes contains itself, so the list cannot be worked out.';
    case 'missing_recipe':
      return 'A recipe on this service no longer exists.';
    case 'missing_ingredient':
      return 'An ingredient used by one of these recipes no longer exists.';
    case 'incompatible_units':
      return 'A sub-recipe is measured in different units from what it makes. Fix the recipe and try again.';
    default:
      return 'That prep list could not be worked out.';
  }
}
