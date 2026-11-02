import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ExpandedRecipe } from '@mise/contracts';
import { useCurrentUser } from '../api/session.js';
import { useOutbox, type OutboxEntry } from './outbox.js';

/**
 * Which allergens and dish cards are waiting on a change made offline.
 *
 * What goes into a recipe shows on this device at once. What it adds up to
 * (allergens, a dish card's facts) is worked out by Mise, so until the change
 * is sent those still show what Mise last said, marked as such. That holds for
 * the recipe changed, and for every recipe and menu that uses it.
 */

interface Waiting {
  recipes: Set<string>;
  ingredients: Set<string>;
  menus: Set<string>;
}

const RECIPE_FIELDS = ['components', 'mayContain'];
const INGREDIENT_FIELDS = ['allergens', 'allergenDetails'];

function changes(body: unknown, fields: string[]): boolean {
  return Boolean(body && typeof body === 'object' && fields.some((field) => field in body));
}

/** What the waiting changes touch that Mise adds up. Exported for tests. */
export function waitingOn(entries: OutboxEntry[]): Waiting {
  const waiting: Waiting = { recipes: new Set(), ingredients: new Set(), menus: new Set() };
  for (const entry of entries) {
    if (entry.method !== 'PATCH') continue;
    const [, kind, id] = /^\/(recipes|ingredients|menus)\/([^/]+)$/.exec(entry.path) ?? [];
    if (!id) continue;
    if (kind === 'recipes' && changes(entry.body, RECIPE_FIELDS)) waiting.recipes.add(id);
    if (kind === 'ingredients' && changes(entry.body, INGREDIENT_FIELDS))
      waiting.ingredients.add(id);
    if (kind === 'menus' && changes(entry.body, ['dishes'])) waiting.menus.add(id);
  }
  return waiting;
}

/** Whether what Mise said about this recipe may change once the waiting changes are sent. */
export function recipeAwaits(queryClient: QueryClient, waiting: Waiting, recipeId: string) {
  if (waiting.recipes.has(recipeId)) return true;
  if (waiting.recipes.size === 0 && waiting.ingredients.size === 0) return false;
  // Everything a recipe is made of, at every depth, is in its expansion.
  return queryClient
    .getQueriesData<ExpandedRecipe>({ queryKey: ['recipe-expanded', recipeId] })
    .some(([, expanded]) =>
      expanded?.lines.some((line) =>
        (line.kind === 'recipe' ? waiting.recipes : waiting.ingredients).has(line.sourceId),
      ),
    );
}

/** Answers "is this waiting on a change made offline?" for recipes and menus. */
export function useAwaiting() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const entries = useOutbox(user?.id).filter((entry) => !entry.conflict);
  const waiting = waitingOn(entries);
  const recipe = (recipeId: string) => recipeAwaits(queryClient, waiting, recipeId);
  return {
    recipe,
    menu: (menuId: string, dishIds: string[]) =>
      waiting.menus.has(menuId) || dishIds.some((id) => recipe(id)),
  };
}
