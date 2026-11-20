import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Ingredient } from '@mise/contracts';
import { useT } from '../i18n/index.js';
import { LabelCheckForm } from './LabelCheck.js';

/**
 * A delivery, label by label: tick what came in, then check each one in turn.
 * Kept to that on purpose. It is the same check as on a single ingredient,
 * one after another, so there is nothing new to learn at the back door.
 */
export function DeliveryCheck({
  ingredients,
  onClose,
}: {
  ingredients: readonly Ingredient[];
  onClose: () => void;
}) {
  const translator = useT();
  const { t, plural } = translator;
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<number | null>(null);
  const [checked, setChecked] = useState(0);
  const top = useRef<HTMLDivElement>(null);

  // Each label starts at its top. Tapped at the foot of a long list, the
  // next label opened scrolled to its buttons, with the name of what is
  // being checked out of sight above.
  useEffect(() => {
    if (step !== null) top.current?.scrollIntoView?.({ block: 'start' });
  }, [step]);
  const frame = (body: ReactNode) => (
    <div ref={top} className="scroll-mt-4">
      {body}
    </div>
  );

  const queue = picked
    .map((id) => ingredients.find((ingredient) => ingredient.id === id))
    .filter((ingredient): ingredient is Ingredient => ingredient !== undefined);

  if (step !== null && step >= queue.length) {
    return frame(
      <section aria-labelledby="delivery-title" className="flex flex-col gap-4">
        <h2 id="delivery-title" className="text-2xl">
          {t('delivery.start')}
        </h2>
        <p role="status">{plural('delivery.done', checked)}</p>
        <div>
          <button type="button" className="btn-primary" onClick={onClose}>
            {t('delivery.finish')}
          </button>
        </div>
      </section>,
    );
  }

  if (step !== null) {
    const ingredient = queue[step]!;
    const next = () => setStep(step + 1);
    return frame(
      <LabelCheckForm
        // A fresh form for each label, not the last one's toggles.
        key={ingredient.id}
        ingredient={ingredient}
        ingredients={ingredients}
        heading={t('delivery.step', { n: step + 1, total: queue.length })}
        onDone={() => {
          setChecked((count) => count + 1);
          next();
        }}
        extraAction={{ label: t('delivery.skip'), onClick: next }}
        onCancel={onClose}
      />,
    );
  }

  const term = search.trim().toLocaleLowerCase(translator.locale);
  const shown = ingredients.filter(
    (ingredient) => !term || ingredient.name.toLocaleLowerCase(translator.locale).includes(term),
  );

  return frame(
    <section aria-labelledby="delivery-title" className="flex flex-col gap-4">
      <div>
        <h2 id="delivery-title" className="text-2xl">
          {t('delivery.start')}
        </h2>
        <p className="text-ink-soft mt-1">{t('delivery.intro')}</p>
      </div>
      <input
        aria-label={t('ingredients.search')}
        className="field sm:max-w-md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('ingredients.search')}
      />
      <ul className="border-line bg-surface-raised max-h-80 overflow-y-auto border">
        {shown.map((ingredient) => {
          const id = `delivery-${ingredient.id}`;
          return (
            <li key={ingredient.id} className="border-rule border-b last:border-b-0">
              <label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3">
                <input
                  id={id}
                  type="checkbox"
                  className="size-5"
                  checked={picked.includes(ingredient.id)}
                  onChange={(e) =>
                    setPicked((current) =>
                      e.target.checked
                        ? [...current, ingredient.id]
                        : current.filter((other) => other !== ingredient.id),
                    )
                  }
                />
                <span>{ingredient.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={queue.length === 0}
          onClick={() => setStep(0)}
        >
          {plural('delivery.next', queue.length)}
        </button>
        <button type="button" className="btn-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </section>,
  );
}
