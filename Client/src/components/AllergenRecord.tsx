import type { AllergenChange } from '@mise/contracts';
import { DISH_CARD_ALLERGEN_ORDER, type Allergen } from '@mise/domain';
import { useAllergenHistory } from '../api/recipes.js';
import { allergenName, causeText, useT, type Translator } from '../i18n/index.js';

/**
 * When a dish's allergens last changed, and each change before that: what
 * came in, what went, through which ingredient or sub-recipe and by whom.
 * Telling a guest by word of mouth is only allowed with this in writing for
 * staff and the inspector, so it sits next to the allergens themselves.
 */
export function AllergenRecord({ dishId }: { dishId: string }) {
  const history = useAllergenHistory(dishId);
  if (!history.data || history.data.length === 0) return null;
  return <AllergenRecordView history={history.data} />;
}

/** One step from the entry before: what was added and what was taken away. */
export interface AllergenDiff {
  added: Allergen[];
  removed: Allergen[];
  mayAdded: Allergen[];
  mayRemoved: Allergen[];
}

function ordered(values: readonly Allergen[]): Allergen[] {
  return DISH_CARD_ALLERGEN_ORDER.filter((a) => values.includes(a));
}

export function diffAllergens(before: AllergenChange, after: AllergenChange): AllergenDiff {
  const minus = (a: readonly Allergen[], b: readonly Allergen[]) =>
    ordered(a.filter((x) => !b.includes(x)));
  return {
    added: minus(after.contains, before.contains),
    removed: minus(before.contains, after.contains),
    mayAdded: minus(after.mayContain, before.mayContain),
    mayRemoved: minus(before.mayContain, after.mayContain),
  };
}

function names(t: Translator['t'], allergens: readonly Allergen[]): string {
  return allergens.map((allergen) => allergenName(t, allergen)).join(', ');
}

export function AllergenRecordView({ history }: { history: AllergenChange[] }) {
  const { t, locale } = useT();
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const moment = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  const latest = history[0]!;

  return (
    <section className="mt-4 text-[15px]">
      <p className="text-ink-soft">
        {t('allergenHistory.lastChanged', { date: day(latest.changedAt) })}
      </p>
      <details className="mt-1">
        <summary className="text-ink cursor-pointer py-2.5 font-medium">
          {t('allergenHistory.history')}
        </summary>
        <ol className="border-line mt-2 flex flex-col border-l pl-4">
          {history.map((entry, index) => {
            const before = history[index + 1];
            const lines: string[] = [];
            if (before) {
              const diff = diffAllergens(before, entry);
              if (diff.added.length > 0)
                lines.push(t('allergenHistory.added', { allergens: names(t, diff.added) }));
              if (diff.removed.length > 0)
                lines.push(t('allergenHistory.removed', { allergens: names(t, diff.removed) }));
              if (diff.mayAdded.length > 0)
                lines.push(t('allergenHistory.mayAdded', { allergens: names(t, diff.mayAdded) }));
              if (diff.mayRemoved.length > 0)
                lines.push(
                  t('allergenHistory.mayRemoved', { allergens: names(t, diff.mayRemoved) }),
                );
            } else {
              // Where the record starts: everything it had then.
              if (entry.contains.length > 0)
                lines.push(
                  t('allergenHistory.contains', { allergens: names(t, ordered(entry.contains)) }),
                );
              if (entry.mayContain.length > 0)
                lines.push(
                  t('allergenHistory.mayContain', {
                    allergens: names(t, ordered(entry.mayContain)),
                  }),
                );
              if (lines.length === 0) lines.push(t('allergenHistory.none'));
            }
            const why = before
              ? entry.cause
                ? causeText(t, entry.cause)
                : t('allergenHistory.onDish')
              : t('allergenHistory.first');
            return (
              <li key={entry.id} className="border-rule border-b py-2 last:border-b-0">
                <p className="text-ink-soft text-sm">
                  <time dateTime={entry.changedAt}>{moment(entry.changedAt)}</time>
                  {' · '}
                  {why}
                  {entry.changedBy
                    ? ` · ${t('allergenHistory.by', { name: entry.changedBy })}`
                    : null}
                </p>
                {lines.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </li>
            );
          })}
        </ol>
      </details>
    </section>
  );
}
