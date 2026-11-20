import { isDeepStrictEqual, promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  bookRecipeFrom,
  componentName,
  dishCardFrom,
  errorSchema,
  OFFLINE_BUNDLE_FORMAT,
  packedRef,
  stationSchema,
  type OfflineBundle,
  type OfflineRecipeEntry,
  type Recipe,
} from '@mise/contracts';
import { createRecipeBook, toBase } from '@mise/domain';
import { ApiError } from '../../lib/errors.js';
import { sameRelease } from '../../lib/version.js';
import { MANAGERS } from '../../plugins/auth.js';
import { createDishCardService, serialiseSettings } from '../dishcards/service.js';
import { createKitchenService } from '../kitchen/service.js';
import { createMenusService } from '../menus/service.js';
import { createChecklistReader } from '../prep/checklist.js';
import { historyOf } from '../recipes/allergenHistory.js';
import { loadComponentNames, loadRecipeBook } from '../recipes/book.js';
import { loadCostSettings, seesCosts } from '../recipes/costs.js';
import { createRecipesService } from '../recipes/service.js';
import { serialise } from '../recipes/shape.js';

/**
 * Loading ahead for offline use, made light.
 *
 * A tablet used to ask for every recipe four or five times over, and each
 * answer made the server read the whole recipe book from the database. Now it
 * asks which version the data is at (an answer kept in memory), and only when
 * that changed, for everything in one go: the book is read once, and the
 * result is kept per version so six tablets cost one build.
 *
 * And it is small: each recipe is sent once, with the ingredients it uses,
 * and the tablet works out the expanded trees, allergens and dish cards with
 * the same kitchen maths (see unpackOfflineBundle). Before sending, the
 * server works out what the tablet will, and wherever that would not be
 * exactly its own answer, sends its own answer instead.
 *
 * Every part is what the individual endpoint would answer for the person
 * asking: where cards are for chefs only, a cook gets no cards or overviews,
 * just as they would be refused one by one, and a cook's bundle carries no
 * costs, selling prices or ingredient prices at all, since those answers
 * leave them out.
 */

const gzipped = promisify(gzip);

interface Built {
  raw: Buffer;
  zipped?: Promise<Buffer>;
}

type BundleIngredient = OfflineBundle['ingredients'][number];

const offlineRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const recipes = createRecipesService(app.db);
  const dishCards = createDishCardService(app.db);
  const menus = createMenusService(app.db);
  const kitchen = createKitchenService(app.db);
  const checklist = createChecklistReader(app.db);

  /**
   * The last build, per kind of reader (with or without cards, with or
   * without costs). One promise each, so tablets asking while it is being
   * built wait for it, and a changed version replaces it rather than adding
   * to it.
   */
  const built = new Map<string, { version: string; result: Promise<OfflineBundle> }>();
  /** The same, written out with each role's version on it, plain and zipped. */
  const encoded = new Map<string, Built & { version: string }>();

  /**
   * What every kind of bundle is made from, read once per version: a chef and
   * a cook get different bundles, but from one reading of the book.
   */
  let sources: { version: string; result: ReturnType<typeof readSources> } | null = null;
  function readSources() {
    return Promise.all([
      loadRecipeBook(app.db),
      recipes.allRecipes(),
      loadComponentNames(app.db),
      kitchen.listStations(),
      checklist.readChecklist(),
      menus.listMenus(),
      dishCards.settings(),
      historyOf(app.db),
      loadCostSettings(app.db),
    ]);
  }
  function sourcesAt(version: string) {
    if (!sources || sources.version !== version) {
      const result = readSources();
      // A failed reading must not be remembered.
      result.catch(() => {
        if (sources?.result === result) sources = null;
      });
      sources = { version, result };
    }
    return sources.result;
  }

  async function build(
    version: string,
    withCards: boolean,
    withCosts: boolean,
  ): Promise<OfflineBundle> {
    const [book, all, names, stations, list, menuList, settings, history, costSettings] =
      await sourcesAt(version);
    const dishes = await dishCards.summaries(book);
    const cards = withCards ? await dishCards.allCards(book) : null;
    const summaries = new Map(dishes.map((dish) => [dish.id, dish]));

    // Every ingredient a recipe uses, once: the tablet's book is made of these.
    const ingredients = new Map<string, BundleIngredient>();
    const full: Recipe[] = [];
    const recipeEntries: OfflineRecipeEntry[] = [];
    for (const row of all) {
      const recipe = serialise(row, names, withCosts);
      const entry: OfflineRecipeEntry = {
        recipe,
        allergenHistory: row.type === 'dish' ? (history.get(row.id) ?? []) : null,
      };

      // The amounts as stored, where converting the entered ones doesn't
      // give exactly them back (a cup is kept to four decimals of a millilitre).
      const stored = [row.yieldBase, ...row.components.map((c) => c.quantityBase)];
      const entered = [recipe.yield, ...recipe.components.map((c) => c.quantity)];
      const base = stored.map((value, i) => (value === toBase(entered[i]!) ? null : value));
      while (base.length > 0 && base.at(-1) === null) base.pop();
      if (base.length > 0) entry.base = base;

      const inBook = book.recipe(row.id);
      if (inBook && !isDeepStrictEqual(bookRecipeFrom(recipe, entry.base), inBook)) {
        entry.book = inBook;
      }
      for (const { ref } of [...recipe.components, ...(inBook?.components ?? [])]) {
        if (ref.kind !== 'ingredient' || ingredients.has(ref.ingredientId)) continue;
        const found = book.ingredient(ref.ingredientId);
        if (!found) continue;
        // Not even prices nothing on a cook's screens would show.
        const { price: _price, ...unpriced } = found;
        ingredients.set(found.id, withCosts ? found : unpriced);
      }
      full.push(recipe);
      recipeEntries.push(entry);
    }

    // The book as the tablet will make it, to see what it will work out.
    const tabletBook = createRecipeBook(
      recipeEntries.map((entry, i) => entry.book ?? bookRecipeFrom(full[i]!, entry.base)),
      [...ingredients.values()],
    );
    const ingredientAt = new Map([...ingredients.keys()].map((id, i) => [id, i]));
    const recipeAt = new Map(full.map((recipe, i) => [recipe.id, i]));
    let kitchenName: string | null = null;
    for (const [i, entry] of recipeEntries.entries()) {
      const recipe = full[i]!;
      const result = recipe.type === 'dish' ? cards?.get(recipe.id) : undefined;
      if (result?.ok) {
        const { settings: _settings, ...card } = result.card;
        kitchenName ??= card.kitchenName;
        const worked = dishCardFrom(
          recipe,
          summaries.get(recipe.id),
          kitchenName,
          card.attention,
          tabletBook,
        );
        if (isDeepStrictEqual(worked, card)) entry.cardAttention = card.attention;
        else entry.card = card;
      }
      entry.recipe = {
        ...recipe,
        components: recipe.components.map(({ displayName, ...component }) => ({
          ...component,
          ref: packedRef(component.ref, ingredientAt, recipeAt),
          // Left out where it is the name of what the line refers to.
          ...(displayName === componentName(component.ref, tabletBook) ? {} : { displayName }),
        })),
      };
    }

    const menuEntries: OfflineBundle['menuEntries'] = [];
    for (const found of await menus.allMenus()) {
      const { id } = found;
      const menu = withCosts ? await menus.withCosts(found, book) : found;
      let overview: OfflineBundle['menuEntries'][number]['overview'] = null;
      if (withCards) {
        const result = await menus.overview(id, book);
        if (result.ok) {
          const { settings: _settings, ...rest } = result.overview;
          overview = rest;
        }
      }
      menuEntries.push({ menu, overview });
    }

    return {
      format: OFFLINE_BUNDLE_FORMAT,
      version,
      // The endpoint's schema drops what isn't part of the answer; so does this.
      stations: stations.map((station) => stationSchema.parse(station)),
      checklist: list,
      dishes,
      menus: menuList,
      dishCardSettings: serialiseSettings(settings),
      kitchenName,
      ...(withCosts ? { costSettings } : {}),
      ingredients: [...ingredients.values()],
      recipeEntries,
      menuEntries,
    };
  }

  // Cheap on purpose: a value kept in memory, so tablets may ask often.
  r.get(
    '/offline/version',
    {
      onRequest: [app.requireUser],
      schema: { response: { 200: z.object({ version: z.string() }), 401: errorSchema } },
    },
    async (request) => ({
      // The role is part of it: promoted or demoted, a person's bundle differs.
      version: `${app.live.dataVersion()}-${request.user!.role}`,
    }),
  );

  r.get(
    '/offline/bundle',
    {
      onRequest: [app.requireUser],
      schema: {
        querystring: z.object({
          format: z.coerce.number().int().optional(),
          app: z.string().max(40).optional(),
        }),
      },
    },
    async (request, reply) => {
      // An app saved on a tablet before an update asks without a format, or
      // for an older one, and would misread this one: it is told no, and
      // loads ahead again once it has updated.
      if (request.query.format !== OFFLINE_BUNDLE_FORMAT) {
        throw new ApiError(
          410,
          'bundle_format',
          'This version of the app can’t read what the server loads ahead. Reload the app to update it.',
        );
      }
      if (!sameRelease(request.query.app)) {
        throw new ApiError(
          410,
          'app_outdated',
          'This tablet runs an older version of the app. Reload it to update before it loads ahead.',
        );
      }
      const user = request.user!;
      // The version first, then everything else: a write in between (cards
      // made chefs-only, say) then shows as a newer version next time, and the
      // tablet loads again rather than keep what it may no longer have.
      const data = app.live.dataVersion();
      const version = `${data}-${user.role}`;
      const settings = await dishCards.settings();
      const withCards = settings.access !== 'managers' || MANAGERS.includes(user.role);
      const withCosts = seesCosts(user);

      // One build per version and kind of reader, whatever the roles asking:
      // only the version stamped on it differs between them.
      const kind = withCosts ? 'costs' : withCards ? 'cards' : 'plain';
      let current = built.get(kind);
      if (!current || current.version !== data) {
        const result = build(data, withCards, withCosts);
        // A failed build must not be remembered.
        result.catch(() => {
          if (built.get(kind)?.result === result) built.delete(kind);
        });
        current = { version: data, result };
        built.set(kind, current);
        for (const key of encoded.keys()) if (key.startsWith(`${kind}|`)) encoded.delete(key);
      }
      const bundle = await current.result;
      const key = `${kind}|${user.role}`;
      let body = encoded.get(key);
      if (!body || body.version !== version) {
        body = { version, raw: Buffer.from(JSON.stringify({ ...bundle, version })) };
        encoded.set(key, body);
      }

      reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('vary', 'accept-encoding');
      if (/\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
        body.zipped ??= gzipped(body.raw);
        return reply.header('content-encoding', 'gzip').send(await body.zipped);
      }
      return reply.send(body.raw);
    },
  );
};

export default offlineRoutes;
