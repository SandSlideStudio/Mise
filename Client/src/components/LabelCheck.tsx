import { useId, useMemo, useState } from 'react';
import type { Ingredient, LabelAllergens, LabelCheck } from '@mise/contracts';
import { ALLERGENS, type Allergen } from '@mise/domain';
import {
  labelDiffers,
  useCheckLabel,
  useLabelChecks,
  useLabelConsequences,
  type DishConsequence,
  type LabelConsequences,
} from '../api/labelChecks.js';
import { useCurrentUser } from '../api/session.js';
import { allergenName, errorMessage, useT, type Translator } from '../i18n/index.js';

/**
 * Checking an ingredient's label at delivery.
 *
 * The screen starts from what Mise has; the person sets it to what the label
 * says. Before anything is saved it shows which dishes, and which menus,
 * gain or lose an allergen through it, worked out on the device so it works
 * offline. A label that says the same is one tap, and is still kept: that
 * the label was looked at is the point.
 */

/** How the form ended, for the screen around it to say. */
export type LabelCheckOutcome = 'same' | 'applied' | 'pending';

const DAY_MS = 86_400_000;

/** "Label checked 3 days ago by Ana", "Label checked today", or "Label never checked". */
export function labelCheckAge(
  translator: Translator,
  check: Ingredient['labelCheck'],
  now: Date = new Date(),
): string {
  const { t, locale } = translator;
  if (!check) return t('labelCheck.never');
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Calendar days, so a check made late last night is "yesterday".
  const days = Math.round((startOf(now) - startOf(new Date(check.at))) / DAY_MS);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const age =
    days >= 60
      ? relative.format(-Math.floor(days / 30), 'month')
      : relative.format(-Math.max(0, days), 'day');
  return check.by
    ? t('labelCheck.last', { age, name: check.by })
    : t('labelCheck.lastNoName', { age });
}

function names(t: Translator['t'], allergens: readonly Allergen[]): string {
  return allergens.map((allergen) => allergenName(t, allergen)).join(', ');
}

/** What changed between two readings, in the allergen record's own words. */
export function shiftLines(
  t: Translator['t'],
  shift: Pick<DishConsequence, 'added' | 'removed' | 'mayAdded' | 'mayRemoved'>,
): string[] {
  const lines: string[] = [];
  if (shift.added.length > 0)
    lines.push(t('allergenHistory.added', { allergens: names(t, shift.added) }));
  if (shift.removed.length > 0)
    lines.push(t('allergenHistory.removed', { allergens: names(t, shift.removed) }));
  if (shift.mayAdded.length > 0)
    lines.push(t('allergenHistory.mayAdded', { allergens: names(t, shift.mayAdded) }));
  if (shift.mayRemoved.length > 0)
    lines.push(t('allergenHistory.mayRemoved', { allergens: names(t, shift.mayRemoved) }));
  return lines;
}

/** Between what Mise had and what a label said, for a check's own line. */
export function labelLines(t: Translator['t'], before: LabelAllergens, after: LabelAllergens) {
  const minus = (a: readonly Allergen[], b: readonly Allergen[]) =>
    ALLERGENS.filter((x) => a.includes(x) && !b.includes(x));
  return shiftLines(t, {
    added: minus(after.allergens, before.allergens),
    removed: minus(before.allergens, after.allergens),
    mayAdded: minus(after.mayContain, before.mayContain),
    mayRemoved: minus(before.mayContain, after.mayContain),
  });
}

/** The line under an ingredient: when its label was last checked, and anything waiting. */
export function LabelCheckLine({ ingredient }: { ingredient: Ingredient }) {
  const translator = useT();
  const check = ingredient.labelCheck ?? null;
  return (
    <span className="text-ink-soft mt-1 block text-sm">
      {labelCheckAge(translator, check)}
      {check?.pending ? (
        <span className="text-accent font-medium"> · {translator.t('labelCheck.waiting')}</span>
      ) : null}
    </span>
  );
}

/** Every check of one ingredient, loaded when opened. */
export function LabelCheckHistory({ ingredientId }: { ingredientId: string }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const checks = useLabelChecks(ingredientId, open);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  return (
    <details className="text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-ink cursor-pointer py-2.5 font-medium">
        {t('labelCheck.history')}
      </summary>
      {checks.isPending && open ? (
        <p className="text-ink-soft mt-2">{t('common.loading')}</p>
      ) : null}
      {checks.data?.length === 0 ? (
        <p className="text-ink-soft mt-2">{t('labelCheck.historyEmpty')}</p>
      ) : null}
      {checks.data && checks.data.length > 0 ? (
        <ol className="border-line mt-2 flex flex-col border-l pl-4">
          {checks.data.map((check) => (
            <CheckEntry key={check.id} check={check} when={when} />
          ))}
        </ol>
      ) : null}
    </details>
  );
}

function CheckEntry({ check, when }: { check: LabelCheck; when: (iso: string) => string }) {
  const { t } = useT();
  const status =
    check.status === 'pending'
      ? t('labelCheck.statusPending')
      : check.status === 'rejected'
        ? t('labelCheck.statusRejected')
        : null;
  return (
    <li className="border-rule border-b py-2 last:border-b-0">
      <p className="text-ink-soft">
        <time dateTime={check.checkedAt}>{when(check.checkedAt)}</time>
        {check.checkedBy ? ` · ${t('allergenHistory.by', { name: check.checkedBy })}` : null}
        {check.note ? ` · ${check.note}` : null}
      </p>
      <p>
        {check.changed ? t('labelCheck.entryChanged') : t('labelCheck.entryNoChange')}
        {status ? ` · ${status}` : null}
      </p>
      {check.changed
        ? labelLines(t, check.before, check.after).map((line) => <p key={line}>{line}</p>)
        : null}
    </li>
  );
}

