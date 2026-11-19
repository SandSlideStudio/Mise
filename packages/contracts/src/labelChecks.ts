import { z } from 'zod';
import { allergenSchema, idSchema } from './common.js';

/**
 * Checking an ingredient's label at delivery.
 *
 * The usual allergen mistake is not a chef forgetting: it is a supplier
 * changing a product, a new label at the back door, and nothing reaching the
 * menu. So whoever takes the delivery reads the label against what Mise has,
 * and the check is kept, "no change" included.
 */

/**
 * How a dish's allergen record names a change that came from a label check:
 * this, then the ingredient's name. Kept as plain words so the record reads
 * on its own; screens recognise it and say it in their own language.
 */
export const LABEL_CHECK_CAUSE = 'label check: ';

/** applied: Mise has what the label says. pending: a cook's change, waiting for a chef. */
export const labelCheckStatusSchema = z.enum(['applied', 'pending', 'rejected']);

export const labelAllergensSchema = z.object({
  allergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
});

export const labelCheckSchema = z.object({
  id: idSchema,
  ingredientId: idSchema,
  ingredientName: z.string(),
  checkedAt: z.string(),
  /** Who read the label, by name; null once they are removed for good. */
  checkedBy: z.string().nullable(),
  /** Whether the label said something other than Mise had. */
  changed: z.boolean(),
  before: labelAllergensSchema,
  after: labelAllergensSchema,
  note: z.string().nullable(),
  status: labelCheckStatusSchema,
});

/** What the label says. The same as what Mise has is a "no change", and is kept as one. */
export const createLabelCheckSchema = z.object({
  allergens: z.array(allergenSchema),
  mayContain: z.array(allergenSchema),
  note: z.string().trim().max(200).nullable().optional(),
  /**
   * When the label was read, for a check made offline and sent later. The
   * server keeps it only within the last week and never in the future.
   */
  checkedAt: z.iso.datetime({ offset: true }).optional(),
  /**
   * What Mise had when the label was read against it. A check sent later
   * (offline, or from a page left open) may find the ingredient changed by
   * someone else since; then it is not applied over their change but waits
   * for a chef. Left out, the check is compared with the ingredient as it is.
   */
  base: labelAllergensSchema.optional(),
});

/** The last time an ingredient's label was read, for its line in the list. */
export const lastLabelCheckSchema = z.object({
  at: z.string(),
  by: z.string().nullable(),
  /** A cook's change still waiting for a chef. */
  pending: z.boolean(),
});

export type LabelCheckStatus = z.infer<typeof labelCheckStatusSchema>;
export type LabelAllergens = z.infer<typeof labelAllergensSchema>;
export type LabelCheck = z.infer<typeof labelCheckSchema>;
export type CreateLabelCheck = z.infer<typeof createLabelCheckSchema>;
export type LastLabelCheck = z.infer<typeof lastLabelCheckSchema>;
