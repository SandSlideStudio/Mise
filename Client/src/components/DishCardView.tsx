import type { DishCard, DishCardFacts, DishCardPart } from '@mise/contracts';
import { DISH_CARD_ALLERGEN_ORDER, type Allergen } from '@mise/domain';
import { cardAllergenName, courseName, temperatureName, useT } from '../i18n/index.js';
import { CARD_ICONS, type CardIcon } from '../lib/dishcard/icons.js';

/**
 * A dish card as a page rather than a sheet of paper: the same front and back
 * as the printout, with the same parts switched on and off, in the language
 * and the colours the screen is already in. What the floor reads on the
 * tablet is what it reads on the card.
 */

export function CardIconMark({ icon, className = '' }: { icon: CardIcon; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`shrink-0 ${className}`}>
      <path
        d={CARD_ICONS[icon]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ordered(allergens: string[]): Allergen[] {
  return DISH_CARD_ALLERGEN_ORDER.filter((a) => allergens.includes(a));
}

/** The allergen chips under a dish, as on the front of the card. */
export function AllergenChips({
  facts,
  showMayContain = true,
  showVegan = true,
  size = 'normal',
}: {
  facts: DishCardFacts;
  showMayContain?: boolean;
  showVegan?: boolean;
  size?: 'normal' | 'small';
}) {
  const { t } = useT();
  const chip =
    size === 'small'
      ? 'gap-1 px-1.5 py-0.5 text-[12px] [&_svg]:h-3.5 [&_svg]:w-3.5'
      : 'gap-1.5 px-2.5 py-1 text-[14px] [&_svg]:h-4 [&_svg]:w-4';
  const contains = ordered(facts.contains);
  const mayContain = showMayContain ? ordered(facts.mayContain) : [];

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t('card.allergens')}>
      {contains.map((allergen) => (
        <li
          key={allergen}
          className={`bg-accent text-accent-ink inline-flex items-center font-semibold ${chip}`}
        >
          <CardIconMark icon={allergen} />
          {cardAllergenName(t, allergen)}
        </li>
      ))}
      {mayContain.map((allergen) => (
        <li
          key={`may-${allergen}`}
          className={`border-accent text-accent inline-flex items-center border font-semibold ${chip}`}
        >
          <CardIconMark icon={allergen} />({cardAllergenName(t, allergen)})
        </li>
      ))}
      {contains.length === 0 && mayContain.length === 0 ? (
        <li className={`border-line text-ink-soft inline-flex items-center border ${chip}`}>
          {t('card.noAllergens')}
        </li>
      ) : null}
      {showVegan && facts.vegan === 'yes' ? (
        <li className={`bg-band text-band-ink inline-flex items-center font-semibold ${chip}`}>
          <CardIconMark icon="vegan" />
          {t('card.vegan')}
        </li>
      ) : null}
      {showVegan && facts.vegan === 'unknown' ? (
        <li className={`border-line text-ink-soft inline-flex items-center border ${chip}`}>
          {t('card.veganUnknown')}
        </li>
      ) : null}
    </ul>
  );
}

