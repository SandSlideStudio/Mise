import type { Ingredient, LabelCheck } from '@mise/contracts';
import {
  useDecideLabelCheck,
  useLabelConsequences,
  usePendingLabelChecks,
} from '../api/labelChecks.js';
import { errorMessage, useT } from '../i18n/index.js';
import { ConsequenceList, labelLines } from './LabelCheck.js';

/**
 * Labels a cook found changed, waiting for a chef. Shown to chefs at the top
 * of the Ingredients page; each says what the cook read, what it does to the
 * dishes, and takes one tap to approve or reject.
 */
export function PendingLabelChecks({ ingredients }: { ingredients: readonly Ingredient[] }) {
  const { t, plural } = useT();
  const pending = usePendingLabelChecks(true);
  const checks = pending.data ?? [];
  if (checks.length === 0) return null;
  return (
    <section
      aria-labelledby="pending-labels"
      className="bg-accent-wash border-line border-b px-4 py-4 sm:px-6"
    >
      <h2 id="pending-labels" className="text-xl">
        {plural('labelCheck.pending', checks.length)}
      </h2>
      <p className="text-ink-soft mt-1 text-sm">{t('labelCheck.pendingIntro')}</p>
      <ul className="mt-3 flex flex-col gap-3">
        {checks.map((check) => (
          <PendingCheck key={check.id} check={check} ingredients={ingredients} />
        ))}
      </ul>
    </section>
  );
}

function PendingCheck({
  check,
  ingredients,
}: {
  check: LabelCheck;
  ingredients: readonly Ingredient[];
}) {
  const translator = useT();
  const { t, locale } = translator;
  const decide = useDecideLabelCheck();
  const consequences = useLabelConsequences(ingredients, check.ingredientId, check.after);
  const date = new Date(check.checkedAt).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <li className="border-line bg-surface-raised border px-4 py-3">
      <h3 className="text-lg font-medium">{check.ingredientName}</h3>
      <p className="text-ink-soft text-sm">
        {t('labelCheck.checkedBy', { name: check.checkedBy ?? '—', date })}
        {check.note ? ` · ${check.note}` : null}
      </p>
      {labelLines(t, check.before, check.after).map((line) => (
        <p key={line}>{line}</p>
      ))}
      <div className="mt-2">
        <ConsequenceList consequences={consequences} />
      </div>
      {decide.error ? (
        <p role="alert" className="text-danger mt-2 text-sm">
          {errorMessage(translator, decide.error)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={decide.isPending}
          aria-label={`${t('labelCheck.approve')}: ${check.ingredientName}`}
          onClick={() => decide.mutate({ id: check.id, approve: true })}
        >
          {t('labelCheck.approve')}
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={decide.isPending}
          aria-label={`${t('labelCheck.reject')}: ${check.ingredientName}`}
          onClick={() => decide.mutate({ id: check.id, approve: false })}
        >
          {t('labelCheck.reject')}
        </button>
      </div>
    </li>
  );
}
