import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, stationSchema, type OfflineBundle } from '@mise/contracts';
import { MANAGERS } from '../../plugins/auth.js';
import { createDishCardService, serialiseSettings } from '../dishcards/service.js';
import { createKitchenService } from '../kitchen/service.js';
import { createMenusService } from '../menus/service.js';
import { createChecklistReader } from '../prep/checklist.js';
import { loadComponentNames, loadRecipeBook } from '../recipes/book.js';
import { createRecipesService } from '../recipes/service.js';
import { expandAgainst, serialise, summarise } from '../recipes/shape.js';

/**
 * Loading ahead for offline use, made light.
 *
 * A tablet used to ask for every recipe four or five times over, and each
 * answer made the server read the whole recipe book from the database. Now it
 * asks which version the data is at (an answer kept in memory), and only when
 * that changed, for everything in one go: the book is read once, and the
 * result is kept per version so six tablets cost one build.
 *
 * Every part is what the individual endpoint would answer for the person
 * asking: where cards are for chefs only, a cook gets no cards or overviews,
 * just as they would be refused one by one.
 */

const gzipped = promisify(gzip);

interface Built {
  raw: Buffer;
  zipped?: Promise<Buffer>;
}

const offlineRoutes: FastifyPluginAsync = async (app) => {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const recipes = createRecipesService(app.db);
  const dishCards = createDishCardService(app.db);
  const menus = createMenusService(app.db);
  const kitchen = createKitchenService(app.db);
  const checklist = createChecklistReader(app.db);

  /**
   * The last build, per kind of reader (with or without cards). One promise
   * each, so tablets asking while it is being built wait for it, and a
   * changed version replaces it rather than adding to it.
   */
  const built = new Map<string, { version: string; result: Promise<Built> }>();

  async function build(version: string, withCards: boolean): Promise<OfflineBundle> {
    const [book, all, names, usedBy, stations, list, menuList, settings] = await Promise.all([
      loadRecipeBook(app.db),
      recipes.allRecipes(),
      loadComponentNames(app.db),
      recipes.usedByAll(),
      kitchen.listStations(),
      checklist.readChecklist(),
      menus.listMenus(),
      dishCards.settings(),
    ]);
    const dishes = await dishCards.summaries(book);

    const recipeEntries: OfflineBundle['recipeEntries'] = [];
    for (const row of all) {
      let allergens: OfflineBundle['recipeEntries'][number]['allergens'] = null;
      try {
        allergens = await recipes.allergensFor(row.id, book);
      } catch {
        // Answered with 422 one by one: what can't be worked out is not handed out.
      }
      const expanded = allergens ? expandAgainst(row.id, {}, book) : null;
      let card: OfflineBundle['recipeEntries'][number]['card'] = null;
      if (withCards && row.type === 'dish') {
        const result = await dishCards.card(row.id, book);
        if (result.ok) {
          const { settings: _settings, ...rest } = result.card;
          card = rest;
        }
      }
      recipeEntries.push({
        recipe: serialise(row, names),
        usedBy: usedBy.get(row.id) ?? [],
        allergens,
        expanded: expanded?.ok ? expanded.value : null,
        card,
      });
    }

    const menuEntries: OfflineBundle['menuEntries'] = [];
    for (const { id } of menuList) {
      const menu = await menus.getMenu(id);
      if (!menu) continue;
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
      version,
      // The endpoint's schema drops what isn't part of the answer; so does this.
      stations: stations.map((station) => stationSchema.parse(station)),
      checklist: list,
      dishes,
      menus: menuList,
      dishCardSettings: serialiseSettings(settings),
      recipes: all.map(summarise),
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

  r.get('/offline/bundle', { onRequest: [app.requireUser] }, async (request, reply) => {
    const user = request.user!;
    const settings = await dishCards.settings();
    const withCards = settings.access !== 'managers' || MANAGERS.includes(user.role);

    // Read before building: a write during the build then shows as a newer
    // version next time, and the tablet loads again rather than miss it.
    const version = `${app.live.dataVersion()}-${user.role}`;
    const kind = withCards ? 'cards' : 'plain';
    let current = built.get(kind);
    if (!current || current.version !== version) {
      const result = build(version, withCards).then((bundle) => ({
        raw: Buffer.from(JSON.stringify(bundle)),
      }));
      // A failed build must not be remembered.
      result.catch(() => {
        if (built.get(kind)?.result === result) built.delete(kind);
      });
      current = { version, result };
      built.set(kind, current);
    }
    const body = await current.result;

    reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('vary', 'accept-encoding');
    if (/\bgzip\b/.test(request.headers['accept-encoding'] ?? '')) {
      body.zipped ??= gzipped(body.raw);
      return reply.header('content-encoding', 'gzip').send(await body.zipped);
    }
    return reply.send(body.raw);
  });
};

export default offlineRoutes;
