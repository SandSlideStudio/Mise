import { and, asc, eq, sql } from 'drizzle-orm';
import {
  DISH_CARD_PARTS,
  type DishCard,
  type DishCardFacts,
  type DishCardPart,
  type DishSummary,
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
    // The first time, made once: two pages opening at the same moment would
    // otherwise make two, and changes would go to one and be read from the other.
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mise-dish-card-settings'))`);
      const [made] = await tx.select().from(dishCardSettings).limit(1);
      if (made) return made;
      const [created] = await tx.insert(dishCardSettings).values({}).returning();
      return created!;
    });
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

  type Book = Awaited<ReturnType<typeof loadRecipeBook>>;
  type CardResult = { ok: true; card: DishCard } | { ok: false; error: CardFailure };
  type DishRow = typeof recipes.$inferSelect;

  /** What a card is drawn from besides the book: read for one dish, or for all of them. */
  interface CardContext {
    photos: (typeof recipePhotos.$inferSelect)[];
    kitchenName: string;
    stored: StoredSettings;
    /** The active menus each dish is on, in name order. */
    menusOf: Map<string, string[]>;
  }

  async function readContext(recipeId?: string): Promise<CardContext> {
    const [photos, [kitchen], stored, onMenus] = await Promise.all([
      recipeId
        ? db.select().from(recipePhotos).where(eq(recipePhotos.recipeId, recipeId))
        : db.select().from(recipePhotos),
      db.select({ name: kitchens.name }).from(kitchens).limit(1),
      settings(),
      // The menus the floor is selling it on now. Printing from a menu names
      // that menu instead; the client swaps it in.
      db
        .select({ recipeId: menuDishes.recipeId, name: menus.name })
        .from(menuDishes)
        .innerJoin(menus, eq(menus.id, menuDishes.menuId))
        .where(
          and(eq(menus.status, 'active'), recipeId ? eq(menuDishes.recipeId, recipeId) : undefined),
        )
        .orderBy(asc(menus.name)),
    ]);
    const menusOf = new Map<string, string[]>();
    for (const row of onMenus) {
      menusOf.set(row.recipeId, [...(menusOf.get(row.recipeId) ?? []), row.name]);
    }
    return { photos, kitchenName: kitchen?.name ?? 'Mise', stored, menusOf };
  }

  function makeCard(dish: DishRow, book: Book, context: CardContext): CardResult {
    const matrix = dishCardMatrix(dish.id, book);
    // A card that can't be worked out is not printed with a guess in it.
    if (!matrix.ok) return { ok: false, error: { kind: 'broken' } };

    const photos = context.photos.filter((p) => p.recipeId === dish.id);
    const photo = photos.find((p) => p.isPrimary) ?? photos[0] ?? null;

    return {
      ok: true,
      card: {
        kitchenName: context.kitchenName,
        dish: {
          id: dish.id,
          name: dish.name,
          status: dish.status,
          menus: context.menusOf.get(dish.id) ?? [],
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
        attention: attentionFor(dish.id, book),
        settings: serialiseSettings(context.stored),
      },
    };
  }

  async function card(recipeId: string, loaded?: Book): Promise<CardResult> {
    const [dish] = await db.select().from(recipes).where(eq(recipes.id, recipeId)).limit(1);
    if (!dish) return { ok: false, error: { kind: 'not_found' } };
    if (dish.type !== 'dish') return { ok: false, error: { kind: 'not_a_dish' } };

    const book = loaded ?? (await loadRecipeBook(db));
    return makeCard(dish, book, await readContext(recipeId));
  }

  /**
   * The card of every dish, by recipe id, from one reading of what they are
   * drawn from: for the bundle for offline use, which would otherwise ask the
   * database four more times for each of its dishes.
   */
  async function allCards(book: Book): Promise<Map<string, CardResult>> {
    const [dishes, context] = await Promise.all([
      db.select().from(recipes).where(eq(recipes.type, 'dish')),
      readContext(),
    ]);
    return new Map(dishes.map((dish) => [dish.id, makeCard(dish, book, context)]));
  }

  /**
   * Ingredients somewhere in the dish that leave the card less sure than it
   * should be: vegan not answered, or gluten or nuts without saying which.
   */
  function attentionFor(recipeId: string, book: Book): DishCard['attention'] {
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

  /**
   * Every dish, with what the front of its card shows and its allergens as a
   * whole. One pass over the recipe book, so the Dishes page is one request.
   */
  async function summaries(
    loaded?: Awaited<ReturnType<typeof loadRecipeBook>>,
  ): Promise<DishSummary[]> {
    const [dishes, book, photos, onMenus] = await Promise.all([
      db
        .select({
          id: recipes.id,
          name: recipes.name,
          status: recipes.status,
          course: recipes.course,
          servingTemperature: recipes.servingTemperature,
          flavourProfile: recipes.flavourProfile,
        })
        .from(recipes)
        .where(eq(recipes.type, 'dish'))
        .orderBy(asc(recipes.name)),
      loaded ?? loadRecipeBook(db),
      db.select().from(recipePhotos),
      db
        .select({ recipeId: menuDishes.recipeId, name: menus.name })
        .from(menuDishes)
        .innerJoin(menus, eq(menus.id, menuDishes.menuId))
        .where(eq(menus.status, 'active'))
        .orderBy(asc(menus.name)),
    ]);
    return dishes.map((dish) => {
      const mine = photos.filter((p) => p.recipeId === dish.id);
      const photo = mine.find((p) => p.isPrimary) ?? mine[0] ?? null;
      const matrix = dishCardMatrix(dish.id, book);
      return {
        ...dish,
        menus: onMenus.filter((m) => m.recipeId === dish.id).map((m) => m.name),
        photoUrl: photo ? `/api/uploads/${photo.path}` : null,
        facts: matrix.ok ? facts(matrix.value.dish) : null,
      };
    });
  }

  return { settings, update, setLogo, card, allCards, summaries };
}

export type DishCardService = ReturnType<typeof createDishCardService>;
