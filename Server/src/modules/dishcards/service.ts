import { and, asc, eq } from 'drizzle-orm';
import {
  DISH_CARD_PARTS,
  type DishCard,
  type DishCardFacts,
  type DishCardPart,
  type UpdateDishCardSettings,
} from '@mise/contracts';
import { dishCardMatrix, type DishCardRow as DomainRow } from '@mise/domain';
import type { Database } from '../../db/client.js';
import {
  dishCardSettings,
  kitchens,
  menuDishes,
  menus,
  recipePhotos,
  recipes,
} from '../../db/schema.js';
import { loadRecipeBook } from '../recipes/book.js';

/**
 * Dish cards.
 *
 * The settings are one row, made the first time anyone looks. The card itself
 * is worked out fresh every time it is opened, from the same recipe graph and
 * the same domain code as everything else, so a card can never show an
 * allergen list older than the recipe.
 */

type StoredSettings = typeof dishCardSettings.$inferSelect;

export type CardFailure = { kind: 'not_found' } | { kind: 'not_a_dish' } | { kind: 'broken' };

function facts(row: Omit<DomainRow, 'recipeId' | 'name'>): DishCardFacts {
  return {
    contains: row.allergens.contains,
    mayContain: row.allergens.mayContain,
    vegan: row.vegan,
    gluten: row.details.gluten,
    nuts: row.details.nuts,
  };
}

/**
 * The parts a kitchen switched off. Before 2.1 the line under the name was the
 * season; it is the menu now, so a kitchen that hid one keeps the other hidden.
 * That holds for settings restored from an older backup too.
 */
function hiddenParts(stored: string[]): DishCardPart[] {
  const parts = stored
    .map((part) => (part === 'season' ? 'menu' : part))
    .filter((part): part is DishCardPart => (DISH_CARD_PARTS as readonly string[]).includes(part));
  return [...new Set(parts)];
}

export function serialiseSettings(row: StoredSettings) {
  return {
    title: row.title,
    locationName: row.locationName,
    address: row.address,
    logoUrl: row.logoPath ? `/api/uploads/${row.logoPath}` : null,
    warnings: row.warnings,
    hidden: hiddenParts(row.hidden),
    theme: row.theme,
    access: row.access,
  };
}

export function createDishCardService(db: Database) {
  async function settings(): Promise<StoredSettings> {
    const [row] = await db.select().from(dishCardSettings).limit(1);
    if (row) return row;
    const [created] = await db.insert(dishCardSettings).values({}).returning();
    return created!;
  }

  async function update(input: UpdateDishCardSettings): Promise<StoredSettings> {
    const current = await settings();
    const [row] = await db
      .update(dishCardSettings)
      .set({
        ...input,
        // An empty field means "use the default", which is stored as null.
        ...(input.title !== undefined ? { title: input.title || null } : {}),
        ...(input.locationName !== undefined ? { locationName: input.locationName || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.warnings !== undefined
          ? {
              warnings: Object.fromEntries(
                Object.entries(input.warnings).filter(([, text]) => text && text.trim()),
              ),
            }
          : {}),
        ...(input.hidden !== undefined ? { hidden: [...new Set(input.hidden)] } : {}),
        updatedAt: new Date(),
      })
      .where(eq(dishCardSettings.id, current.id))
      .returning();
    return row!;
  }

  /** Records a new logo and hands back the file it replaced, for the caller to delete. */
  async function setLogo(path: string | null): Promise<string | null> {
    const current = await settings();
    await db
      .update(dishCardSettings)
      .set({ logoPath: path, updatedAt: new Date() })
      .where(eq(dishCardSettings.id, current.id));
    return current.logoPath;
  }

  async function card(
    recipeId: string,
  ): Promise<{ ok: true; card: DishCard } | { ok: false; error: CardFailure }> {
    const [dish] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
    if (!dish) return { ok: false, error: { kind: 'not_found' } };
    if (dish.type !== 'dish') return { ok: false, error: { kind: 'not_a_dish' } };

    const book = await loadRecipeBook(db);
    const matrix = dishCardMatrix(recipeId, book);
    // A card that can't be worked out is not printed with a guess in it.
    if (!matrix.ok) return { ok: false, error: { kind: 'broken' } };

    const [photos, [kitchen], stored, onMenus] = await Promise.all([
      db.select().from(recipePhotos).where(eq(recipePhotos.recipeId, recipeId)),
      db.select({ name: kitchens.name }).from(kitchens).limit(1),
      settings(),
      // The menus the floor is selling it on now. Printing from a menu names
      // that menu instead; the client swaps it in.
      db
        .select({ name: menus.name })
        .from(menuDishes)
        .innerJoin(menus, eq(menus.id, menuDishes.menuId))
        .where(and(eq(menuDishes.recipeId, recipeId), eq(menus.status, 'active')))
        .orderBy(asc(menus.name)),
    ]);
    const photo = photos.find((p) => p.isPrimary) ?? photos[0] ?? null;

    return {
      ok: true,
      card: {
        kitchenName: kitchen?.name ?? 'Mise',
        dish: {
          id: dish.id,
          name: dish.name,
          status: dish.status,
          menus: onMenus.map((menu) => menu.name),
          flavourProfile: dish.flavourProfile,
          servingTemperature: dish.servingTemperature,
          course: dish.course,
          drinkPairings: dish.drinkPairings,
          cutlery: dish.cutlery,
          photoUrl: photo ? `/api/uploads/${photo.path}` : null,
        },
        rows: matrix.value.rows.map((row) => ({
          recipeId: row.recipeId!,
          name: row.name,
          ...facts(row),
        })),
        other: matrix.value.other ? facts(matrix.value.other) : null,
        whole: facts(matrix.value.dish),
        attention: await attentionFor(recipeId, book),
        settings: serialiseSettings(stored),
      },
    };
  }

  /**
   * Ingredients somewhere in the dish that leave the card less sure than it
   * should be: vegan not answered, or gluten or nuts without saying which.
   */
  async function attentionFor(
    recipeId: string,
    book: Awaited<ReturnType<typeof loadRecipeBook>>,
  ): Promise<DishCard['attention']> {
    const ingredientIds = new Set<string>();
    const visited = new Set<string>();
    const stack = [recipeId];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const component of book.recipe(id)?.components ?? []) {
        if (component.ref.kind === 'ingredient') ingredientIds.add(component.ref.ingredientId);
        else stack.push(component.ref.recipeId);
      }
    }

    const veganUnknown: string[] = [];
    const missingDetails: string[] = [];
    for (const id of ingredientIds) {
      const ingredient = book.ingredient(id);
      if (!ingredient) continue;
      if (ingredient.vegan == null) veganUnknown.push(ingredient.name);
      const details = ingredient.allergenDetails ?? {};
      const needsGluten = ingredient.allergens.includes('gluten') && !details.gluten?.length;
      const needsNuts = ingredient.allergens.includes('nuts') && !details.nuts?.length;
      if (needsGluten || needsNuts) missingDetails.push(ingredient.name);
    }
    const byName = (a: string, b: string) => a.localeCompare(b);
    return { veganUnknown: veganUnknown.sort(byName), missingDetails: missingDetails.sort(byName) };
  }

  return { settings, update, setLogo, card };
}

export type DishCardService = ReturnType<typeof createDishCardService>;
