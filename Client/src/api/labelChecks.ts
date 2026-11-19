import { useEffect, useMemo } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DishSummary,
  Ingredient,
  LabelAllergens,
  LabelCheck,
  Recipe,
  RecipeSummary,
} from '@mise/contracts';
import {
  createRecipeBook,
  labelShift,
  type Allergen,
  type LabelShift,
  type Recipe as DomainRecipe,
  type UnitCode,
} from '@mise/domain';
import { serverNow } from '../lib/serverClock.js';
import { api, isQueued, sendOrQueue } from './client.js';
import { useDishes } from './dishcards.js';
import { loadAhead } from './offline.js';
import { useRecipes } from './recipes.js';
import { useCurrentUser } from './session.js';

/**
 * Checking labels at delivery: sending a check, the history of one
 * ingredient's checks, the changes cooks found waiting for a chef, and what a
 * label would change on the menu before it is saved.
 */

export function useLabelChecks(ingredientId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['label-checks', ingredientId],
    enabled,
    queryFn: () => api.get<LabelCheck[]>(`/ingredients/${ingredientId}/label-checks`),
  });
}

/** Changes cooks found on a label. Chefs only: a cook's list would be refused. */
export function usePendingLabelChecks(enabled: boolean) {
  return useQuery({
    queryKey: ['label-checks-pending'],
    enabled,
    queryFn: () => api.get<LabelCheck[]>('/ingredients/label-checks/pending'),
  });
}

export interface CheckLabelInput {
  ingredient: Ingredient;
  label: LabelAllergens;
  note: string;
  /** The person checking: their name goes on the line while the check waits on the device. */
  by: string;
  /** Whether they may change the ingredient, so the line can say what will happen. */
  applies: boolean;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Whether the label says something other than the ingredient has. */
export function labelDiffers(ingredient: Ingredient, label: LabelAllergens): boolean {
  const traces = (contains: readonly string[], may: readonly string[]) =>
    may.filter((allergen) => !contains.includes(allergen));
  return (
    !sameList(ingredient.allergens, label.allergens) ||
    !sameList(
      traces(ingredient.allergens, ingredient.mayContain),
      traces(label.allergens, label.mayContain),
    )
  );
}

/**
 * Send a check, or keep it on the device to send later like any other change.
 * Kept, it shows on the ingredient at once, as Mise will have it: a chef's
 * new allergens on the line, a cook's "waiting for a chef".
 */
export function useCheckLabel() {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ ingredient, label, note }: CheckLabelInput) =>
      sendOrQueue<LabelCheck>(
        'POST',
        `/ingredients/${ingredient.id}/label-checks`,
        {
          allergens: label.allergens,
          mayContain: label.mayContain,
          note: note.trim() || null,
          // When the label was read, not when the check reached Mise.
          checkedAt: new Date(serverNow()).toISOString(),
          // What it was read against: if someone changes the ingredient
          // before this arrives, their change isn't undone by it.
          base: { allergens: ingredient.allergens, mayContain: ingredient.mayContain },
        },
        { label: { key: 'offline.label.labelCheck', vars: { name: ingredient.name } } },
      ),
    onSuccess: (result, { ingredient, label, by, applies }) => {
      if (isQueued(result)) {
        const changed = labelDiffers(ingredient, label);
        const shown = (item: Ingredient): Ingredient => ({
          ...item,
          ...(changed && applies
            ? {
                allergens: label.allergens,
                mayContain: label.mayContain.filter((a) => !label.allergens.includes(a)),
              }
            : {}),
          labelCheck: {
            at: new Date(serverNow()).toISOString(),
            by,
            pending: (changed && !applies) || Boolean(item.labelCheck?.pending),
          },
        });
        for (const [key, list] of queryClient.getQueriesData<Ingredient[]>({
          queryKey: ['ingredients'],
        })) {
          if (list)
            queryClient.setQueryData(
              key,
              list.map((item) => (item.id === ingredient.id ? shown(item) : item)),
            );
        }
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      void queryClient.invalidateQueries({ queryKey: ['label-checks', ingredient.id] });
      void queryClient.invalidateQueries({ queryKey: ['label-checks-pending'] });
    },
  });
}

/** A chef approving or rejecting a change a cook found. Online only: it's a decision on what is there now. */
export function useDecideLabelCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.post<LabelCheck>(`/ingredients/label-checks/${id}/${approve ? 'approve' : 'reject'}`),
    onSettled: (check) => {
      void queryClient.invalidateQueries({ queryKey: ['label-checks-pending'] });
      void queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      if (check)
        void queryClient.invalidateQueries({ queryKey: ['label-checks', check.ingredientId] });
    },
  });
}

