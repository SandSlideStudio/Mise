import { useState } from 'react';
import type { AllergenProfile, Recipe } from '@mise/contracts';
import { labelSettingsOf } from '../api/labels.js';
import { useCurrentUser } from '../api/session.js';
import { useT } from '../i18n/index.js';
import { readNumber, type NumberRules } from '../lib/typedNumber.js';
import { NumberInput } from './NumberInput.js';
import {
  LabelSheets,
  PrepLabel,
  useByNote,
  usePrintLabels,
  type LabelContent,
} from './PrepLabel.js';

/** More than a tray of containers at once is a typo, not a batch. */
const MOST = 50;
const HOW_MANY: NumberRules = { integer: true, min: 1, max: MOST };

/**
 * Printing labels for a prep by hand, from its recipe: for a batch made
 * without a line on the list, or a label that came out smudged. Shows the
 * label as it will print, and says what to write on it by hand.
 */
export function RecipeLabel({
  recipe,
  allergens,
}: {
  recipe: Recipe;
  allergens: AllergenProfile | null;
}) {
  const { t, plural } = useT();
  const { data: user } = useCurrentUser();
  const [count, setCount] = useState('1');
  const [job, print] = usePrintLabels();
  if (!user) return null;
  const settings = labelSettingsOf(user);

  const label = (made: Date): LabelContent => ({
    name: recipe.name,
    made,
    by: user.displayName,
    kitchenName: user.kitchenName,
    recipe: {
      shelfLifeHours: recipe.shelfLifeHours,
      kept: recipe.kept,
      storage: recipe.storage,
    },
    allergens,
  });
  const preview = label(new Date());
  const note = useByNote(t, preview);
  // Left empty, one. Something it can't read prints nothing: the box says why.
  const typed = readNumber(count, HOW_MANY);
  const copies = typed.value ?? 1;

  return (
    <section
      aria-labelledby="label-heading"
      className="no-print border-line bg-surface-raised border-t px-4 py-5 sm:px-8"
    >
      <h2 id="label-heading" className="heading-rule mb-3.5 text-[22px]">
        {t('label.title')}
      </h2>
      <div className="flex flex-wrap items-start gap-5">
        {/* At its real size, outlined as the roll would be. A wide roll on a
            phone is cut off at the edge rather than scrolled. */}
        <div className="max-w-full overflow-hidden">
          <div className="border-ink-soft inline-block border">
            <PrepLabel label={preview} size={settings.size} />
          </div>
        </div>
        <div className="flex min-w-[220px] flex-1 flex-col gap-3">
          {note ? (
            <p role="status" className="border-accent border-l-2 pl-3 text-[15px] text-pretty">
              {note}
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2.5">
            <div>
              <label className="label" htmlFor="label-count">
                {t('label.howMany')}
              </label>
              <NumberInput
                id="label-count"
                rules={HOW_MANY}
                className="field qty h-12 w-24 text-right text-xl"
                value={count}
                onText={setCount}
              />
            </div>
            <button
              type="button"
              className="btn-primary min-h-12"
              disabled={job !== null || typed.problem !== null}
              onClick={() => {
                const made = new Date();
                print({
                  labels: Array.from({ length: copies }, () => label(made)),
                  size: settings.size,
                });
              }}
            >
              {plural('label.print', copies)}
            </button>
          </div>
          <p className="text-ink-soft text-sm">{t('label.sizeHint')}</p>
        </div>
      </div>
      {job ? <LabelSheets job={job} /> : null}
    </section>
  );
}
