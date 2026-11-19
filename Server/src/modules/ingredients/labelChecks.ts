import { asc, desc, eq, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  LABEL_CHECK_CAUSE,
  createLabelCheckSchema,
  errorSchema,
  idSchema,
  labelCheckSchema,
  type LabelAllergens,
  type LabelCheck,
  type UpdateIngredient,
} from '@mise/contracts';
import { isAllergen, mergeAllergens, type Allergen } from '@mise/domain';
import type { Executor, Transaction } from '../../db/client.js';
import { ingredientLabelChecks, ingredients, users } from '../../db/schema.js';
import { ApiError } from '../../lib/errors.js';
import { MANAGERS } from '../../plugins/auth.js';
import { lockRecipeGraph } from '../recipes/allergenHistory.js';
import { applyIngredientEdit, tracesOnly, type IngredientRow } from './save.js';

/**
 * Checking an ingredient's label at delivery.
 *
 * Anyone signed in may check a label: whoever takes the delivery. What
 * happens with a difference follows who may edit ingredients. A chef's check
 * is applied at once; a cook's is kept as a change waiting for a chef, who
 * approves or rejects it here. Either way the check itself is kept, and a
 * "no change" too: that the label was looked at is worth showing.
 *
 * Applying goes through the same save as an edit in the editor, so every
 * dish the ingredient reaches gets a line in its allergen record, with the
 * label check as its cause.
 *
 * A check carries what Mise had when the label was read (its base). If
 * someone changed the ingredient's allergens since, a check sent later must
 * not undo that: a "no change" changes nothing, and a difference waits for a
 * chef, shown against the ingredient as it is now, even when a chef sent it.
 * Approving refuses once the ingredient changed after the check came in, so
 * what the chef approves is what they saw.
 */

/** A check made offline and sent later keeps its time, within the week the device keeps it. */
const OFFLINE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function checkedAtFrom(sent: string | undefined): Date {
  const now = Date.now();
  if (!sent) return new Date(now);
  const at = Date.parse(sent);
  if (Number.isNaN(at) || at > now || at < now - OFFLINE_WEEK_MS) return new Date(now);
  return new Date(at);
}

/** In declaration order, and no trace of what it contains anyway. */
function asLabel(allergens: readonly string[], mayContain: readonly string[]): LabelAllergens {
  const contains = mergeAllergens(allergens.filter(isAllergen));
  return {
    allergens: contains,
    mayContain: mergeAllergens(tracesOnly(mayContain.filter(isAllergen), contains)),
  };
}

function sameLabel(a: LabelAllergens, b: LabelAllergens): boolean {
  const same = (x: readonly string[], y: readonly string[]) =>
    x.length === y.length && x.every((value) => y.includes(value));
  return same(a.allergens, b.allergens) && same(a.mayContain, b.mayContain);
}

/**
 * Put what the label says on the ingredient. Which cereals or nuts were named
 * goes with an allergen the label no longer has, as the editor does it.
 */
async function applyLabel(
  tx: Transaction,
  locked: IngredientRow,
  label: LabelAllergens,
  userId: string | null,
): Promise<void> {
  const edit: UpdateIngredient = { allergens: label.allergens, mayContain: label.mayContain };
  const details = locked.allergenDetails;
  const dropped = (allergen: Allergen, names: string[] | undefined) =>
    (names?.length ?? 0) > 0 && !label.allergens.includes(allergen);
  if (dropped('gluten', details.gluten) || dropped('nuts', details.nuts)) {
    edit.allergenDetails = {
      gluten: label.allergens.includes('gluten') ? (details.gluten ?? []) : [],
      nuts: label.allergens.includes('nuts') ? (details.nuts ?? []) : [],
    };
  }
  await applyIngredientEdit(tx, locked, edit, {
    name: `${LABEL_CHECK_CAUSE}${locked.name}`,
    userId,
  });
}

/** Checks as the API shows them, with the ingredient and the person by name. */
async function readChecks(
  exec: Executor,
  where: SQL | undefined,
  newestFirst: boolean,
  limit = 200,
): Promise<LabelCheck[]> {
  const rows = await exec
    .select({
      check: ingredientLabelChecks,
      ingredientName: ingredients.name,
      checkedBy: users.displayName,
    })
    .from(ingredientLabelChecks)
    .innerJoin(ingredients, eq(ingredients.id, ingredientLabelChecks.ingredientId))
    .leftJoin(users, eq(users.id, ingredientLabelChecks.checkedBy))
    .where(where)
    .orderBy(
      newestFirst ? desc(ingredientLabelChecks.checkedAt) : asc(ingredientLabelChecks.checkedAt),
    )
    .limit(limit);
  return rows.map(({ check, ingredientName, checkedBy }) => ({
    id: check.id,
    ingredientId: check.ingredientId,
    ingredientName,
    checkedAt: check.checkedAt.toISOString(),
    checkedBy: checkedBy ?? null,
    changed: check.changed,
    before: asLabel(check.beforeAllergens, check.beforeMayContain),
    after: asLabel(check.afterAllergens, check.afterMayContain),
    note: check.note,
    status: check.status,
  }));
}

async function readCheck(exec: Executor, id: string): Promise<LabelCheck> {
  const [check] = await readChecks(exec, eq(ingredientLabelChecks.id, id), true, 1);
  if (!check) throw ApiError.notFound('That label check');
  return check;
}

const labelCheckRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/ingredients/:id/label-checks',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        body: createLabelCheckSchema,
        response: { 200: labelCheckSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const user = request.user!;
      const label = asLabel(request.body.allergens, request.body.mayContain);
      const id = await app.db.transaction(async (tx) => {
        // The recipe graph before the row, in the order recipe saves take them.
        await lockRecipeGraph(tx);
        // Locked, so what it is compared with is what it still is when saved.
        const [locked] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, request.params.id))
          .for('update');
        if (!locked) return null;
        const now = asLabel(locked.allergens, locked.mayContain);
        const base = request.body.base
          ? asLabel(request.body.base.allergens, request.body.base.mayContain)
          : now;
        const outdated = !sameLabel(base, now);
        // Read against an older version and found the same: the person saw
        // nothing new, so someone's change since stays as it is.
        const before = outdated && sameLabel(base, label) ? base : now;
        const changed = !sameLabel(before, label);
        // Whoever may edit the ingredient changes it; anyone else asks a chef,
        // and so does anyone whose check started from an older version.
        const applies = !changed || (MANAGERS.includes(user.role) && !outdated);
        const [check] = await tx
          .insert(ingredientLabelChecks)
          .values({
            ingredientId: locked.id,
            checkedAt: checkedAtFrom(request.body.checkedAt),
            checkedBy: user.id,
            changed,
            beforeAllergens: before.allergens,
            beforeMayContain: before.mayContain,
            afterAllergens: label.allergens,
            afterMayContain: label.mayContain,
            note: request.body.note || null,
            status: applies ? 'applied' : 'pending',
          })
          .returning({ id: ingredientLabelChecks.id });
        if (changed && applies) await applyLabel(tx, locked, label, user.id);
        return check?.id ?? null;
      });
      if (!id) throw ApiError.notFound('That ingredient');
      return readCheck(app.db, id);
    },
  );

  /** One ingredient's checks, newest first: its history at delivery. */
  r.get(
    '/ingredients/:id/label-checks',
    {
      onRequest: [app.requireUser],
      schema: {
        params: z.object({ id: idSchema }),
        response: { 200: z.array(labelCheckSchema), 401: errorSchema },
      },
    },
    async (request) =>
      readChecks(app.db, eq(ingredientLabelChecks.ingredientId, request.params.id), true),
  );

  /** Changes cooks found on a label, oldest first, for a chef to decide on. */
  r.get(
    '/ingredients/label-checks/pending',
    {
      onRequest: [app.requireRole(...MANAGERS)],
      schema: { response: { 200: z.array(labelCheckSchema), 401: errorSchema, 403: errorSchema } },
    },
    async () => readChecks(app.db, eq(ingredientLabelChecks.status, 'pending'), false),
  );

  /**
   * Decide on a waiting change. Approving puts what the label said on the
   * ingredient, but only while it still holds what the check was compared
   * with: the chef approves the difference they were shown, and a change
   * made since is not undone unseen. Then the label is read again.
   */
  async function decide(checkId: string, approve: boolean, userId: string): Promise<LabelCheck> {
    const outcome = await app.db.transaction(async (tx) => {
      // Before any row, as for a check sent in: approving may change the ingredient.
      await lockRecipeGraph(tx);
      const [check] = await tx
        .select()
        .from(ingredientLabelChecks)
        .where(eq(ingredientLabelChecks.id, checkId))
        .for('update');
      if (!check) return 'gone' as const;
      if (check.status !== 'pending') return 'decided' as const;
      if (approve) {
        const [locked] = await tx
          .select()
          .from(ingredients)
          .where(eq(ingredients.id, check.ingredientId))
          .for('update');
        if (!locked) return 'gone' as const;
        const now = asLabel(locked.allergens, locked.mayContain);
        if (!sameLabel(now, asLabel(check.beforeAllergens, check.beforeMayContain)))
          return 'outdated' as const;
        const label = asLabel(check.afterAllergens, check.afterMayContain);
        if (!sameLabel(now, label)) await applyLabel(tx, locked, label, userId);
      }
      await tx
        .update(ingredientLabelChecks)
        .set({ status: approve ? 'applied' : 'rejected' })
        .where(eq(ingredientLabelChecks.id, checkId));
      return 'done' as const;
    });
    if (outcome === 'gone') throw ApiError.notFound('That label check');
    if (outcome === 'decided') {
      throw new ApiError(
        409,
        'label_check_decided',
        'Someone already approved or rejected that label change.',
      );
    }
    if (outcome === 'outdated') {
      throw new ApiError(
        409,
        'label_check_outdated',
        'The ingredient changed since this label was read. Reject it and read the label again.',
      );
    }
    return readCheck(app.db, checkId);
  }

  for (const [action, approve] of [
    ['approve', true],
    ['reject', false],
  ] as const) {
    r.post(
      `/ingredients/label-checks/:checkId/${action}`,
      {
        onRequest: [app.requireRole(...MANAGERS)],
        schema: {
          params: z.object({ checkId: idSchema }),
          response: {
            200: labelCheckSchema,
            401: errorSchema,
            403: errorSchema,
            404: errorSchema,
            409: errorSchema,
          },
        },
      },
      async (request) => decide(request.params.checkId, approve, request.user!.id),
    );
  }
};

export default labelCheckRoutes;
