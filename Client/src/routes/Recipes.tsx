import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ALLERGENS, formatQuantity, humanize, isUnitCode } from '@mise/domain';
import { useStations } from '../api/kitchen.js';
import { useCurrentUser } from '../api/session.js';
import { useRecipes } from '../api/recipes.js';
import { AppShell } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate } from '../components/Plate.js';
import { allergenName, inSentence, recipeStatusName, recipeTypeName, useT } from '../i18n/index.js';

/**
 * The book.
 *
 * "Free from" answers what you can give table six, and it follows every
 * sub-recipe down. What it excludes is not greyed out and listed; it is simply
 * gone, and the count says so. A filter that leaves everything on screen at
 * half opacity is a filter nobody trusts.
 */
export function Recipes() {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const stations = useStations();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [excludeAllergen, setExcludeAllergen] = useState('');
  const [stationId, setStationId] = useState('');

  // Dishes have their own page, as cards; the book is preps and components.
  const found = useRecipes({
    search: search || undefined,
    type: type || undefined,
    stationId: stationId || undefined,
    excludeAllergen: excludeAllergen || undefined,
  });
  const recipes = { ...found, data: found.data?.filter((recipe) => recipe.type !== 'dish') };
  const all = useRecipes();
  const everything = { data: all.data?.filter((recipe) => recipe.type !== 'dish') };

  if (!user) return null;
  const canManage = user.role !== 'cook';
  const filtering = Boolean(search || type || stationId || excludeAllergen);
  const freeFrom = excludeAllergen
    ? inSentence(translator, allergenName(t, excludeAllergen))
    : null;
  const shown = recipes.data?.length ?? 0;
  const total = everything.data?.length ?? 0;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-0 py-4 sm:px-6 sm:py-8">
        <Plate className="border-x-0 sm:border-x">
          <div className="bg-surface-raised border-line border-b px-4 pt-5 pb-4 sm:px-6 sm:pt-[22px]">
            <h1 className="text-[34px] leading-none sm:text-[36px]">{t('nav.recipes')}</h1>
            <p className="text-ink-soft mt-1 mb-3.5 text-[15px]">{t('recipes.subtitle')}</p>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <input
                aria-label={t('recipes.search')}
                className="field col-span-2 sm:min-w-[180px] sm:flex-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('recipes.search')}
              />
              <select
                aria-label={t('recipes.sort')}
                className="field sm:w-auto"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">{t('recipes.anySort')}</option>
                <option value="prep">{t('recipes.prep')}</option>
                <option value="component">{t('recipes.components')}</option>
              </select>
              <select
                aria-label={t('common.station')}
                className="field sm:w-auto"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
              >
                <option value="">{t('common.anyStation')}</option>
                {(stations.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="col-span-2 flex items-center">
                <select
                  aria-label={t('recipes.freeFrom')}
                  className={`field min-w-0 flex-1 sm:w-auto sm:flex-none ${
                    excludeAllergen ? 'border-accent bg-accent text-accent-ink' : ''
                  }`}
                  value={excludeAllergen}
                  onChange={(e) => setExcludeAllergen(e.target.value)}
                >
                  <option value="">{t('recipes.freeFrom')}</option>
                  {ALLERGENS.map((allergen) => (
                    <option key={allergen} value={allergen}>
                      {t('recipes.freeFromOption', {
                        allergen: inSentence(translator, allergenName(t, allergen)),
                      })}
                    </option>
                  ))}
                </select>
                {excludeAllergen ? (
                  <button
                    type="button"
                    aria-label={t('recipes.clearFreeFrom')}
                    className="border-accent bg-accent text-accent-ink min-h-[2.75rem] border border-l-0 px-3 text-sm"
                    onClick={() => setExcludeAllergen('')}
                  >
                    ✕
                  </button>
                ) : null}
              </span>
            </div>
          </div>

          <div className="bg-surface-raised">
            <div className="col-head hidden grid-cols-[minmax(0,1fr)_150px_110px] gap-3 px-6 py-[9px] sm:grid">
              <span>{t('common.name')}</span>
              <span>{t('recipes.colSortStation')}</span>
              <span className="text-right">{t('recipes.colMakes')}</span>
            </div>

            {recipes.isPending ? (
              <p className="text-ink-soft px-6 py-6">{t('common.loading')}</p>
            ) : null}

            {recipes.isError ? (
              <LoadError className="m-4 sm:m-6" onRetry={() => void recipes.refetch()} />
            ) : null}

            {recipes.data?.length === 0 ? (
              <p className="text-ink-soft px-6 py-10 text-center">
                {filtering ? t('recipes.noMatch') : t('recipes.empty')}
              </p>
            ) : null}

            <ul>
              {recipes.data?.map((recipe) => {
                const station = stations.data?.find((s) => s.id === recipe.stationId);
                const sortStation = `${recipeTypeName(t, recipe.type)} · ${
                  station?.name ?? t('recipes.noStation')
                }`;
                const detail = freeFrom
                  ? t('recipes.noneInTree', { allergen: freeFrom })
                  : [
                      recipe.portions ? plural('recipes.portions', recipe.portions) : null,
                      ...recipe.tags,
                    ]
                      .filter(Boolean)
                      .join(' · ');

                return (
                  <li key={recipe.id}>
                    <Link
                      to="/recipes/$recipeId"
                      params={{ recipeId: recipe.id }}
                      className="border-rule hover:bg-surface-sunk active:bg-surface-sunk grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 transition-colors sm:grid-cols-[minmax(0,1fr)_150px_110px] sm:px-6"
                    >
                      <span className="min-w-0">
                        <span className="text-[19px] font-medium">{recipe.name}</span>
                        {recipe.status !== 'published' ? (
                          <span className="tag tag-accent ml-2 px-1.5 py-0 text-[11px]">
                            {recipeStatusName(t, recipe.status)}
                          </span>
                        ) : null}
                        <span className="text-ink-soft block text-sm sm:hidden">{sortStation}</span>
                        {detail ? (
                          <span className="text-ink-soft block text-sm">{detail}</span>
                        ) : null}
                      </span>
                      <span className="text-ink-soft hidden text-sm sm:block">{sortStation}</span>
                      <span className="qty text-right text-[22px]">
                        {isUnitCode(recipe.yield.unit)
                          ? formatQuantity(
                              humanize({ value: recipe.yield.value, unit: recipe.yield.unit }),
                            )
                          : recipe.yield.value}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="bg-surface-sunk border-line grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-3.5 sm:px-6">
              <span className="text-ink-soft text-sm">
                {freeFrom
                  ? t('recipes.countFreeFrom', { shown, total, allergen: freeFrom })
                  : filtering
                    ? t('recipes.countFiltered', { shown, total })
                    : plural('recipes.count', total)}
              </span>
              {canManage ? (
                <Link to="/recipes/new" className="btn-primary min-h-11">
                  {t('recipes.new')}
                </Link>
              ) : null}
            </div>
          </div>
        </Plate>
      </main>
    </AppShell>
  );
}
