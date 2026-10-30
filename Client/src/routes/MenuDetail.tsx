import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  LANGUAGES,
  type DishCardTheme,
  type Language,
  type Menu,
  type MenuStatus,
} from '@mise/contracts';
import { useDishCardSettings } from '../api/dishcards.js';
import {
  useDeleteMenu,
  useDuplicateMenu,
  useMarkCardsPrinted,
  useMenu,
  useUpdateMenu,
} from '../api/menus.js';
import { useRecipes } from '../api/recipes.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate } from '../components/Plate.js';
import { saveFile } from '../components/PrintSheets.js';
import { courseName, createTranslator, errorMessage, LANGUAGE_NAMES, useT } from '../i18n/index.js';
import { menuStatusName } from './Menus.js';

/**
 * One menu: its dishes by course, and what it prints. Chefs arrange it; the
 * floor opens the allergen overview and the dish cards from here.
 */
export function MenuDetail() {
  const { menuId } = useParams({ from: '/menus/$menuId' });
  const { t } = useT();
  const menu = useMenu(menuId);

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/menus" className="eyebrow hover:text-ink mb-4 inline-block">
          {t('menus.back')}
        </Link>
        {menu.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {menu.isError ? <LoadError onRetry={() => void menu.refetch()} /> : null}
        {menu.data ? <MenuView key={menu.data.id} menu={menu.data} /> : null}
      </main>
    </AppShell>
  );
}

