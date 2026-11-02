import type { ReactNode } from 'react';
import type { Allergen } from '@mise/domain';
import { formatQuantity, humanize, isUnitCode } from '@mise/domain';
import type { ExpandedRecipe } from '@mise/contracts';
import { allergenName, recipeTypeName, useT } from '../i18n/index.js';
import { CardIconMark } from './DishCardView.js';

/**
 * The recipe as a card to print once, laminate and keep at the station.
 *
 * Always the recipe as written, never a scaled size: a laminated card is the
 * base recipe. Nothing that changes from day to day is on it (no print date,
 * nothing to tick or fill in), only what the recipe is: what it makes, how
 * long it keeps, what's in it, how it's made. A sub-recipe is listed by name;
 * it has a card of its own.
 */
export function RecipeCardPrint({
  written,
  stationName,
  kitchenName,
}: {
  written: ExpandedRecipe;
  stationName: string | null;
  kitchenName: string;
}) {
  const translator = useT();
  const { t, plural } = translator;
  const { recipe, lines, allergens } = written;
  const isDish = recipe.type === 'dish';
  const parts = lines.filter((line) => line.depth === 0);
  const photo = isDish ? (recipe.photos.find((p) => p.isPrimary) ?? recipe.photos[0]) : undefined;
  const contains = allergens.contains as Allergen[];
  const mayContain = allergens.mayContain as Allergen[];

  const amount = (value: number, unit: string) =>
    isUnitCode(unit) ? formatQuantity(humanize({ value, unit })) : `${value} ${unit}`;

  const facts: { label: string; value: string; note?: string }[] = isDish
    ? []
    : [
        {
          label: t('recipeCard.makes'),
          value: amount(recipe.yield.value, recipe.yield.unit),
          ...(recipe.portions ? { note: plural('recipes.portions', recipe.portions) } : {}),
        },
        ...(recipe.prepMinutes
          ? [
              {
                label: t('recipeCard.prepTime'),
                value: t('recipe.minutes', { count: recipe.prepMinutes }),
              },
            ]
          : []),
        ...(recipe.shelfLifeHours
          ? [
              {
                label: t('recipeCard.keeps'),
                value:
                  recipe.shelfLifeHours % 24 === 0
                    ? plural('recipeCard.days', recipe.shelfLifeHours / 24)
                    : plural('recipeCard.hours', recipe.shelfLifeHours),
              },
            ]
          : []),
        ...(recipe.storage ? [{ label: t('recipe.storage'), value: recipe.storage }] : []),
      ];

  const subtitle = [
    recipeTypeName(t, recipe.type),
    stationName,
    isDish && recipe.portions ? plural('recipes.portions', recipe.portions) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="hidden text-black print:block">
      <header className="flex items-end justify-between gap-6 border-b-[3px] border-black pb-3.5">
        <div>
          <h1 className="text-[40pt] leading-[0.95]">{recipe.name}</h1>
          <p className="mt-1.5 text-[12pt] tracking-[0.02em]">{subtitle}</p>
        </div>
        <p className="font-display text-[12pt] font-semibold tracking-[0.14em] uppercase">
          {kitchenName}
        </p>
      </header>

      {photo ? (
        <img
          src={photo.url}
          alt=""
          className="keep-together mt-5 max-h-[60mm] w-full object-cover"
        />
      ) : null}

      {facts.length > 0 ? (
        <dl
          className="keep-together mt-5 grid border-2 border-black"
          style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}
        >
          {facts.map((fact, index) => (
            <div
              key={fact.label}
              className={`px-3.5 py-2 ${index > 0 ? 'border-l border-black' : ''}`}
            >
              <dt className="font-display text-[8.5pt] font-semibold tracking-[0.14em] uppercase">
                {fact.label}
              </dt>
              <dd className="font-display text-[17pt] leading-tight font-semibold">{fact.value}</dd>
              {fact.note ? <dd className="text-[9pt]">{fact.note}</dd> : null}
            </div>
          ))}
        </dl>
      ) : null}

      <div className="keep-together mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-[3px] border-black px-4 py-2.5">
        <span className="font-display text-[10.5pt] font-semibold tracking-[0.14em] uppercase">
          {t('recipe.contains')}
        </span>
        {contains.length > 0 ? (
          contains.map((allergen) => (
            <span
              key={allergen}
              className="font-display inline-flex items-center gap-1.5 text-[16pt] font-semibold"
            >
              <CardIconMark icon={allergen} className="h-[7mm] w-[7mm]" />
              {allergenName(t, allergen)}
            </span>
          ))
        ) : (
          <span className="font-display text-[16pt] font-semibold">
            {t('recipe.nothingDeclarable')}
          </span>
        )}
        {mayContain.length > 0 ? (
          <span className="ml-auto text-[10.5pt]">
            {t('recipeCard.mayContain', {
              allergens: mayContain.map((a) => allergenName(t, a)).join(', '),
            })}
          </span>
        ) : null}
      </div>

      <div className="mt-7 grid grid-cols-[80mm_minmax(0,1fr)] gap-8">
        <section>
          <CardHeading>{isDish ? t('recipeCard.onThePlate') : t('print.whatGoesIn')}</CardHeading>
          {parts.map((line, index) => (
            <div
              key={`${line.sourceId}-${index}`}
              className="keep-together grid grid-cols-[21mm_minmax(0,1fr)] items-baseline gap-3 border-b-[0.6px] border-[#aaa] py-2"
            >
              <span className="font-display text-right text-[16pt] leading-none font-semibold">
                {amount(line.quantity.value, line.quantity.unit)}
              </span>
              <span className="text-[12pt]">
                {line.name}
                {line.kind === 'recipe' || line.note ? (
                  <span className="block text-[9pt] text-[#444]">
                    {[line.note, line.kind === 'recipe' ? t('recipeCard.ownRecipe') : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
              </span>
            </div>
          ))}
        </section>

        {recipe.method.length > 0 ? (
          <section>
            <CardHeading>{isDish ? t('recipeCard.plating') : t('recipe.method')}</CardHeading>
            <ol className="mt-2.5 flex flex-col gap-3">
              {recipe.method.map((step, index) => (
                <li
                  key={index}
                  className="keep-together grid grid-cols-[7mm_minmax(0,1fr)] items-baseline gap-2.5"
                >
                  <span className="font-display text-right text-[16pt] font-semibold">
                    {index + 1}
                  </span>
                  <span className="text-[12.5pt] leading-[1.4]">{step.text}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function CardHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-display border-b-[1.5px] border-black pb-1 text-[11.5pt] font-semibold tracking-[0.14em] uppercase">
      {children}
    </h2>
  );
}
