import type {
  CostGap,
  Currency,
  IngredientPrice,
  MenuCost,
  MenuDishCost,
  RecipeCost,
} from '@mise/contracts';
import { dimensionOf, unit as unitDef, type BaseUnit, type UnitCode } from '@mise/domain';
import { unitLabel, useT, type Translator } from '../i18n/index.js';

/**
 * Food cost on screen, for chefs and administrators. The server leaves every
 * cost out for a cook, so these only ever draw what they are given.
 *
 * Amounts are shown in the kitchen's currency in the reader's own language,
 * and per kilo or per litre rather than per gram: €0.0125 a gram reads as
 * nothing, €12.50 a kilo is what is on the invoice.
 */

export function formatMoney(locale: string, currency: Currency, amount: number): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

export function formatPercent(locale: string, percent: number): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    percent / 100,
  );
}

/** The unit a cost per gram, millilitre or piece reads best in. */
export function readableUnit(code: UnitCode): UnitCode {
  const def = unitDef(code);
  // A recipe written in pounds or cups is costed in them; anything metric per kilo or litre.
  if (def.system === 'imperial' || code === 'dozen') return code;
  if (def.dimension === 'mass') return 'kg';
  if (def.dimension === 'volume') return 'l';
  return 'each';
}

/** "€2.50 per kg", "€0.30 each": a cost per base unit, in the unit it reads best in. */
export function perUnitText(
  translator: Translator,
  currency: Currency,
  perBase: number,
  unit: UnitCode,
): string {
  const shown = readableUnit(unit);
  const amount = formatMoney(translator.locale, currency, perBase * unitDef(shown).toBase);
  return shown === 'each'
    ? translator.t('cost.each', { amount })
    : translator.t('cost.perUnit', { amount, unit: unitLabel(translator, shown, 1) });
}

/**
 * How old a price is, said only once it is older than six months: "price
 * from 8 months ago". Null for a recent one.
 */
export function priceAge(
  translator: Translator,
  updatedAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  const months =
    (now.getFullYear() - then.getFullYear()) * 12 +
    now.getMonth() -
    then.getMonth() -
    (now.getDate() < then.getDate() ? 1 : 0);
  if (months < 6 || (months === 6 && now.getDate() === then.getDate())) return null;
  const relative = new Intl.RelativeTimeFormat(translator.locale, { numeric: 'always' });
  const age =
    months >= 12
      ? relative.format(-Math.floor(months / 12), 'year')
      : relative.format(-months, 'month');
  return translator.t('cost.priceAge', { age });
}

/** What an ingredient costs, for its line in the list. */
export function ingredientPriceText(
  translator: Translator,
  currency: Currency,
  price: IngredientPrice,
  baseUnit: BaseUnit,
  now?: Date,
): string {
  if (price.perBase === null) return translator.t('cost.unconvertible');
  const parts = [perUnitText(translator, currency, price.perBase, baseUnit)];
  const age = priceAge(translator, price.updatedAt, now);
  if (age) parts.push(age);
  return parts.join(' · ');
}

/**
 * What a cost leaves out, by name: never a low number on its own. "Cost so
 * far · 2 ingredients without a price: water, salt."
 */
