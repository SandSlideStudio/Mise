import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { GeneratePrepListResponse, PrepTask, Service } from '@mise/contracts';
import { useRecipes } from '../api/recipes.js';
import { useAddServiceDish, useGeneratePrepList, useRemoveServiceDish } from '../api/services.js';
import { errorMessage, useT, type Translator } from '../i18n/index.js';
import { Plate, PlateHead } from './Plate.js';

/**
 * What is on tonight, and the button that turns it into a prep list.
 *
 * Only dishes appear in the picker. A stock is not something you sell twenty
 * of; it is something the explosion works out you need because of what you
 * did sell. The regeneration guarantee is not a sentence under the button but
 * a ticked receipt beside it, counted from the list as it stands.
 */
export function ServiceMenu({ service, tasks }: { service: Service; tasks: PrepTask[] }) {
  const translator = useT();
  const { t, plural, locale } = translator;
  const dishes = useRecipes({ type: 'dish' });
  const addDish = useAddServiceDish(service.id);
  const removeDish = useRemoveServiceDish(service.id);
  const generate = useGeneratePrepList(service.id);

  const [recipeId, setRecipeId] = useState('');
  const [portions, setPortions] = useState('');

  const available = useMemo(
    () => (dishes.data ?? []).filter((d) => !service.dishes.some((sd) => sd.recipeId === d.id)),
    [dishes.data, service.dishes],
  );

  const planned = service.dishes.reduce((total, dish) => total + dish.plannedPortions, 0);
  const ticked = tasks.filter((task) => task.status === 'done').length;
  const byHand = tasks.filter((task) => task.source === 'manual').length;

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!recipeId || !portions) return;
    addDish.mutate(
      { recipeId, plannedPortions: Number(portions) },
      {
        onSuccess: () => {
          setRecipeId('');
          setPortions('');
        },
      },
    );
  }

  return (
    <Plate className="no-print">
      <PlateHead
        title={t('menu.title')}
        aside={
          service.covers
            ? t('menu.accounted', { planned, covers: service.covers })
            : planned > 0
              ? plural('menu.planned', planned)
              : undefined
        }
      />

      {service.dishes.length > 0 ? (
        <ul>
          {service.dishes.map((dish) => (
            <li
              key={dish.id}
              className="border-rule grid grid-cols-[minmax(0,1fr)_110px_40px] items-center gap-3 border-b px-[18px] py-3"
            >
              <span className="text-[19px] font-medium">{dish.recipeName}</span>
              <span className="qty text-right text-[26px]">{dish.plannedPortions}</span>
              <button
                type="button"
                className="border-line text-ink-soft hover:text-ink flex h-8 w-8 items-center justify-center justify-self-end border text-[15px]"
                onClick={() => removeDish.mutate(dish.id)}
                aria-label={t('menu.remove', { dish: dish.recipeName })}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-soft border-rule border-b px-[18px] py-4">{t('menu.empty')}</p>
      )}

      <form
        onSubmit={onAdd}
        className="bg-surface grid grid-cols-[minmax(0,1fr)_110px_40px] items-center gap-3 px-[18px] py-3"
      >
        <select
          aria-label={t('menu.addDish')}
          className={`field border-line border-dashed ${recipeId ? '' : 'text-ink-faint'}`}
          value={recipeId}
          onChange={(e) => setRecipeId(e.target.value)}
        >
          <option value="">{t('menu.addDish')}</option>
          {available.map((dish) => (
            <option key={dish.id} value={dish.id}>
              {dish.name}
            </option>
          ))}
        </select>
        <input
          aria-label={t('menu.covers')}
          type="number"
          inputMode="decimal"
          min={1}
          step="any"
          placeholder={t('menu.coversPlaceholder')}
          className="field qty border-line border-dashed text-right text-[22px] placeholder:font-sans placeholder:text-[17px] placeholder:font-normal"
          value={portions}
          onChange={(e) => setPortions(e.target.value)}
        />
        <button
          type="submit"
          aria-label={t('menu.putOn')}
          disabled={!recipeId || !portions || addDish.isPending}
          className="border-line bg-surface-raised text-ink hover:bg-surface-sunk h-11 w-10 justify-self-end border text-xl disabled:opacity-40"
        >
          +
        </button>
      </form>

      {(dishes.data ?? []).length === 0 && !dishes.isPending ? (
        <p className="text-ink-soft px-[18px] pb-3 text-sm">{t('menu.noDishes')}</p>
      ) : null}
      {addDish.error ? (
        <p role="alert" className="text-danger px-[18px] pb-3 text-sm">
          {errorMessage(translator, addDish.error)}
        </p>
      ) : null}

      <div className="bg-surface-sunk border-line flex flex-wrap items-center gap-x-[18px] gap-y-3 border-t px-[18px] py-4">
        <button
          type="button"
          className="btn-primary min-h-[52px] px-6 text-[22px]"
          disabled={service.dishes.length === 0 || generate.isPending}
          onClick={() => generate.mutate()}
        >
          {generate.isPending
            ? t('common.working')
            : service.generatedAt
              ? t('menu.generateAgain')
              : t('menu.generate')}
        </button>

        {service.generatedAt ? (
          <span className="flex flex-col gap-0.5">
            <Receipt>{plural('menu.ticked', ticked)}</Receipt>
            <Receipt>{plural('menu.byHand', byHand)}</Receipt>
          </span>
        ) : null}

        <span className="text-ink-soft ml-auto text-right text-sm">
          {service.generatedAt ? (
            <>
              {t('menu.lastGenerated', {
                time: new Date(service.generatedAt).toLocaleString(locale, {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              })}
              <br />
            </>
          ) : null}
          {t('menu.safe')}
        </span>
      </div>

      {generate.isSuccess ? (
        <p className="border-line text-ink border-t px-[18px] py-3 text-[15px]">
          {summarise(t, generate.data)}
        </p>
      ) : null}
      {generate.error ? (
        <p role="alert" className="border-line text-danger border-t px-[18px] py-3 text-[15px]">
          {errorMessage(translator, generate.error)}
        </p>
      ) : null}
    </Plate>
  );
}

function Receipt({ children }: { children: ReactNode }) {
  return (
    <span className="text-ink flex items-center gap-2 text-[15px]">
      <span
        aria-hidden
        className="bg-ink text-surface inline-flex h-[18px] w-[18px] items-center justify-center text-xs"
      >
        ✓
      </span>
      {children}
    </span>
  );
}

function summarise(t: Translator['t'], result: GeneratePrepListResponse): string {
  const parts: string[] = [];
  if (result.created) parts.push(t('menu.resultAdded', { count: result.created }));
  if (result.updated) parts.push(t('menu.resultUpdated', { count: result.updated }));
  if (result.removed) parts.push(t('menu.resultRemoved', { count: result.removed }));
  if (result.kept) parts.push(t('menu.resultKept', { count: result.kept }));
  return parts.length > 0
    ? t('menu.resultDone', { parts: parts.join(', ') })
    : t('menu.resultNothing');
}
