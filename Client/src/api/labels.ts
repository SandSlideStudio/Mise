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
import { RequestFailed, api } from './client.js';

/**
 * What a label needs, found where the tablet already has it.
 *
 * Every recipe and its allergens are loaded ahead for offline use, and the
 * kitchen's label settings come with whoever is signed in, so a label prints
 * with Mise out of reach. With Mise there, it is asked first: what was loaded
 * ahead may be half an hour old, and a label with yesterday's allergens on it
 * is worse than none. Only for a moment, though: no answer in time, and the
 * label prints with what the tablet has.
 */

/** How long to wait for Mise before printing with what is known. */
const ASK_FOR_MS = 3_000;

/**
 * How recent an answer may be and still not be asked again: printing a run
 * of labels for the same recipe asks once, not once a label. A change Mise
 * signals in the meantime makes it stale at once.
 */
const FRESH_FOR_MS = 10_000;

export function labelSettingsOf(user: SessionUser | null | undefined): LabelSettings {
  return user?.labels ?? { size: DEFAULT_LABEL_SIZE, onTick: false };
}

async function cachedOrAsked<T>(
  queryClient: QueryClient,
  queryKey: unknown[],
  path: string,
  fallback: () => T | undefined,
): Promise<T | null> {
  const known = () => queryClient.getQueryData<T>(queryKey) ?? fallback() ?? null;
  if (!isReachable()) return known();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const asked = await Promise.race([
      queryClient.fetchQuery({
        queryKey,
        queryFn: () => api.get<T>(path),
        staleTime: FRESH_FOR_MS,
      }),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ASK_FOR_MS);
      }),
    ]);
    return asked === undefined ? known() : asked;
  } catch (error) {
    // Mise answered no: deleted since, or its allergens can't be worked out.
    // Printed blank, rather than with what it said before. A proxy saying
    // Mise is down leaves it marked out of reach: as good as no answer.
    if (error instanceof RequestFailed && isReachable()) return null;
    return known();
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
      ? {
          shelfLifeHours: facts.recipe.shelfLifeHours,
          kept: facts.recipe.kept,
          storage: facts.recipe.storage,
        }
      : null,
    // Without its recipe the allergens can't be vouched for.
    allergens: facts.recipe ? facts.allergens : null,
  };
}