// --- what a label changes ---------------------------------------------------------

/** One dish a label would change, with the menus it is on. */
export interface DishConsequence {
  id: string;
  name: string;
  menus: string[];
  added: Allergen[];
  removed: Allergen[];
  mayAdded: Allergen[];
  mayRemoved: Allergen[];
}

export interface LabelConsequences {
  dishes: DishConsequence[];
  /** Dishes this device can't work out: not every part of them is loaded. */
  unknown: number;
  /** Still loading the recipes; nothing can be said yet. */
  loading: boolean;
}

function asDomain(recipe: Recipe): DomainRecipe {
  return {
    id: recipe.id,
    name: recipe.name,
    type: recipe.type,
    yield: { value: recipe.yield.value, unit: recipe.yield.unit as UnitCode },
    portions: recipe.portions,
    components: recipe.components.map((component) => ({
      id: component.id,
      sortOrder: component.sortOrder,
      quantity: { value: component.quantity.value, unit: component.quantity.unit as UnitCode },
      ref: component.ref,
    })),
    declaredAllergens: recipe.declaredAllergens,
    mayContain: recipe.mayContain,
  };
}

/**
 * Which dishes a label changes, from what the device holds: the recipes loaded
 * ahead for offline use and the ingredient list on screen. A dish missing a
 * part on this device is counted, not guessed at.
 */
export function labelConsequences(
  recipes: readonly Recipe[],
  ingredients: readonly Ingredient[],
  dishes: readonly DishSummary[],
  ingredientId: string,
  label: LabelAllergens,
): Omit<LabelConsequences, 'loading'> {
  const book = createRecipeBook(recipes.map(asDomain), ingredients);
  // Archived dishes are off every menu; what they would say doesn't matter to anyone.
  const live = recipes.filter((recipe) => recipe.type === 'dish' && recipe.status !== 'archived');
  const shift: LabelShift = labelShift(
    book,
    live.map((dish) => dish.id),
    ingredientId,
    label,
  );
  const menus = new Map(dishes.map((dish) => [dish.id, dish.menus]));
  const names = new Map(live.map((dish) => [dish.id, dish.name]));
  return {
    dishes: shift.dishes
      .map((change) => ({
        id: change.dishId,
        name: names.get(change.dishId) ?? '',
        menus: menus.get(change.dishId) ?? [],
        added: change.added,
        removed: change.removed,
        mayAdded: change.mayAdded,
        mayRemoved: change.mayRemoved,
      }))
      // What is on a menu first: that is what a guest is told about tonight.
      .sort(
        (a, b) =>
          Number(b.menus.length > 0) - Number(a.menus.length > 0) || a.name.localeCompare(b.name),
      ),
    unknown: shift.unknown.length,
  };
}

/**
 * The consequences of a label, worked out on the device so it works offline.
 * Only reads what is cached: every recipe is loaded ahead as it is, and asking
 * for each one here would be a request per recipe on a small server.
 */
export function useLabelConsequences(
  ingredients: readonly Ingredient[],
  ingredientId: string,
  label: LabelAllergens,
): LabelConsequences {
  const queryClient = useQueryClient();
  const userId = useCurrentUser().data?.id;
  const summaries = useRecipes({});
  const dishes = useDishes();
  const ids = useMemo(
    () => (summaries.data ?? []).map((recipe: RecipeSummary) => recipe.id),
    [summaries.data],
  );
  const full = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['recipe', id],
      queryFn: () => api.get<Recipe>(`/recipes/${id}`),
      enabled: false,
    })),
  });
  const recipes = full.map((query) => query.data).filter((recipe): recipe is Recipe => !!recipe);
  const missing = (summaries.data ?? []).filter(
    (summary) =>
      summary.type === 'dish' &&
      summary.status !== 'archived' &&
      !recipes.some((recipe) => recipe.id === summary.id),
  ).length;

  // Not everything loaded ahead yet (just signed in, say): load it now, once,
  // the same way the shell does every half hour.
  const short = missing > 0;
  useEffect(() => {
    if (short) void loadAhead(queryClient, userId);
  }, [short, queryClient, userId]);

  const stamp = recipes.map((recipe) => `${recipe.id}@${recipe.updatedAt}`).join();
  const { allergens, mayContain } = label;
  const consequences = useMemo(
    () =>
      labelConsequences(recipes, ingredients, dishes.data ?? [], ingredientId, {
        allergens,
        mayContain,
      }),
    // The recipes by their versions: the list itself is new on every render.
    [stamp, ingredients, dishes.data, ingredientId, allergens, mayContain],
  );
  return {
    ...consequences,
    unknown: consequences.unknown + missing,
    loading: summaries.isPending,
  };
}
