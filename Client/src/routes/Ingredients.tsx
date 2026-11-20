import { useState, type FormEvent } from 'react';
import type {
  BaseUnit,
  Currency,
  Ingredient,
  IngredientPrice,
  IngredientPriceInput,
} from '@mise/contracts';
import {
  ALL_UNITS,
  ALLERGENS,
  dimensionOf,
  hasAnimalAllergen,
  type Allergen,
  type Dimension,
  type UnitCode,
} from '@mise/domain';
import { useKitchen } from '../api/kitchen.js';
import { useCurrentUser } from '../api/session.js';
import {
  useCreateIngredient,
  useDeleteIngredient,
  useIngredients,
  useUpdateIngredient,
} from '../api/recipes.js';
import { AppShell } from '../components/AppShell.js';
import { ingredientPriceText } from '../components/Cost.js';
import { DeliveryCheck } from '../components/DeliveryCheck.js';
import {
  LabelCheckForm,
  LabelCheckHistory,
  LabelCheckLine,
  type LabelCheckOutcome,
} from '../components/LabelCheck.js';
import { LoadError } from '../components/LoadError.js';
import { PendingLabelChecks } from '../components/PendingLabelChecks.js';
import { NumberInput } from '../components/NumberInput.js';
import { Plate } from '../components/Plate.js';
import { allergenName, errorMessage, useT, type Translator } from '../i18n/index.js';
import { numberText, readNumber, type NumberRules } from '../lib/typedNumber.js';

/**
 * The raw material catalogue: what goes into the recipes, and what is in it.
 *
 * Trim yield, density and weight per piece were left out from 2.2.4 while
 * nothing used them; they are back with costing, where they count. Prices
 * are for chefs and administrators: a cook's list comes without them.
 *
 * Cooks come here too, to check labels when a delivery comes in: whoever
 * takes it reads the labels. A cook's check that finds a difference waits
 * for a chef, listed at the top of this page.
 */

const OUTCOME_MESSAGE: Record<LabelCheckOutcome, 'labelCheck.saved' | 'labelCheck.savedPending'> = {
  same: 'labelCheck.saved',
  applied: 'labelCheck.saved',
  pending: 'labelCheck.savedPending',
};