export function DishCardView({ card }: { card: DishCard }) {
  const { t, language } = useT();
  const shows = (part: DishCardPart) => !card.settings.hidden.includes(part);
  const dish = card.dish;
  const photo = shows('photo') ? dish.photoUrl : null;
  const logo = shows('logo') ? card.settings.logoUrl : null;
  // As printed: the kitchen's own heading, or "Dish card · kitchen".
  const heading = card.settings.title ?? `${t('card.title')} · ${card.kitchenName}`;
  const warning = card.settings.warnings[language];

  const facts: [string, string][] = [];
  if (shows('menu') && dish.menus.length > 0) facts.push([t('card.menu'), dish.menus.join(' · ')]);
  if (shows('flavour') && dish.flavourProfile.length > 0) {
    facts.push([t('card.flavour'), dish.flavourProfile.join(' / ')]);
  }
  if (shows('temperature') && dish.servingTemperature) {
    facts.push([t('card.temperature'), temperatureName(t, dish.servingTemperature)]);
  }
  if (shows('course') && dish.course) facts.push([t('card.course'), courseName(t, dish.course)]);

  const components = [
    ...card.rows.map((row) => ({ key: row.recipeId, name: row.name, other: false })),
    ...(card.other ? [{ key: 'other', name: t('card.other'), other: true }] : []),
  ];
  const lists: [DishCardPart, string, string[]][] = [
    ['drinks', t('card.drinks'), dish.drinkPairings],
    ['cutlery', t('card.cutlery'), dish.cutlery],
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* The front */}
      <article className="bg-surface-raised border-line overflow-hidden border">
        <div className={photo ? 'grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''}>
          {photo ? (
            <img
              src={photo}
              alt=""
              className="aspect-[4/3] h-full w-full object-cover md:aspect-auto md:min-h-[420px]"
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-6 p-5 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-display text-brand text-[13px] font-semibold tracking-[0.18em] uppercase">
                  {heading}
                </p>
                <h2 className="font-display mt-1 text-[38px] leading-[0.95] font-semibold tracking-[0.01em] uppercase sm:text-[52px]">
                  {dish.name}
                </h2>
              </div>
              {logo ? (
                <img src={logo} alt="" className="h-14 w-14 shrink-0 object-contain" />
              ) : null}
            </div>

            {facts.length > 0 ? (
              <dl className="border-line grid border sm:auto-cols-fr sm:grid-flow-col">
                {facts.map(([label, value], i) => (
                  <div
                    key={label}
                    className={`border-line px-3 py-2.5 ${
                      i > 0 ? 'border-t sm:border-t-0 sm:border-l' : ''
                    }`}
                  >
                    <dt className="font-display text-ink-faint text-[12px] font-medium tracking-[0.12em] uppercase">
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-[17px] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="grid gap-6 md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
              {components.length > 0 ? (
                <section>
                  <h3 className="font-display text-ink-faint mb-2 text-[14px] font-semibold tracking-[0.14em] uppercase">
                    {t('card.components')}
                  </h3>
                  <ol>
                    {components.map((component, i) => (
                      <li
                        key={component.key}
                        className="border-rule flex gap-3 border-b py-1.5 text-[17px]"
                      >
                        <span className="font-display text-accent w-6 shrink-0 font-semibold">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className={component.other ? 'text-ink-soft' : 'font-medium'}>
                          {component.name}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <div className="flex flex-col gap-5">
                {lists.map(([part, label, items]) =>
                  shows(part) && items.length > 0 ? (
                    <section key={part}>
                      <h3 className="font-display text-ink-faint mb-1 text-[14px] font-semibold tracking-[0.14em] uppercase">
                        {label}
                      </h3>
                      <ul className="text-[17px]">
                        {items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )}
                {shows('summary') ? (
                  <AllergenChips
                    facts={card.whole}
                    showMayContain={shows('mayContain')}
                    showVegan={shows('vegan')}
                  />
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* The back */}
      <article className="bg-surface-raised border-line border p-5 sm:p-8">
        <h2 className="font-display text-[26px] leading-none font-semibold uppercase sm:text-[32px]">
          {dish.name}
          <span className="text-ink-faint"> / {t('card.allergens')}</span>
        </h2>
        <AllergenTable card={card} shows={shows} />
        <CerealsAndNuts facts={card.whole} />
        {shows('location') && (card.settings.locationName || card.settings.address) ? (
          <p className="text-ink-soft mt-6 text-sm">
            {[card.settings.locationName, card.settings.address].filter(Boolean).join(', ')}
          </p>
        ) : null}
        {warning ? (
          <p className="text-ink-faint mt-2 text-xs whitespace-pre-line">{warning}</p>
        ) : null}
      </article>
    </div>
  );
}

function AllergenTable({
  card,
  shows,
}: {
  card: DishCard;
  shows: (part: DishCardPart) => boolean;
}) {
  const { t } = useT();
  const vegan = shows('vegan');
  const mayContain = shows('mayContain');
  const rows: { key: string; name: string; facts: DishCardFacts }[] = [
    ...card.rows.map((row) => ({ key: row.recipeId, name: row.name, facts: row })),
    ...(card.other ? [{ key: 'other', name: t('card.other'), facts: card.other }] : []),
  ];

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[14px]">
        <thead>
          <tr>
            <th className="bg-surface-sunk border-line font-display text-ink-faint border px-2.5 py-2 text-left align-bottom text-[12px] font-medium tracking-[0.12em] uppercase">
              {t('card.component')}
            </th>
            {DISH_CARD_ALLERGEN_ORDER.map((allergen) => (
              <th
                key={allergen}
                className="bg-surface-sunk border-line text-ink-soft w-[5.2%] border px-0.5 py-2 align-bottom text-[11px] font-medium hyphens-manual"
              >
                <CardIconMark icon={allergen} className="mx-auto mb-1 h-5 w-5" />
                {cardAllergenName(t, allergen)}
              </th>
            ))}
            {vegan ? (
              <th className="bg-band text-band-ink border-line w-[5.2%] border px-0.5 py-2 align-bottom text-[11px] font-medium">
                <CardIconMark icon="vegan" className="mx-auto mb-1 h-5 w-5" />
                {t('card.vegan')}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th className="border-line border px-2.5 py-2 text-left font-medium">{row.name}</th>
              {DISH_CARD_ALLERGEN_ORDER.map((allergen) => {
                const contains = row.facts.contains.includes(allergen);
                const may = mayContain && row.facts.mayContain.includes(allergen);
                return (
                  <td
                    key={allergen}
                    className={`border-line font-display border text-center text-[16px] font-semibold ${
                      contains ? 'bg-accent text-accent-ink' : may ? 'text-accent' : ''
                    }`}
                  >
                    {contains ? 'X' : may ? '(X)' : ''}
                  </td>
                );
              })}
              {vegan ? (
                <td className="border-line border text-center">
                  {row.facts.vegan === 'yes' ? (
                    <CardIconMark icon="check" className="text-brand mx-auto h-4 w-4" />
                  ) : row.facts.vegan === 'unknown' ? (
                    <span className="font-display text-ink-faint font-semibold">?</span>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="text-ink-soft mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[14px]">
        <li className="flex items-center gap-2">
          <span className="bg-accent text-accent-ink font-display px-1.5 font-semibold">X</span>
          {t('card.keyContains')}
        </li>
        {mayContain ? (
          <li className="flex items-center gap-2">
            <span className="border-accent text-accent font-display border px-1 font-semibold">
              (X)
            </span>
            {t('card.keyMayContain')}
          </li>
        ) : null}
        {vegan ? (
          <li className="flex items-center gap-2">
            <CardIconMark icon="check" className="text-brand h-4 w-4" />
            {t('card.keyVegan')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function CerealsAndNuts({ facts }: { facts: DishCardFacts }) {
  const { t } = useT();
  const names = [...facts.gluten, ...facts.nuts];
  const missing =
    (facts.contains.includes('gluten') && facts.gluten.length === 0) ||
    (facts.contains.includes('nuts') && facts.nuts.length === 0);
  return (
    <p className="mt-3 text-[15px]">
      <span className="font-semibold">{t('card.cerealsAndNuts')}:</span>{' '}
      <span className="text-ink-soft">
        {names.length > 0 || missing
          ? [...names, ...(missing ? [t('card.unnamed')] : [])].join(', ')
          : t('card.noCerealsOrNuts')}
      </span>
    </p>
  );
}
