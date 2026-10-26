import { useState, type FormEvent, type ReactNode } from 'react';
import type { BaseUnit, Ingredient } from '@mise/contracts';
import { ALLERGENS, type Allergen } from '@mise/domain';
import { useCurrentUser } from '../api/session.js';
import {
  useCreateIngredient,
  useDeleteIngredient,
  useIngredients,
  useUpdateIngredient,
} from '../api/recipes.js';
import { AppShell } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate } from '../components/Plate.js';
import { allergenName, errorMessage, useT, type Translator } from '../i18n/index.js';

/**
 * The raw material catalogue.
 *
 * Three numbers here do all the work and none of them are self-explanatory,
 * so they get their own columns and the foot of the page says what each is
 * for, rather than assuming a chef knows why software wants a density.
 */

const COLUMNS = 'sm:grid-cols-[minmax(0,1fr)_96px_96px_96px]';

export function Ingredients() {
  const { t } = useT();
  const { data: user } = useCurrentUser();
  const [search, setSearch] = useState('');
  const ingredients = useIngredients(search || undefined);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  if (!user) return null;
  const canManage = user.role !== 'cook';

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-0 py-4 sm:px-6 sm:py-8">
        <Plate className="border-x-0 sm:border-x">
          <div className="bg-surface-raised border-line border-b px-4 pt-5 pb-4 sm:px-6 sm:pt-[22px]">
            <h1 className="text-[34px] leading-none sm:text-[36px]">{t('nav.ingredients')}</h1>
            <p className="text-ink-soft mt-1 mb-3.5 text-[15px]">{t('ingredients.subtitle')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                aria-label={t('ingredients.search')}
                className="field min-w-[180px] flex-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('ingredients.search')}
              />
              {canManage ? (
                <button
                  type="button"
                  className="btn-primary min-h-11"
                  onClick={() => setAdding(true)}
                >
                  {t('ingredients.new')}
                </button>
              ) : null}
            </div>
          </div>

          {adding ? (
            <div className="bg-surface border-line border-b px-4 py-5 sm:px-6">
              <IngredientForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
            </div>
          ) : null}

          <div className="bg-surface-raised">
            <div className={`col-head hidden gap-2.5 px-6 py-[9px] sm:grid ${COLUMNS}`}>
              <span>{t('common.name')}</span>
              <span className="text-right">{t('ingredients.colYield')}</span>
              <span className="text-right">{t('ingredients.colDensity')}</span>
              <span className="text-right">{t('ingredients.colEach')}</span>
            </div>

            {ingredients.isPending ? (
              <p className="text-ink-soft px-6 py-6">{t('common.loading')}</p>
            ) : null}

            {ingredients.isError ? (
              <LoadError className="m-4 sm:m-6" onRetry={() => void ingredients.refetch()} />
            ) : null}

            {ingredients.data?.length === 0 ? (
              <p className="text-ink-soft px-6 py-10 text-center">
                {search ? t('ingredients.noMatch') : t('ingredients.empty')}
              </p>
            ) : null}

            <ul>
              {ingredients.data?.map((ingredient) => {
                const open = editing === ingredient.id;
                const row = (
                  <>
                    <span className="min-w-0">
                      <span className="text-[19px] font-medium">{ingredient.name}</span>
                      <span className="text-ink-soft block text-sm">{describe(t, ingredient)}</span>
                      {ingredient.allergens.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {ingredient.allergens.map((allergen) => (
                            <span key={allergen} className="tag tag-ink px-1.5 py-0 text-[11px]">
                              {allergenName(t, allergen)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    <Figure value={`${ingredient.yieldPercent}%`} />
                    <Figure value={ingredient.densityGPerMl} />
                    <Figure value={ingredient.itemWeightG} />
                  </>
                );
                const rowClass = `grid grid-cols-1 items-baseline gap-2.5 px-4 py-3 text-left sm:px-6 ${COLUMNS}`;

                return (
                  <li key={ingredient.id} className="border-rule border-b">
                    {canManage ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        className={`hover:bg-surface-sunk w-full transition-colors ${rowClass}`}
                        onClick={() => setEditing(open ? null : ingredient.id)}
                      >
                        {row}
                      </button>
                    ) : (
                      <div className={rowClass}>{row}</div>
                    )}

                    {open ? (
                      <div className="bg-surface border-line border-t px-4 py-5 sm:px-6">
                        <IngredientForm
                          ingredient={ingredient}
                          onDone={() => setEditing(null)}
                          onCancel={() => setEditing(null)}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="bg-surface-sunk border-line flex flex-col gap-3 border-t px-4 py-[18px] sm:px-6">
            <span className="eyebrow">{t('ingredients.explainTitle')}</span>
            <Explainer figure="90%" title={t('ingredients.yieldTitle')}>
              {t('ingredients.yieldBody')}
            </Explainer>
            <Explainer figure="0.92" title={t('ingredients.densityTitle')}>
              {t('ingredients.densityBody')}
            </Explainer>
            <Explainer figure="170" title={t('ingredients.eachTitle')}>
              {t('ingredients.eachBody')}
            </Explainer>
          </div>
        </Plate>
      </main>
    </AppShell>
  );
}

function Figure({ value }: { value: string | number | null }) {
  return value === null ? (
    <span className="text-ink-faint hidden text-right sm:block">—</span>
  ) : (
    <span className="qty hidden text-right text-[22px] sm:block">{value}</span>
  );
}

function Explainer({
  figure,
  title,
  children,
}: {
  figure: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3.5">
      <span className="qty w-[64px] shrink-0 text-right text-[26px] sm:w-[74px] sm:text-[30px]">
        {figure}
      </span>
      <span className="text-[15px] leading-[1.45] text-pretty">
        <b className="font-semibold">{title}</b> {children}
      </span>
    </div>
  );
}

function describe(t: Translator['t'], ingredient: Ingredient): string {
  const parts: string[] = [];
  if (ingredient.category) parts.push(ingredient.category);
  parts.push(unitLabel(t, ingredient.baseUnit));
  if (ingredient.vegan) parts.push(t('ingredients.vegan'));
  return parts.join(' · ');
}

function splitNames(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

function unitLabel(t: Translator['t'], baseUnit: BaseUnit): string {
  if (baseUnit === 'ml') return t('ingredients.byVolume');
  if (baseUnit === 'each') return t('ingredients.counted');
  return t('ingredients.weighed');
}

function IngredientForm({
  ingredient,
  onDone,
  onCancel,
}: {
  ingredient?: Ingredient;
  onDone: () => void;
  onCancel: () => void;
}) {
  const translator = useT();
  const { t } = translator;
  const create = useCreateIngredient();
  const update = useUpdateIngredient();
  const remove = useDeleteIngredient();

  const [name, setName] = useState(ingredient?.name ?? '');
  const [category, setCategory] = useState(ingredient?.category ?? '');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(ingredient?.baseUnit ?? 'g');
  const [allergens, setAllergens] = useState<Allergen[]>(
    (ingredient?.allergens ?? []) as Allergen[],
  );
  const [density, setDensity] = useState(
    ingredient?.densityGPerMl ? String(ingredient.densityGPerMl) : '',
  );
  const [itemWeight, setItemWeight] = useState(
    ingredient?.itemWeightG ? String(ingredient.itemWeightG) : '',
  );
  const [yieldPercent, setYieldPercent] = useState(String(ingredient?.yieldPercent ?? 100));
  const [vegan, setVegan] = useState<boolean | null>(ingredient?.vegan ?? null);
  const [cereals, setCereals] = useState((ingredient?.allergenDetails.gluten ?? []).join(', '));
  const [nuts, setNuts] = useState((ingredient?.allergenDetails.nuts ?? []).join(', '));
  const [confirming, setConfirming] = useState(false);

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error ?? remove.error;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name,
      category: category || null,
      baseUnit,
      allergens,
      densityGPerMl: density ? Number(density) : null,
      itemWeightG: itemWeight ? Number(itemWeight) : null,
      yieldPercent: Number(yieldPercent),
      vegan,
      // Names only count for an allergen that is ticked.
      allergenDetails: {
        gluten: allergens.includes('gluten') ? splitNames(cereals) : [],
        nuts: allergens.includes('nuts') ? splitNames(nuts) : [],
      },
    };
    if (ingredient) update.mutate({ id: ingredient.id, ...payload }, { onSuccess: onDone });
    else create.mutate(payload, { onSuccess: onDone });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            {t('common.name')}
          </label>
          <input
            id="name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="category">
            {t('ingredients.category')}
          </label>
          <input
            id="category"
            className="field"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t('ingredients.categoryPlaceholder')}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="baseUnit">
          {t('ingredients.measured')}
        </label>
        <select
          id="baseUnit"
          className="field sm:max-w-64"
          value={baseUnit}
          onChange={(e) => setBaseUnit(e.target.value as BaseUnit)}
        >
          <option value="g">{t('ingredients.optWeight')}</option>
          <option value="ml">{t('ingredients.optVolume')}</option>
          <option value="each">{t('ingredients.optCount')}</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          id="yieldPercent"
          label={t('ingredients.yieldLabel')}
          value={yieldPercent}
          onChange={setYieldPercent}
          required
          min={1}
          max={100}
          hint={t('ingredients.yieldHint')}
        />
        <NumberField
          id="density"
          label={t('ingredients.densityLabel')}
          value={density}
          onChange={setDensity}
          hint={t('ingredients.densityHint')}
        />
        <NumberField
          id="itemWeight"
          label={t('ingredients.eachLabel')}
          value={itemWeight}
          onChange={setItemWeight}
          hint={t('ingredients.eachHint')}
        />
      </div>

      <fieldset>
        <legend className="label">{t('ingredients.allergens')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map((allergen) => (
            <button
              key={allergen}
              type="button"
              aria-pressed={allergens.includes(allergen)}
              onClick={() =>
                setAllergens((current) =>
                  current.includes(allergen)
                    ? current.filter((a) => a !== allergen)
                    : [...current, allergen],
                )
              }
              className="toggle"
            >
              {allergenName(t, allergen)}
            </button>
          ))}
        </div>
      </fieldset>

      {allergens.includes('gluten') || allergens.includes('nuts') ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {allergens.includes('gluten') ? (
            <div>
              <label className="label" htmlFor="cereals">
                {t('ingredients.whichCereals')}
              </label>
              <input
                id="cereals"
                className="field"
                value={cereals}
                onChange={(e) => setCereals(e.target.value)}
                placeholder={t('ingredients.cerealsPlaceholder')}
              />
            </div>
          ) : null}
          {allergens.includes('nuts') ? (
            <div>
              <label className="label" htmlFor="nuts">
                {t('ingredients.whichNuts')}
              </label>
              <input
                id="nuts"
                className="field"
                value={nuts}
                onChange={(e) => setNuts(e.target.value)}
                placeholder={t('ingredients.nutsPlaceholder')}
              />
            </div>
          ) : null}
          <p className="text-ink-soft text-sm sm:col-span-2">{t('ingredients.detailsHint')}</p>
        </div>
      ) : null}

      <fieldset>
        <legend className="label">{t('ingredients.vegan')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              [true, t('ingredients.veganYes')],
              [false, t('ingredients.veganNo')],
              [null, t('ingredients.veganUnknown')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={String(value)}
              type="button"
              aria-pressed={vegan === value}
              onClick={() => setVegan(value)}
              className="toggle"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-ink-soft mt-1.5 text-sm">{t('ingredients.veganHint')}</p>
      </fieldset>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(translator, error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn-quiet" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        {ingredient ? (
          <button
            type="button"
            className="btn-danger ml-auto"
            onClick={() =>
              confirming ? remove.mutate(ingredient.id, { onSuccess: onDone }) : setConfirming(true)
            }
            disabled={remove.isPending}
          >
            {confirming ? t('common.reallyDelete') : t('common.delete')}
          </button>
        ) : null}
      </div>
    </form>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  hint,
  required,
  min = 0,
  max,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  required?: boolean;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step="any"
        min={min}
        max={max}
        className="field qty text-xl"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      <p className="text-ink-soft mt-1.5 text-sm">{hint}</p>
    </div>
  );
}