export function Ingredients() {
  const { t, locale } = useT();
  const { data: user } = useCurrentUser();
  const [search, setSearch] = useState('');
  // The whole list, searched here rather than by Mise: it is the list kept
  // on the tablet, so a delivery's labels can be found and checked offline.
  const everything = useIngredients(undefined);
  const term = search.trim().toLocaleLowerCase(locale);
  const shown = everything.data?.filter(
    (ingredient) => !term || ingredient.name.toLocaleLowerCase(locale).includes(term),
  );
  // "No price yet" only means something once the kitchen prices its
  // ingredients; a kitchen that doesn't cost isn't told so on every line.
  const costing = (everything.data ?? []).some((ingredient) => ingredient.price);
  const kitchen = useKitchen();
  const currency: Currency = kitchen.data?.currency ?? 'EUR';
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [delivery, setDelivery] = useState(false);
  const [outcome, setOutcome] = useState<LabelCheckOutcome | null>(null);
  const all = everything.data ?? [];

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
              <button
                type="button"
                className="btn-quiet min-h-11"
                onClick={() => {
                  setDelivery(true);
                  setOutcome(null);
                }}
              >
                {t('delivery.start')}
              </button>
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
            {/* Always there, so a screen reader hears it when it fills. */}
            <p role="status" className={outcome ? 'text-ink-soft mt-2 text-sm' : 'sr-only'}>
              {outcome ? t(OUTCOME_MESSAGE[outcome]) : null}
            </p>
          </div>

          {canManage ? <PendingLabelChecks ingredients={all} /> : null}

          {delivery ? (
            <div className="bg-surface border-line border-b px-4 py-5 sm:px-6">
              <DeliveryCheck ingredients={all} onClose={() => setDelivery(false)} />
            </div>
          ) : null}

          {adding ? (
            <div className="bg-surface border-line border-b px-4 py-5 sm:px-6">
              <IngredientForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
            </div>
          ) : null}

          <div className="bg-surface-raised">
            {everything.isPending ? (
              <p className="text-ink-soft px-6 py-6">{t('common.loading')}</p>
            ) : null}

            {everything.isError && everything.data === undefined ? (
              <LoadError className="m-4 sm:m-6" onRetry={() => void everything.refetch()} />
            ) : null}

            {shown?.length === 0 ? (
              <p className="text-ink-soft px-6 py-10 text-center">
                {search ? t('ingredients.noMatch') : t('ingredients.empty')}
              </p>
            ) : null}

            <ul>
              {shown?.map((ingredient) => {
                const open = editing === ingredient.id;
                const row = (
                  <>
                    <span className="min-w-0">
                      <span className="text-[19px] font-medium">{ingredient.name}</span>
                      <span className="text-ink-soft block text-sm">{describe(t, ingredient)}</span>
                      <PriceLine ingredient={ingredient} currency={currency} costing={costing} />
                      {ingredient.allergens.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {ingredient.allergens.map((allergen) => (
                            <span key={allergen} className="tag tag-ink px-1.5 py-0 text-[11px]">
                              {allergenName(t, allergen)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      {ingredient.mayContain.length > 0 ? (
                        <span className="text-ink-soft mt-1 block text-sm">
                          {t('recipe.mayContain', {
                            allergens: ingredient.mayContain
                              .map((allergen) => allergenName(t, allergen))
                              .join(', '),
                          })}
                        </span>
                      ) : null}
                      <LabelCheckLine ingredient={ingredient} />
                    </span>
                  </>
                );
                const rowClass = 'block min-w-0 flex-1 px-4 py-3 text-left sm:px-6';
                const labelOpen = checking === ingredient.id;

                return (
                  <li key={ingredient.id} className="border-rule border-b">
                    <div className="flex items-start">
                      {canManage ? (
                        <button
                          type="button"
                          aria-expanded={open}
                          className={`hover:bg-surface-sunk transition-colors ${rowClass}`}
                          onClick={() => setEditing(open ? null : ingredient.id)}
                        >
                          {row}
                        </button>
                      ) : (
                        <div className={rowClass}>{row}</div>
                      )}
                      <button
                        type="button"
                        className="btn-small my-3 mr-4 shrink-0 sm:mr-6"
                        aria-expanded={labelOpen}
                        aria-label={`${t('labelCheck.check')}: ${ingredient.name}`}
                        onClick={() => {
                          setChecking(labelOpen ? null : ingredient.id);
                          setOutcome(null);
                        }}
                      >
                        {t('labelCheck.check')}
                      </button>
                    </div>
                    {ingredient.labelCheck ? (
                      <div className="px-4 pb-3 sm:px-6">
                        <LabelCheckHistory ingredientId={ingredient.id} />
                      </div>
                    ) : null}

                    {labelOpen ? (
                      <div className="bg-surface border-line border-t px-4 py-5 sm:px-6">
                        <LabelCheckForm
                          ingredient={ingredient}
                          ingredients={all}
                          onDone={(done) => {
                            setChecking(null);
                            setOutcome(done);
                          }}
                          onCancel={() => setChecking(null)}
                        />
                      </div>
                    ) : null}

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
        </Plate>
      </main>
    </AppShell>
  );
}

/** What it costs, for chefs; nothing at all for a cook, whose list has no prices. */
function PriceLine({
  ingredient,
  currency,
  costing,
}: {
  ingredient: Ingredient;
  currency: Currency;
  costing: boolean;
}) {
  const translator = useT();
  if (ingredient.price === undefined) return null;
  if (ingredient.price === null && !costing) return null;
  return (
    <span className="text-ink-soft qty block text-sm">
      {ingredient.price === null
        ? translator.t('cost.noPrice')
        : ingredientPriceText(translator, currency, ingredient.price, ingredient.baseUnit)}
    </span>
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

const DIMENSION_OF_BASE: Record<BaseUnit, Dimension> = { g: 'mass', ml: 'volume', each: 'count' };

/** Whether the price in the form is still the one it was shown. */
function samePrice(price: IngredientPriceInput | null, shown: IngredientPrice | null): boolean {
  if (!price || !shown) return price === shown;
  return (
    price.amount === shown.amount &&
    price.quantity.value === shown.quantity.value &&
    price.quantity.unit === shown.quantity.unit
  );
}

/** What a new price is most likely for: weighed things by the kilo, liquids by the litre. */
function defaultPurchaseUnit(baseUnit: BaseUnit): UnitCode {
  if (baseUnit === 'g') return 'kg';
  if (baseUnit === 'ml') return 'l';
  return 'each';
}

function unitLabel(t: Translator['t'], baseUnit: BaseUnit): string {
  if (baseUnit === 'ml') return t('ingredients.byVolume');
  if (baseUnit === 'each') return t('ingredients.counted');
  return t('ingredients.weighed');
}

// What each box will take; the server holds the same limits.
const PRICE: NumberRules = { min: 0, max: 1_000_000 };
const PRICE_FOR: NumberRules = { above: 0, max: 1_000_000 };
const YIELD: NumberRules = { above: 0, max: 100, percent: true };
const DENSITY: NumberRules = { above: 0, max: 30 };
const ITEM_WEIGHT: NumberRules = { above: 0, max: 100_000 };

export function IngredientForm({
  ingredient,
  onDone,
  onCancel,
}: {
  ingredient?: Ingredient;
  onDone: () => void;
  onCancel: () => void;
}) {
  const translator = useT();
  const { t, locale } = translator;
  const create = useCreateIngredient();
  const update = useUpdateIngredient();
  const remove = useDeleteIngredient();

  const [name, setName] = useState(ingredient?.name ?? '');
  const [category, setCategory] = useState(ingredient?.category ?? '');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(ingredient?.baseUnit ?? 'g');
  const [allergens, setAllergens] = useState<Allergen[]>(
    (ingredient?.allergens ?? []) as Allergen[],
  );
  const [mayContain, setMayContain] = useState<Allergen[]>(
    (ingredient?.mayContain ?? []) as Allergen[],
  );
  const [vegan, setVegan] = useState<boolean | null>(ingredient?.vegan ?? null);
  const [cereals, setCereals] = useState((ingredient?.allergenDetails.gluten ?? []).join(', '));
  const [nuts, setNuts] = useState((ingredient?.allergenDetails.nuts ?? []).join(', '));
  const [confirming, setConfirming] = useState(false);
  const [priceAmount, setPriceAmount] = useState(
    ingredient?.price ? numberText(ingredient.price.amount, locale, { money: true }) : '',
  );
  const [priceQuantity, setPriceQuantity] = useState(
    ingredient?.price ? numberText(ingredient.price.quantity.value, locale) : '',
  );
  const [priceUnit, setPriceUnit] = useState<UnitCode>(
    (ingredient?.price?.quantity.unit as UnitCode | undefined) ?? defaultPurchaseUnit(baseUnit),
  );
  const [yieldPercent, setYieldPercent] = useState(
    numberText(ingredient?.yieldPercent ?? 100, locale),
  );
  const [density, setDensity] = useState(numberText(ingredient?.densityGPerMl, locale));
  const [itemWeight, setItemWeight] = useState(numberText(ingredient?.itemWeightG, locale));

  // Density and weight per piece only when the purchase needs them to reach
  // how it is measured, or when one was entered before.
  const crossing = new Set<Dimension>([dimensionOf(priceUnit), DIMENSION_OF_BASE[baseUnit]]);
  // Or when asked for: a recipe may measure it in a way the purchase doesn't
  // need, and its cost then asks for one of these.
  const [conversions, setConversions] = useState(false);
  const showDensity =
    conversions || (crossing.size > 1 && crossing.has('volume')) || density !== '';
  const showItemWeight =
    conversions || (crossing.size > 1 && crossing.has('count')) || itemWeight !== '';

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error ?? remove.error;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const typed = [
      readNumber(priceAmount, PRICE),
      readNumber(priceQuantity, PRICE_FOR),
      readNumber(yieldPercent, YIELD),
      readNumber(density, DENSITY),
      readNumber(itemWeight, ITEM_WEIGHT),
    ] as const;
    // Each box says what is wrong with it; nothing is saved as another number.
    if (typed.some((read) => read.problem)) return;
    const [amount, per, yieldValue, densityValue, itemWeightValue] = typed.map(
      (read) => read.value,
    );
    // Unknown unless both are filled in: half a price is no price.
    const price =
      amount != null && per != null ? { amount, quantity: { value: per, unit: priceUnit } } : null;
    const shown = ingredient?.price;
    const priceTouched = !ingredient || (shown !== undefined && !samePrice(price, shown));
    const payload = {
      name,
      category: category || null,
      baseUnit,
      allergens,
      // A trace of what it contains anyway says nothing more.
      mayContain: mayContain.filter((allergen) => !allergens.includes(allergen)),
      vegan,
      // Names only count for an allergen that is ticked.
      allergenDetails: {
        gluten: allergens.includes('gluten') ? splitNames(cereals) : [],
        nuts: allergens.includes('nuts') ? splitNames(nuts) : [],
      },
      yieldPercent: yieldValue ?? 100,
      densityGPerMl: densityValue ?? null,
      itemWeightG: itemWeightValue ?? null,
      // Only a price changed here is sent: not one this form wasn't shown, so
      // it can't be wiped unseen, and not the one it was shown, which would
      // undo a new price someone entered meanwhile. A new price alone keeps
      // the ingredient's version, so it goes with the price it replaces.
      ...(priceTouched ? { price } : {}),
      ...(priceTouched && shown !== undefined ? { priceBase: shown?.updatedAt ?? null } : {}),
    };
    if (ingredient)
      update.mutate(
        { id: ingredient.id, base: ingredient.updatedAt, ...payload },
        { onSuccess: onDone },
      );
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

      <fieldset className="flex flex-col gap-4">
        <legend className="label">{t('ingredients.costing')}</legend>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="priceAmount">
              {t('ingredients.price')}
            </label>
            <NumberInput
              id="priceAmount"
              rules={PRICE}
              money
              className="field w-32"
              value={priceAmount}
              onText={setPriceAmount}
            />
          </div>
          <div>
            <label className="label" htmlFor="priceQuantity">
              {t('ingredients.priceFor')}
            </label>
            <NumberInput
              id="priceQuantity"
              rules={PRICE_FOR}
              className="field w-28"
              value={priceQuantity}
              onText={setPriceQuantity}
            />
          </div>
          <div>
            <label className="label" htmlFor="priceUnit">
              {t('ingredients.priceUnit')}
            </label>
            <select
              id="priceUnit"
              className="field"
              value={priceUnit}
              onChange={(e) => setPriceUnit(e.target.value as UnitCode)}
            >
              {ALL_UNITS.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-ink-soft -mt-2 text-sm">{t('ingredients.priceHint')}</p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="yieldPercent">
              {t('ingredients.yieldLabel')}
            </label>
            <NumberInput
              id="yieldPercent"
              rules={YIELD}
              className="field"
              value={yieldPercent}
              onText={setYieldPercent}
              aria-describedby="yieldHint"
            />
            <p id="yieldHint" className="text-ink-soft mt-1.5 text-sm">
              {t('ingredients.yieldHint')}
            </p>
          </div>
          {showDensity ? (
            <div>
              <label className="label" htmlFor="density">
                {t('ingredients.densityLabel')}
              </label>
              <NumberInput
                id="density"
                rules={DENSITY}
                className="field"
                value={density}
                onText={setDensity}
                aria-describedby="densityHint"
              />
              <p id="densityHint" className="text-ink-soft mt-1.5 text-sm">
                {t('ingredients.densityHint')}
              </p>
            </div>
          ) : null}
          {showItemWeight ? (
            <div>
              <label className="label" htmlFor="itemWeight">
                {t('ingredients.eachLabel')}
              </label>
              <NumberInput
                id="itemWeight"
                rules={ITEM_WEIGHT}
                className="field"
                value={itemWeight}
                onText={setItemWeight}
                aria-describedby="itemWeightHint"
              />
              <p id="itemWeightHint" className="text-ink-soft mt-1.5 text-sm">
                {t('ingredients.eachHint')}
              </p>
            </div>
          ) : null}
          {!showDensity || !showItemWeight ? (
            <div className="self-end">
              <button type="button" className="btn-small" onClick={() => setConversions(true)}>
                {t('ingredients.addConversions')}
              </button>
            </div>
          ) : null}
        </div>
      </fieldset>

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

      <fieldset>
        <legend className="label">{t('ingredients.mayContain')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map((allergen) => {
            const contained = allergens.includes(allergen);
            return (
              <button
                key={allergen}
                type="button"
                // Contained already: more than a trace, so not offered here.
                disabled={contained}
                aria-pressed={!contained && mayContain.includes(allergen)}
                onClick={() =>
                  setMayContain((current) =>
                    current.includes(allergen)
                      ? current.filter((a) => a !== allergen)
                      : [...current, allergen],
                  )
                }
                className="toggle disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allergenName(t, allergen)}
              </button>
            );
          })}
        </div>
        <p className="text-ink-soft mt-1.5 text-sm">{t('ingredients.mayContainHint')}</p>
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
        {vegan === true && hasAnimalAllergen(allergens) ? (
          <p role="alert" className="text-danger mt-1.5 text-sm font-medium">
            {t('ingredients.veganConflict')}
          </p>
        ) : null}
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
