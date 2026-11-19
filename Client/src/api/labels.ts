import type { QueryClient } from '@tanstack/react-query';
import {
  DEFAULT_LABEL_SIZE,
  type AllergenProfile,
  type ExpandedRecipe,
  type LabelSettings,
  type PrepTask,
  type Recipe,
  type SessionUser,
} from '@mise/contracts';
import type { LabelContent } from '../components/PrepLabel.js';
import { isReachable } from '../lib/connectivity.js';
import { api } from './client.js';

/**
 * What a label needs, found where the tablet already has it.
 *
 * Every recipe and its allergens are loaded ahead for offline use, and the
 * kitchen's label settings come with whoever is signed in, so a label prints
 * with Mise out of reach. Only something the tablet has never seen is asked
 * for, and then not for long: a label without a date is better than none.
 */

/** How long to wait for Mise before printing with what is known. */
const ASK_FOR_MS = 3_000;

export function labelSettingsOf(user: SessionUser | null | undefined): LabelSettings {
  return user?.labels ?? { size: DEFAULT_LABEL_SIZE, onTick: false };
}

async function cachedOrAsked<T>(
  queryClient: QueryClient,
  queryKey: unknown[],
  path: string,
  fallback: () => T | undefined,
): Promise<T | null> {
  const known = queryClient.getQueryData<T>(queryKey) ?? fallback();
  if (known !== undefined) return known;
  if (!isReachable()) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      queryClient.fetchQuery({ queryKey, queryFn: () => api.get<T>(path) }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ASK_FOR_MS);
      }),
    ]);
  } catch {
    // Deleted since, or its allergens can't be worked out: printed blank.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** A recipe and its allergens through every sub-recipe, as far as they can be had. */
export async function recipeForLabel(
  queryClient: QueryClient,
  recipeId: string,
): Promise<{ recipe: Recipe | null; allergens: AllergenProfile | null }> {
  const expanded = () =>
    queryClient.getQueryData<ExpandedRecipe>(['recipe-expanded', recipeId, {}]);
  const [recipe, allergens] = await Promise.all([
    cachedOrAsked<Recipe>(
      queryClient,
      ['recipe', recipeId],
      `/recipes/${recipeId}`,
      () => expanded()?.recipe,
    ),
    cachedOrAsked<AllergenProfile>(
      queryClient,
      ['recipe-allergens', recipeId],
      `/recipes/${recipeId}/allergens`,
      () => expanded()?.allergens,
    ),
  ]);
  return { recipe, allergens };
}

/**
 * The label for a ticked line. Made when it was ticked, by whoever ticked it;
 * a tick still waiting to be sent has neither yet, so it is now, by whoever is
 * signed in here.
 */
export async function labelForLine(
  queryClient: QueryClient,
  task: PrepTask,
  user: SessionUser,
): Promise<LabelContent> {
  const facts = task.recipeId
    ? await recipeForLabel(queryClient, task.recipeId)
    : { recipe: null, allergens: null };
  return {
    name: task.description,
    made: task.completedAt ? new Date(task.completedAt) : new Date(),
    by: task.completedByName ?? user.displayName,
    kitchenName: user.kitchenName,
    recipe: facts.recipe
      ? { shelfLifeHours: facts.recipe.shelfLifeHours, storage: facts.recipe.storage }
      : null,
    // Without its recipe the allergens can't be vouched for.
    allergens: facts.recipe ? facts.allergens : null,
  };
}
