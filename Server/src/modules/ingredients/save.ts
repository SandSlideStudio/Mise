import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import type { IngredientPriceInput, LastLabelCheck, UpdateIngredient } from '@mise/contracts';
import { isAllergen, type Allergen } from '@mise/domain';
import type { Executor, Transaction } from '../../db/client.js';
import { ingredientLabelChecks, ingredients, users } from '../../db/schema.js';
import { recordAllergenChanges, type AllergenCause } from '../recipes/allergenHistory.js';

/**
 * Saving a change to an ingredient. An edit in the editor and a label check
 * at delivery go through the same few lines, so both leave the same trace:
 * the same version bump, the same entry in every dish's allergen record.
 */

export type IngredientRow = typeof ingredients.$inferSelect;

/** The columns a price is kept in; null clears it. */
export function priceColumns(price: IngredientPriceInput | null) {
  return {
    price: price?.amount ?? null,
    purchaseQuantity: price?.quantity.value ?? null,
    purchaseUnit: price?.quantity.unit ?? null,
  };
}

export function samePrice(row: IngredientRow, price: IngredientPriceInput | null): boolean {
  const next = priceColumns(price);
  return (
    row.price === next.price &&
    row.purchaseQuantity === next.purchaseQuantity &&
    row.purchaseUnit === next.purchaseUnit
  );
}

/**
 * A "may contain" next to a "contains" of the same allergen says nothing the
 * label doesn't already say louder, so it isn't kept.
 */
export function tracesOnly(mayContain: Allergen[], contains: readonly Allergen[]): Allergen[] {
  return mayContain.filter((allergen) => !contains.includes(allergen));
}

/**
 * Whether an edit changes anything but the price, comparing with what is
 * stored the way the editor sends it. When unsure, it counts as a change.
 */
function changesMoreThanPrice(row: IngredientRow, body: UpdateIngredient): boolean {
  const stored: Record<string, unknown> = {
    name: row.name,
    category: row.category,
    baseUnit: row.baseUnit,
    allergens: row.allergens,
    mayContain: row.mayContain,
    vegan: row.vegan,
    allergenDetails: {
      gluten: row.allergenDetails.gluten ?? [],
      nuts: row.allergenDetails.nuts ?? [],
    },
    notes: row.notes,
    densityGPerMl: row.densityGPerMl,
    itemWeightG: row.itemWeightG,
    yieldPercent: row.yieldPercent,
  };
  return Object.entries(body).some(
    ([key, value]) =>
      key !== 'price' &&
      key !== 'priceBase' &&
      value !== undefined &&
      JSON.stringify(value) !== JSON.stringify(stored[key]),
  );
}

/**
 * Whether an edit would put its price over one someone changed after the
 * editor loaded it. Only for an edit that says which price it saw; the same
 * price sent again changes nothing, so it is never in the way.
 */
export function priceChangedSince(row: IngredientRow, body: UpdateIngredient): boolean {
  if (body.price === undefined || body.priceBase === undefined) return false;
  if (samePrice(row, body.price)) return false;
  const seen = body.priceBase === null ? null : Date.parse(body.priceBase);
  return (row.priceUpdatedAt?.getTime() ?? null) !== seen;
}

/**
 * Write the change to a row the caller holds locked, and add a line to the
 * allergen record of every dish it reaches. Run inside the caller's
 * transaction, so a refused check made under the lock writes nothing.
 * cause.name defaults to the ingredient's name.
 */
export async function applyIngredientEdit(
  tx: Transaction,
  locked: IngredientRow,
  body: UpdateIngredient,
  cause: AllergenCause,
): Promise<IngredientRow | null> {
  const { mayContain, price, priceBase: _seen, ...rest } = body;
  const priceChanged = price !== undefined && !samePrice(locked, price);
  const [row] = await tx
    .update(ingredients)
    .set({
      ...rest,
      ...(priceChanged ? { ...priceColumns(price), priceUpdatedAt: new Date() } : {}),
      // Saved either way when either list changed, so the two never overlap.
      ...(mayContain !== undefined || rest.allergens !== undefined
        ? {
            mayContain: tracesOnly(
              mayContain ?? locked.mayContain.filter(isAllergen),
              rest.allergens ?? locked.allergens.filter(isAllergen),
            ),
          }
        : {}),
      // A new price changes nothing a dish card says, so a price alone
      // keeps the version: menus would otherwise ask for every card to be
      // printed again each time an invoice comes in.
      ...(changesMoreThanPrice(locked, body) ? { updatedAt: new Date() } : {}),
    })
    .where(eq(ingredients.id, locked.id))
    .returning();
  if (!row) return null;
  // Every dish it goes into, however deep, gets a line in its allergen record.
  await recordAllergenChanges(tx, { ...cause, name: cause.name ?? row.name });
  return row;
}

/**
 * When each ingredient's label was last read, and by whom. A rejected check
 * doesn't count: the chef said the label wasn't read right.
 */
export async function lastLabelChecks(
  exec: Executor,
  ingredientIds?: string[],
): Promise<Map<string, LastLabelCheck>> {
  if (ingredientIds && ingredientIds.length === 0) return new Map();
  const only = ingredientIds
    ? inArray(ingredientLabelChecks.ingredientId, ingredientIds)
    : undefined;
  const [latest, waiting] = await Promise.all([
    exec
      .selectDistinctOn([ingredientLabelChecks.ingredientId], {
        ingredientId: ingredientLabelChecks.ingredientId,
        checkedAt: ingredientLabelChecks.checkedAt,
        checkedBy: users.displayName,
      })
      .from(ingredientLabelChecks)
      .leftJoin(users, eq(users.id, ingredientLabelChecks.checkedBy))
      .where(and(ne(ingredientLabelChecks.status, 'rejected'), only))
      .orderBy(ingredientLabelChecks.ingredientId, desc(ingredientLabelChecks.checkedAt)),
    exec
      .selectDistinct({ ingredientId: ingredientLabelChecks.ingredientId })
      .from(ingredientLabelChecks)
      .where(and(eq(ingredientLabelChecks.status, 'pending'), only)),
  ]);
  const pending = new Set(waiting.map((row) => row.ingredientId));
  return new Map(
    latest.map((row) => [
      row.ingredientId,
      {
        at: row.checkedAt.toISOString(),
        by: row.checkedBy ?? null,
        pending: pending.has(row.ingredientId),
      },
    ]),
  );
}