function toggled(list: Allergen[], allergen: Allergen): Allergen[] {
  return list.includes(allergen) ? list.filter((a) => a !== allergen) : [...list, allergen];
}

/** The dishes a label changes, and the menus they are on. */
export function ConsequenceList({ consequences }: { consequences: LabelConsequences }) {
  const translator = useT();
  const { t, plural } = translator;
  if (consequences.loading) return <p className="text-ink-soft">{t('labelCheck.working')}</p>;
  return (
    <div className="flex flex-col gap-2">
      {consequences.dishes.length === 0 ? (
        <p>{t('labelCheck.noDishes')}</p>
      ) : (
        <>
          <p className="font-medium">
            {plural('labelCheck.dishesChange', consequences.dishes.length)}
          </p>
          <ul className="flex flex-col gap-2">
            {consequences.dishes.map((dish) => (
              <li key={dish.id} className="border-line bg-surface-raised border px-3 py-2">
                <p className="font-medium">{dish.name}</p>
                <p className="text-ink-soft text-sm">
                  {dish.menus.length > 0
                    ? t('labelCheck.onMenus', { menus: dish.menus.join(', ') })
                    : t('labelCheck.noMenu')}
                </p>
                {shiftLines(t, dish).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {consequences.unknown > 0 ? (
        <p className="text-ink-soft text-sm">
          {plural('labelCheck.unknown', consequences.unknown)}
        </p>
      ) : null}
    </div>
  );
}

export function LabelCheckForm({
  ingredient,
  ingredients,
  onDone,
  onCancel,
  heading,
  extraAction,
}: {
  ingredient: Ingredient;
  /** Every ingredient this device has: what the dishes are worked out from. */
  ingredients: readonly Ingredient[];
  onDone: (outcome: LabelCheckOutcome) => void;
  onCancel?: () => void;
  /** Above the title, in a run of labels: "Label 2 of 5". */
  heading?: string;
  /** Another way out, such as skipping to the next label. */
  extraAction?: { label: string; onClick: () => void };
}) {
  const translator = useT();
  const { t } = translator;
  const { data: user } = useCurrentUser();
  const check = useCheckLabel();
  const id = useId();
  const [allergens, setAllergens] = useState<Allergen[]>(ingredient.allergens as Allergen[]);
  const [mayContain, setMayContain] = useState<Allergen[]>(
    (ingredient.mayContain as Allergen[]).filter((a) => !ingredient.allergens.includes(a)),
  );
  const [note, setNote] = useState('');
  const label: LabelAllergens = useMemo(
    () => ({ allergens, mayContain: mayContain.filter((a) => !allergens.includes(a)) }),
    [allergens, mayContain],
  );
  const differs = labelDiffers(ingredient, label);
  const consequences = useLabelConsequences(ingredients, ingredient.id, label);
  // Whoever may edit ingredients changes it; a cook's difference waits for a chef.
  const applies = user?.role !== 'cook';

  function save(reading: LabelAllergens) {
    const changed = labelDiffers(ingredient, reading);
    check.mutate(
      { ingredient, label: reading, note, by: user?.displayName ?? '', applies },
      { onSuccess: () => onDone(!changed ? 'same' : applies ? 'applied' : 'pending') },
    );
  }

  function reset() {
    setAllergens(ingredient.allergens as Allergen[]);
    setMayContain(ingredient.mayContain as Allergen[]);
  }

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-5">
      <div>
        {heading ? <p className="text-ink-soft text-sm font-medium">{heading}</p> : null}
        <h2 id={`${id}-title`} className="text-2xl">
          {t('labelCheck.title', { name: ingredient.name })}
        </h2>
        <p className="text-ink-soft mt-1">{t('labelCheck.intro')}</p>
      </div>

      <fieldset>
        <legend className="label">{t('ingredients.allergens')}</legend>
        <div className="flex flex-wrap gap-1.5">
          {ALLERGENS.map((allergen) => (
            <button
              key={allergen}
              type="button"
              aria-pressed={allergens.includes(allergen)}
              onClick={() => setAllergens((current) => toggled(current, allergen))}
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
                onClick={() => setMayContain((current) => toggled(current, allergen))}
                className="toggle disabled:cursor-not-allowed disabled:opacity-50"
              >
                {allergenName(t, allergen)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="sm:max-w-md">
        <label className="label" htmlFor={`${id}-note`}>
          {t('labelCheck.note')}
        </label>
        <input
          id={`${id}-note`}
          className="field"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div aria-live="polite" className="flex flex-col gap-2">
        <h3 className="label">{t('labelCheck.consequences')}</h3>
        {differs ? (
          <>
            <ConsequenceList consequences={consequences} />
            {!applies ? <p className="text-ink-soft text-sm">{t('labelCheck.cookNote')}</p> : null}
          </>
        ) : (
          <p>{t('labelCheck.same')}</p>
        )}
      </div>

      {check.error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(translator, check.error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {differs ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={check.isPending}
              onClick={() => save(label)}
            >
              {check.isPending
                ? t('common.saving')
                : applies
                  ? t('labelCheck.save')
                  : t('labelCheck.sendToChef')}
            </button>
            <button type="button" className="btn-quiet" onClick={reset}>
              {t('labelCheck.reset')}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={check.isPending}
            onClick={() => save(label)}
          >
            {check.isPending ? t('common.saving') : t('labelCheck.noChange')}
          </button>
        )}
        {extraAction ? (
          <button type="button" className="btn-quiet" onClick={extraAction.onClick}>
            {extraAction.label}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" className="btn-quiet" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
      </div>
    </section>
  );
}