function MenuView({ menu }: { menu: Menu }) {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const canManage = user?.role !== 'cook';
  const update = useUpdateMenu(menu.id);
  const dishes = useRecipes({ type: 'dish' });
  const cardSettings = useDishCardSettings();
  const [adding, setAdding] = useState('');

  const ids = menu.dishes.map((dish) => dish.recipeId);
  const available = (dishes.data ?? []).filter(
    (dish) => !ids.includes(dish.id) && dish.status !== 'archived',
  );

  /** Swap with the neighbour in the same course; the server keeps course order. */
  function move(index: number, direction: -1 | 1) {
    const other = index + direction;
    if (menu.dishes[other]?.course !== menu.dishes[index]!.course) return;
    const next = [...ids];
    [next[index], next[other]] = [next[other]!, next[index]!];
    update.mutate({ dishes: next });
  }

  // Never printed means nothing has changed since: the printing panel says the cards are still to do.
  const changed = menu.cardsPrintedAt
    ? menu.dishes.filter((dish) => dish.changedSinceCards).length
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <MenuHeader menu={menu} canManage={canManage} />

      {canManage || cardSettings.data?.access === 'everyone' ? <Printing menu={menu} /> : null}

      <Plate className="bg-surface-raised">
        <div className="border-line flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3 sm:px-6">
          <h2 className="text-2xl">{t('menus.dishesTitle')}</h2>
          <span className="text-ink-soft text-sm">
            {plural('menus.dishes', menu.dishes.length)}
            {menu.dishes.length > 0 && changed > 0
              ? ` · ${plural('menus.changedCount', changed)}`
              : ''}
          </span>
        </div>

        {menu.dishes.length === 0 ? (
          <p className="text-ink-soft px-6 py-8 text-center">{t('menus.noDishes')}</p>
        ) : (
          <ul>
            {menu.dishes.map((dish, index) => {
              const startsCourse = index === 0 || menu.dishes[index - 1]!.course !== dish.course;
              return (
                <li key={dish.recipeId}>
                  {startsCourse ? (
                    <h3 className="band px-4 py-2 text-[17px] sm:px-6">
                      <span>{dish.course ? courseName(t, dish.course) : t('menus.noCourse')}</span>
                    </h3>
                  ) : null}
                  <div className="border-rule flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
                    <Link
                      to="/recipes/$recipeId"
                      params={{ recipeId: dish.recipeId }}
                      className="min-w-0 flex-1 text-[19px] font-medium hover:underline"
                    >
                      {dish.name}
                    </Link>
                    {dish.status === 'draft' ? (
                      <span className="tag tag-accent text-[11px]">{t('recipeStatus.draft')}</span>
                    ) : null}
                    {dish.changedSinceCards && menu.cardsPrintedAt ? (
                      <span className="tag text-[11px]">{t('menus.changed')}</span>
                    ) : null}
                    {canManage ? (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          className="btn-quiet h-9 w-9 p-0"
                          aria-label={t('common.moveUp')}
                          disabled={
                            update.isPending || menu.dishes[index - 1]?.course !== dish.course
                          }
                          onClick={() => move(index, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn-quiet h-9 w-9 p-0"
                          aria-label={t('common.moveDown')}
                          disabled={
                            update.isPending || menu.dishes[index + 1]?.course !== dish.course
                          }
                          onClick={() => move(index, 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn-quiet h-9 w-9 p-0"
                          aria-label={t('menus.removeDish', { name: dish.name })}
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({ dishes: ids.filter((id) => id !== dish.recipeId) })
                          }
                        >
                          ✕
                        </button>
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canManage ? (
          <form
            className="bg-surface border-line flex flex-wrap gap-2.5 border-t px-4 py-3 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!adding) return;
              update.mutate({ dishes: [...ids, adding] }, { onSuccess: () => setAdding('') });
            }}
          >
            <select
              aria-label={t('menus.addDish')}
              className="field min-h-11 min-w-[220px] flex-1"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
            >
              <option value="">{t('menus.pickDish')}</option>
              {available.map((dish) => (
                <option key={dish.id} value={dish.id}>
                  {dish.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="btn-primary min-h-11"
              disabled={!adding || update.isPending}
            >
              {t('menus.addDish')}
            </button>
            {available.length === 0 && dishes.isSuccess ? (
              <p className="text-ink-soft w-full text-sm">{t('menus.allDishesOn')}</p>
            ) : null}
          </form>
        ) : null}
        {update.error ? (
          <p role="alert" className="text-danger px-6 pb-3 text-sm">
            {errorMessage(translator, update.error)}
          </p>
        ) : null}
      </Plate>

      {canManage ? <MenuActions menu={menu} /> : null}
    </div>
  );
}

function MenuHeader({ menu, canManage }: { menu: Menu; canManage: boolean }) {
  const translator = useT();
  const { t } = translator;
  const update = useUpdateMenu(menu.id);
  const [name, setName] = useState(menu.name);
  const [description, setDescription] = useState(menu.description ?? '');
  const [status, setStatus] = useState<MenuStatus>(menu.status);

  useEffect(() => {
    setName(menu.name);
    setDescription(menu.description ?? '');
    setStatus(menu.status);
  }, [menu.name, menu.description, menu.status]);

  if (!canManage) {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[34px] sm:text-[44px]">{menu.name}</h1>
          <span className="tag text-[12px]">{menuStatusName(t, menu.status)}</span>
        </div>
        {menu.description ? <p className="text-ink-soft mt-1 text-lg">{menu.description}</p> : null}
      </div>
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name, description: description || null, status });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label={t('menus.name')}
          className="font-display text-ink border-field focus-visible:border-accent min-w-0 flex-1 border-b-2 bg-transparent px-1 text-[34px] font-semibold focus-visible:outline-none sm:text-[40px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
        <select
          aria-label={t('menus.status')}
          className="field min-h-11 w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value as MenuStatus)}
        >
          {(['draft', 'active', 'archived'] as const).map((value) => (
            <option key={value} value={value}>
              {menuStatusName(t, value)}
            </option>
          ))}
        </select>
      </div>
      <textarea
        aria-label={t('menus.description')}
        className="field min-h-16 py-2"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('menus.descriptionPlaceholder')}
        maxLength={1000}
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary min-h-11" disabled={update.isPending}>
          {update.isPending ? t('common.saving') : t('common.save')}
        </button>
        {update.isSuccess ? (
          <span className="text-ink-soft text-sm">{t('common.saved')}</span>
        ) : null}
        {update.error ? (
          <span role="alert" className="text-danger text-sm">
            {errorMessage(translator, update.error)}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * What a menu prints: its allergen overview, and all its dish cards in one
 * PDF. Downloading the cards marks them as printed, so the list above can say
 * which dishes have changed since.
 */
function Printing({ menu }: { menu: Menu }) {
  const translator = useT();
  const { t, locale } = translator;
  const { data: user } = useCurrentUser();
  const settings = useDishCardSettings();
  const markPrinted = useMarkCardsPrinted(menu.id);
  const kitchenLanguage = user?.kitchenLanguage ?? 'en';
  const [language, setLanguage] = useState<Language>(kitchenLanguage);
  const [theme, setTheme] = useState<DishCardTheme | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const chosenTheme = theme ?? settings.data?.theme ?? 'day';

  async function downloadCards() {
    setFailed(false);
    setProgress(0);
    try {
      const { renderMenuCards } = await import('../lib/dishcard/menuCards.js');
      const cardT = createTranslator(language).t;
      const title = `${cardT('menus.cardsTitle')} – ${menu.name}`;
      const blob = await renderMenuCards({
        dishIds: menu.dishes.map((dish) => dish.recipeId),
        menuName: menu.name,
        title,
        language,
        kitchenLanguage,
        theme: chosenTheme,
        onProgress: setProgress,
      });
      saveFile(blob, `${title}.pdf`);
      markPrinted.mutate();
    } catch {
      setFailed(true);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Plate className="bg-surface-raised px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Link
          to="/menus/$menuId/overview"
          params={{ menuId: menu.id }}
          className="btn-primary min-h-11"
        >
          {t('menus.overview')}
        </Link>

        <span className="bg-line hidden h-11 w-px sm:block" aria-hidden />

        <label className="flex flex-col gap-1">
          <span className="eyebrow">{t('card.language')}</span>
          <select
            className="field min-h-11"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="eyebrow mb-1">{t('card.theme')}</legend>
          <div className="flex gap-1.5">
            {(['day', 'night'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={chosenTheme === value}
                onClick={() => setTheme(value)}
                className="toggle min-h-11"
              >
                {value === 'day' ? t('card.themeDay') : t('card.themeNight')}
              </button>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className="btn-quiet min-h-11"
          disabled={progress !== null || menu.dishes.length === 0}
          onClick={() => void downloadCards()}
        >
          {progress !== null
            ? t('menus.cardsProgress', { done: progress, total: menu.dishes.length })
            : t('menus.allCards')}
        </button>
      </div>
      <p className="text-ink-soft mt-3 text-sm">
        {menu.cardsPrintedAt
          ? t('menus.lastPrinted', {
              when: new Date(menu.cardsPrintedAt).toLocaleString(locale, {
                day: 'numeric',
                month: 'long',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })
          : t('menus.neverPrinted')}
      </p>
      {failed ? (
        <p role="alert" className="text-danger mt-2 text-sm">
          {t('card.downloadFailed')}
        </p>
      ) : null}
    </Plate>
  );
}

function MenuActions({ menu }: { menu: Menu }) {
  const translator = useT();
  const { t } = translator;
  const navigate = useNavigate();
  const duplicate = useDuplicateMenu(menu.id);
  const remove = useDeleteMenu();
  const [copyName, setCopyName] = useState('');
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="border-line flex flex-wrap items-start gap-3 border-t pt-5">
      <form
        className="flex flex-wrap gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          duplicate.mutate(copyName, {
            onSuccess: (copy) =>
              void navigate({ to: '/menus/$menuId', params: { menuId: copy.id } }),
          });
        }}
      >
        <input
          aria-label={t('menus.copyName')}
          className="field min-h-11 w-56"
          value={copyName}
          onChange={(e) => setCopyName(e.target.value)}
          placeholder={t('menus.copyPlaceholder', { name: menu.name })}
          maxLength={120}
          required
        />
        <button type="submit" className="btn-quiet min-h-11" disabled={duplicate.isPending}>
          {t('menus.duplicate')}
        </button>
      </form>
      <button
        type="button"
        className="btn-danger min-h-11 sm:ml-auto"
        disabled={remove.isPending}
        onClick={() =>
          confirming
            ? remove.mutate(menu.id, { onSuccess: () => void navigate({ to: '/menus' }) })
            : setConfirming(true)
        }
      >
        {confirming ? t('common.reallyDelete') : t('menus.delete')}
      </button>
      {(duplicate.error ?? remove.error) ? (
        <p role="alert" className="text-danger w-full text-sm">
          {errorMessage(translator, duplicate.error ?? remove.error)}
        </p>
      ) : null}
    </div>
  );
}
