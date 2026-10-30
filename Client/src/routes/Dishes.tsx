import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { DishSummary } from '@mise/contracts';
import { ALLERGENS, COURSES, type Allergen } from '@mise/domain';
import { useDishCardSettings, useDishes } from '../api/dishcards.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { AllergenChips } from '../components/DishCardView.js';
import { LoadError } from '../components/LoadError.js';
import {
  allergenName,
  courseName,
  inSentence,
  recipeStatusName,
  temperatureName,
  useT,
} from '../i18n/index.js';

/**
 * The dishes: what goes out to the pass, each shown as the front of its card.
 * Grouped by course the way a menu reads, with "free from" to answer what
 * table six can have. Preps and components live in the recipe book.
 */

const NO_COURSE = 'none';

function courseRank(course: string | null): number {
  const i = course ? COURSES.indexOf(course as (typeof COURSES)[number]) : -1;
  return i === -1 ? COURSES.length : i;
}

export function Dishes() {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const dishes = useDishes();
  const cardSettings = useDishCardSettings();
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [freeFrom, setFreeFrom] = useState('');
  const [onMenu, setOnMenu] = useState(false);

  if (!user) return null;
  const canManage = user.role !== 'cook';
  // Cooks in a kitchen that keeps cards to chefs go to the spec instead.
  const opensCard = canManage || cardSettings.data?.access !== 'managers';

  const all = dishes.data ?? [];
  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (dish) =>
      (!needle || dish.name.toLowerCase().includes(needle)) &&
      (!course || (dish.course ?? NO_COURSE) === course) &&
      (!freeFrom || (dish.facts !== null && !dish.facts.contains.includes(freeFrom as Allergen))) &&
      (!onMenu || dish.menus.length > 0),
  );
  const groups = new Map<string, DishSummary[]>();
  for (const dish of [...shown].sort(
    (a, b) => courseRank(a.course) - courseRank(b.course) || a.name.localeCompare(b.name),
  )) {
    const key = dish.course ?? NO_COURSE;
    groups.set(key, [...(groups.get(key) ?? []), dish]);
  }
  const filtering = Boolean(needle || course || freeFrom || onMenu);
  const freeFromName = freeFrom ? inSentence(translator, allergenName(t, freeFrom)) : null;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
        <PageHeader
          title={t('nav.dishes')}
          description={t('dishes.subtitle')}
          aside={
            canManage ? (
              <Link to="/recipes/new" search={{ type: 'dish' }} className="btn-primary min-h-11">
                {t('dishes.new')}
              </Link>
            ) : null
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <input
            aria-label={t('dishes.search')}
            className="field col-span-2 sm:min-w-[200px] sm:flex-1"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('dishes.search')}
          />
          <select
            aria-label={t('card.course')}
            className="field sm:w-auto"
            value={course}
            onChange={(e) => setCourse(e.target.value)}
          >
            <option value="">{t('dishes.anyCourse')}</option>
            {COURSES.map((value) => (
              <option key={value} value={value}>
                {courseName(t, value)}
              </option>
            ))}
            <option value={NO_COURSE}>{t('menus.noCourse')}</option>
          </select>
          <select
            aria-label={t('recipes.freeFrom')}
            className={`field sm:w-auto ${freeFrom ? 'border-accent bg-accent text-accent-ink' : ''}`}
            value={freeFrom}
            onChange={(e) => setFreeFrom(e.target.value)}
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
          <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-2.5 px-1 sm:col-span-1">
            <input
              type="checkbox"
              className="accent-accent h-5 w-5"
              checked={onMenu}
              onChange={(e) => setOnMenu(e.target.checked)}
            />
            {t('dishes.onMenu')}
          </label>
        </div>

        {dishes.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {dishes.isError ? <LoadError onRetry={() => void dishes.refetch()} /> : null}
        {dishes.data && shown.length === 0 ? (
          <p className="text-ink-soft border-line border-2 border-dashed p-8 text-center text-lg">
            {filtering ? t('dishes.noMatch') : t('dishes.empty')}
          </p>
        ) : null}

        <div className="flex flex-col gap-10">
          {[...groups.entries()].map(([key, group]) => (
            <section key={key}>
              <h2 className="font-display text-brand border-line mb-4 border-b pb-2 text-[17px] font-semibold tracking-[0.16em] uppercase">
                {key === NO_COURSE ? t('menus.noCourse') : courseName(t, key)}
                <span className="text-ink-faint ml-3 tracking-normal normal-case">
                  {group.length}
                </span>
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.map((dish) => (
                  <li key={dish.id}>
                    <DishTile dish={dish} opensCard={opensCard} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {dishes.data && all.length > 0 ? (
          <p className="text-ink-soft mt-8 text-sm">
            {freeFromName
              ? t('dishes.countFreeFrom', {
                  shown: shown.length,
                  total: all.length,
                  allergen: freeFromName,
                })
              : filtering
                ? t('dishes.countFiltered', { shown: shown.length, total: all.length })
                : plural('dishes.count', all.length)}
          </p>
        ) : null}
      </main>
    </AppShell>
  );
}

/** The front of a dish card, small enough to put a whole menu on one screen. */
function DishTile({ dish, opensCard }: { dish: DishSummary; opensCard: boolean }) {
  const { t } = useT();
  const details = [
    dish.servingTemperature ? temperatureName(t, dish.servingTemperature) : null,
    dish.flavourProfile.length > 0 ? dish.flavourProfile.join(' / ') : null,
  ].filter(Boolean);

  const body = (
    <>
      {dish.photoUrl ? (
        <img src={dish.photoUrl} alt="" className="aspect-[16/9] w-full object-cover" />
      ) : null}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="font-display text-brand text-[12px] font-semibold tracking-[0.16em] uppercase">
            {dish.menus.length > 0 ? dish.menus.join(' · ') : t('dishes.notOnMenu')}
          </p>
          <h3 className="font-display mt-0.5 text-[26px] leading-[1] font-semibold uppercase">
            {dish.name}
          </h3>
          {dish.status !== 'published' ? (
            <span className="tag tag-accent mt-1.5 inline-block px-1.5 py-0 text-[11px]">
              {recipeStatusName(t, dish.status)}
            </span>
          ) : null}
        </div>
        {details.length > 0 ? (
          <p className="text-ink-soft text-[15px]">{details.join(' · ')}</p>
        ) : null}
        <div className="mt-auto">
          {dish.facts ? (
            <AllergenChips facts={dish.facts} size="small" />
          ) : (
            <p className="text-danger text-sm">{t('dishes.broken')}</p>
          )}
        </div>
      </div>
    </>
  );
  const className =
    'bg-surface-raised border-line hover:border-accent flex h-full flex-col overflow-hidden border transition-colors';

  return opensCard ? (
    <Link to="/dishes/$dishId" params={{ dishId: dish.id }} className={className}>
      {body}
    </Link>
  ) : (
    <Link to="/recipes/$recipeId" params={{ recipeId: dish.id }} className={className}>
      {body}
    </Link>
  );
}
