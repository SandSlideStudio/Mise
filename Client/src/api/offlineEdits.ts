import type { QueryClient } from '@tanstack/react-query';
import type {
  ComponentRef,
  CreateRecipeComponent,
  DishSummary,
  ExpandedLine,
  ExpandedRecipe,
  Ingredient,
  MenuDish,
  Recipe,
  RecipeComponent,
  RecipeSummary,
} from '@mise/contracts';
import { COURSES } from '@mise/domain';

/**
 * Showing an edit made offline as it will be once sent, from what the device
 * already knows. Only what the edit says is shown this way; what Mise works
 * out from it (allergens, dish cards) waits for the server, and says so
 * (lib/awaiting.ts).
 */

const refId = (ref: ComponentRef) => (ref.kind === 'ingredient' ? ref.ingredientId : ref.recipeId);

/** Names of every ingredient and recipe this device has seen. */
export function knownNames(queryClient: QueryClient, before: RecipeComponent[] = []) {
  const names = new Map<string, string>();
  for (const [, list] of queryClient.getQueriesData<Ingredient[]>({ queryKey: ['ingredients'] }))
    for (const item of list ?? []) names.set(item.id, item.name);
  for (const [, list] of queryClient.getQueriesData<RecipeSummary[]>({ queryKey: ['recipes'] }))
    for (const item of list ?? []) names.set(item.id, item.name);
  for (const component of before)
    if (component.displayName) names.set(refId(component.ref), component.displayName);
  return names;
}

/** The components as the recipe will have them, named from what is known. */
export function componentsAsSent(
  entered: CreateRecipeComponent[],
  before: RecipeComponent[],
  names: Map<string, string>,
): RecipeComponent[] {
  return [...entered]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((component, index) => {
      const id = refId(component.ref);
      const same = before.find((old) => refId(old.ref) === id);
      return {
        id: same?.id ?? `waiting-${index}`,
        sortOrder: component.sortOrder,
        section: component.section ?? null,
        note: component.note ?? null,
        quantity: component.quantity,
        ref: component.ref,
        displayName: names.get(id) ?? same?.displayName ?? '…',
      };
    });
}

/**
 * The lines of an expansion with the new components. A sub-recipe that was
 * already in it keeps what it is made of, in proportion to its new amount when
 * entered in the same unit; one new to this recipe shows as its own line.
 */
export function linesAsSent(expanded: ExpandedRecipe, next: RecipeComponent[]): ExpandedLine[] {
  const groups: { head: ExpandedLine; children: ExpandedLine[] }[] = [];
  for (const line of expanded.lines) {
    if (line.depth === 0) groups.push({ head: line, children: [] });
    else groups.at(-1)?.children.push(line);
  }
  const before = expanded.recipe.components;

  return next.flatMap((component) => {
    const id = refId(component.ref);
    const head: ExpandedLine = {
      depth: 0,
      kind: component.ref.kind,
      sourceId: id,
      name: component.displayName ?? '…',
      section: component.section,
      note: component.note,
      quantity: {
        value: component.quantity.value * expanded.factor,
        unit: component.quantity.unit,
      },
    };
    if (component.ref.kind !== 'recipe') return [head];
    const old = before.find((c) => c.ref.kind === 'recipe' && c.ref.recipeId === id);
    const group = groups.find((g) => g.head.kind === 'recipe' && g.head.sourceId === id);
    if (!old || !group || old.quantity.unit !== component.quantity.unit || old.quantity.value <= 0)
      return [head];
    const ratio = component.quantity.value / old.quantity.value;
    return [
      head,
      ...group.children.map((line) => ({
        ...line,
        quantity: { ...line.quantity, value: line.quantity.value * ratio },
      })),
    ];
  });
}

/** A dish newly put on a menu, from what the device knows of it. */
export function menuDishAsSent(queryClient: QueryClient, recipeId: string): MenuDish | null {
  const full = queryClient.getQueryData<Recipe>(['recipe', recipeId]);
  if (full)
    return {
      recipeId,
      name: full.name,
      course: full.course,
      status: full.status,
      changedSinceCards: false,
    };
  for (const [, list] of queryClient.getQueriesData<DishSummary[]>({ queryKey: ['dishes'] })) {
    const dish = list?.find((item) => item.id === recipeId);
    if (dish)
      return {
        recipeId,
        name: dish.name,
        course: dish.course,
        status: dish.status,
        changedSinceCards: false,
      };
  }
  for (const [, list] of queryClient.getQueriesData<RecipeSummary[]>({ queryKey: ['recipes'] })) {
    const recipe = list?.find((item) => item.id === recipeId);
    if (recipe)
      return {
        recipeId,
        name: recipe.name,
        course: null,
        status: recipe.status,
        changedSinceCards: false,
      };
  }
  return null;
}

/** Menus list by course, then in the chef's order; no course comes last. As the server does. */
export function inCourseOrder(dishes: MenuDish[]): MenuDish[] {
  const rank = (course: string | null) => {
    const index = course ? COURSES.indexOf(course as (typeof COURSES)[number]) : -1;
    return index === -1 ? COURSES.length : index;
  };
  return dishes
    .map((dish, index) => ({ dish, index }))
    .sort((a, b) => rank(a.dish.course) - rank(b.dish.course) || a.index - b.index)
    .map(({ dish }) => dish);
}
