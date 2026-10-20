import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { ComponentRef } from '@mise/contracts';
import { useCreateIngredient, useIngredients, useRecipes } from '../api/recipes.js';
import { errorMessage, useT } from '../i18n/index.js';

/**
 * Choosing what a recipe line points at.
 *
 * This control decides whether entering a book of recipes is bearable, so it
 * searches ingredients and sub-recipes together in one box, the arrow keys
 * move through what matches, and when nothing matches the first thing offered
 * is creating it, taken with Enter. Making somebody leave the editor to add
 * "banana shallot" is how a chef gives up halfway through.
 */

export interface PickerOption {
  kind: 'ingredient' | 'recipe';
  id: string;
  name: string;
}

type Item = { type: 'option'; option: PickerOption } | { type: 'create' };

export function ComponentPicker({
  value,
  displayName,
  excludeRecipeId,
  onChange,
  onChosen,
  onKeyDown,
  inputRef,
}: {
  value: ComponentRef | null;
  displayName: string;
  /** The recipe being edited, which must never appear as one of its own lines. */
  excludeRecipeId?: string;
  onChange: (ref: ComponentRef, name: string) => void;
  /** Called once a choice has landed, so the editor can move on to the amount. */
  onChosen?: () => void;
  /** Keys the picker does not use itself, such as Enter on a closed list. */
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: (element: HTMLInputElement | null) => void;
}) {
  const translator = useT();
  const { t } = translator;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const createIngredient = useCreateIngredient();
  const listId = useId();

  const options = useMemo<PickerOption[]>(() => {
    const fromIngredients: PickerOption[] = (ingredients.data ?? []).map((i) => ({
      kind: 'ingredient',
      id: i.id,
      name: i.name,
    }));
    const fromRecipes: PickerOption[] = (recipes.data ?? [])
      .filter((r) => r.id !== excludeRecipeId)
      .map((r) => ({ kind: 'recipe', id: r.id, name: r.name }));

    const needle = query.trim().toLowerCase();
    const all = [...fromIngredients, ...fromRecipes];
    if (!needle) return all.slice(0, 40);
    return all.filter((option) => option.name.toLowerCase().includes(needle)).slice(0, 40);
  }, [ingredients.data, recipes.data, query, excludeRecipeId]);

  const trimmed = query.trim();
  const exactMatch = options.some((o) => o.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 1 && !exactMatch;

  const items: Item[] = [
    ...options.map((option): Item => ({ type: 'option', option })),
    ...(canCreate ? [{ type: 'create' } as const] : []),
  ];

  function choose(option: PickerOption) {
    onChange(
      option.kind === 'ingredient'
        ? { kind: 'ingredient', ingredientId: option.id }
        : { kind: 'recipe', recipeId: option.id },
      option.name,
    );
    setQuery('');
    setOpen(false);
    onChosen?.();
  }

  function createAndChoose() {
    createIngredient.mutate(
      { name: trimmed, baseUnit: 'g', allergens: [], yieldPercent: 100, requiresPrep: false },
      {
        onSuccess: (created) => {
          onChange({ kind: 'ingredient', ingredientId: created.id }, created.name);
          setQuery('');
          setOpen(false);
          onChosen?.();
        },
      },
    );
  }

  function take(item: Item) {
    if (item.type === 'option') choose(item.option);
    else createAndChoose();
  }

  function handleKey(event: KeyboardEvent<HTMLInputElement>) {
    // Alt with an arrow moves the whole line; that belongs to the editor.
    if (event.altKey) {
      onKeyDown?.(event);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) =>
        items.length === 0 ? 0 : (current + step + items.length) % items.length,
      );
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setQuery('');
      return;
    }

    if (event.key === 'Enter' && open && trimmed) {
      event.preventDefault();
      const item = items[highlight] ?? items[0];
      if (item) take(item);
      return;
    }

    if (event.key === 'Enter') setOpen(false);
    onKeyDown?.(event);
  }

  const activeId = open && items[highlight] ? `${listId}-${highlight}` : undefined;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className="field h-11 text-lg"
        value={open ? query : displayName}
        placeholder={value ? displayName : t('picker.placeholder')}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        aria-label={t('picker.label')}
        onFocus={() => {
          setOpen(true);
          setQuery('');
          setHighlight(0);
        }}
        onBlur={() => {
          // Let a click on an option land before the list disappears.
          window.setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onKeyDown={handleKey}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="border-ink bg-surface-raised absolute top-full left-0 z-30 mt-0.5 max-h-80 w-[min(420px,85vw)] overflow-auto border shadow-[0_12px_32px_rgb(42_44_34/0.22)]"
        >
          {options.map((option, index) => (
            <li key={`${option.kind}-${option.id}`} role="presentation">
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={highlight === index}
                tabIndex={-1}
                className={`border-rule text-ink flex h-11 w-full items-center justify-between gap-3 border-b px-3.5 text-left text-[17px] ${
                  highlight === index ? 'bg-surface-sunk' : ''
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
              >
                <span className="truncate">{option.name}</span>
                <span className="text-brand text-[11px] tracking-[0.1em] uppercase">
                  {option.kind === 'recipe' ? t('editor.kindRecipe') : ''}
                </span>
              </button>
            </li>
          ))}

          {options.length === 0 ? (
            <li role="presentation" className="text-ink-faint px-3.5 py-2.5 text-sm">
              {t('recipes.noMatch')}
            </li>
          ) : null}

          {canCreate ? (
            <li role="presentation">
              <button
                type="button"
                id={`${listId}-${options.length}`}
                role="option"
                aria-selected={highlight === options.length}
                tabIndex={-1}
                className={`border-accent flex h-[52px] w-full items-center justify-between gap-3 border-t px-3.5 text-left ${
                  highlight === options.length ? 'bg-accent-wash' : 'bg-surface-raised'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(options.length)}
                onClick={createAndChoose}
                disabled={createIngredient.isPending}
              >
                <span className="text-ink min-w-0 truncate text-[17px]">
                  <span className="text-accent font-semibold">
                    {createIngredient.isPending ? t('picker.creating') : t('picker.create')}
                  </span>{' '}
                  “{trimmed}”
                </span>
                <span className="font-display text-accent text-[15px]" aria-hidden>
                  ↵
                </span>
              </button>
            </li>
          ) : null}

          {createIngredient.error ? (
            <li role="presentation" className="text-danger px-3.5 py-2.5 text-sm">
              {errorMessage(translator, createIngredient.error)}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