export function CostGaps({ gaps, className = '' }: { gaps: CostGap[]; className?: string }) {
  const { t, plural } = useT();
  if (gaps.length === 0) return null;
  const unpriced = gaps.filter((gap) => gap.reason === 'no_price').map((gap) => gap.name);
  const unconverted = gaps.filter((gap) => gap.reason === 'units').map((gap) => gap.name);
  return (
    <div role="note" className={`border-accent border-l-2 pl-3 text-sm ${className}`}>
      <p className="font-semibold">{t('cost.soFar')}</p>
      {unpriced.length > 0 ? (
        <p>{plural('cost.noPrice', unpriced.length, { names: unpriced.join(', ') })}</p>
      ) : null}
      {unconverted.length > 0 ? (
        <p>
          {plural('cost.cantConvert', unconverted.length, { names: unconverted.join(', ') })}{' '}
          <span className="text-ink-soft">{t('cost.cantConvertHint')}</span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * The cost of a recipe at the size on screen: "€4.20 per batch · €0.84 per
 * l", or "for this size" once scaled, and per portion when it is in portions.
 */
export function RecipeCostLine({
  cost,
  yieldUnit,
  scaled,
}: {
  cost: RecipeCost;
  yieldUnit: UnitCode;
  scaled: boolean;
}) {
  const translator = useT();
  const { t } = translator;
  const money = (amount: number) => formatMoney(translator.locale, cost.currency, amount);
  const parts = [t(scaled ? 'cost.forSize' : 'cost.perBatch', { amount: money(cost.total) })];
  // Per piece says nothing a portion doesn't for a dish made in plates.
  if (cost.perBase !== null && !(dimensionOf(yieldUnit) === 'count' && cost.perPortion !== null)) {
    parts.push(perUnitText(translator, cost.currency, cost.perBase, yieldUnit));
  }
  if (cost.perPortion !== null)
    parts.push(t('cost.perPortion', { amount: money(cost.perPortion) }));
  return (
    <section
      aria-labelledby="recipe-cost"
      className="no-print border-line bg-surface border-t px-4 py-4 sm:px-8"
    >
      <h2 id="recipe-cost" className="eyebrow mb-1">
        {t('cost.title')}
      </h2>
      <p className="qty text-lg">{parts.join(' · ')}</p>
      <CostGaps gaps={cost.gaps} className="mt-2" />
    </section>
  );
}

/** A dish's cost per portion, what it sells for, and its food cost %. */
export function DishCost({ cost, sellPrice }: { cost: RecipeCost; sellPrice: number | null }) {
  const translator = useT();
  const { t } = translator;
  const money = (amount: number) => formatMoney(translator.locale, cost.currency, amount);
  const figure = 'font-display text-[28px] leading-none font-semibold';
  return (
    <section aria-labelledby="dish-cost" className="card mt-6 flex flex-col gap-4">
      <h2 id="dish-cost" className="text-2xl">
        {t('cost.title')}
      </h2>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="eyebrow mb-1">{t('cost.costPerPortion')}</dt>
          <dd className={figure}>{money(cost.perPortion ?? cost.total)}</dd>
        </div>
        <div>
          <dt className="eyebrow mb-1">{t('cost.sellPrice')}</dt>
          <dd className={sellPrice !== null ? figure : 'text-ink-soft'}>
            {sellPrice !== null ? money(sellPrice) : t('cost.noSellPrice')}
          </dd>
        </div>
        {cost.foodCostPercent !== null ? (
          <div>
            <dt className="eyebrow mb-1">{t('cost.foodCost')}</dt>
            <dd className={figure}>{formatPercent(translator.locale, cost.foodCostPercent)}</dd>
            <dd className="text-ink-soft mt-1 text-sm">{t('cost.foodCostHint')}</dd>
          </div>
        ) : null}
      </dl>
      <CostGaps gaps={cost.gaps} />
    </section>
  );
}

/** A dish's line on a menu: "€2.10 per portion · food cost 24 %". */
export function MenuDishCostText({ cost, currency }: { cost: MenuDishCost; currency: Currency }) {
  const translator = useT();
  const { t } = translator;
  const parts: string[] = [];
  if (cost.perPortion !== null) {
    parts.push(
      t('cost.perPortion', { amount: formatMoney(translator.locale, currency, cost.perPortion) }),
    );
  }
  if (cost.foodCostPercent !== null) {
    parts.push(
      t('cost.menuFoodCost', { percent: formatPercent(translator.locale, cost.foodCostPercent) }),
    );
  }
  if (parts.length === 0) return null;
  return (
    <span className="text-ink-soft qty basis-full text-sm sm:basis-auto">
      {parts.join(' · ')}
      {cost.gaps > 0 ? (
        <span className="tag tag-accent ml-2 text-[11px]">{t('cost.soFar')}</span>
      ) : null}
    </span>
  );
}

/** The menu's averages, under its dishes, with a word when they are too low. */
export function MenuCostSummary({ cost }: { cost: MenuCost }) {
  const translator = useT();
  const { t } = translator;
  if (cost.averagePerPortion === null) return null;
  const parts = [
    t('cost.menuAverage', {
      amount: formatMoney(translator.locale, cost.currency, cost.averagePerPortion),
    }),
  ];
  if (cost.averageFoodCostPercent !== null) {
    parts.push(
      t('cost.menuFoodCost', {
        percent: formatPercent(translator.locale, cost.averageFoodCostPercent),
      }),
    );
  }
  return (
    <div className="border-line bg-surface border-t px-4 py-3 sm:px-6">
      <p className="qty font-medium">{parts.join(' · ')}</p>
      {cost.incomplete ? (
        <p role="note" className="text-ink-soft mt-1 text-sm">
          {t('cost.menuIncomplete')}
        </p>
      ) : null}
    </div>
  );
}
