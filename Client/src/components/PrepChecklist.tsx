import { useRef, useState, type FormEvent } from 'react';
import type { ChecklistItem, Quantity, RecipeSummary, Station } from '@mise/contracts';
import type { UnitCode } from '@mise/domain';
import { isQueued } from '../api/client.js';
import {
  groupChecklist,
  newItemId,
  useAddFromChecklist,
  useChecklist,
  useSaveChecklist,
} from '../api/checklist.js';
import { useKitchen, useStations } from '../api/kitchen.js';
import { useRecipes } from '../api/recipes.js';
import { useCurrentUser } from '../api/session.js';
import { errorMessage, quantityText, unitLabel, useT, type Translator } from '../i18n/index.js';
import { UnitOptions } from './UnitOptions.js';
import { numberText, readNumber, type NumberRules } from '../lib/typedNumber.js';
import { NumberInput } from './NumberInput.js';
import { ChecklistSheet, usePrintChecklist } from './ChecklistPrint.js';

/**
 * The chef's checklist, on the prep list.
 *
 * A cook can't always remember everything the kitchen needs, so the chef
 * keeps a list of it, by station. Anyone ticks what is needed today and adds
 * it to the prep list in one go; the ticks clear afterwards. Only a chef
 * changes what is on the checklist.
 *
 * Shown only when an administrator has switched it on in the settings.
 */
export function PrepChecklist() {
  const { data: kitchen } = useKitchen();
  if (!kitchen?.prepChecklist) return null;
  return <Panel />;
}

type Outcome =
  | { kind: 'added'; added: number; alreadyThere: number; enough: string[] }
  | { kind: 'queued' }
  | null;

/** How much there is, or the par: nothing below nothing. */
const AMOUNT: NumberRules = { min: 0 };

function Panel() {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const canEdit = user?.role !== 'cook';
  const checklist = useChecklist();
  const stations = useStations();
  const add = useAddFromChecklist();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  // Asking how much is there of the ticked items with a par, before they go on.
  const [counting, setCounting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [printing, print] = usePrintChecklist();

  const items = checklist.data?.items ?? [];
  // An item the chef has removed since it was ticked isn't ticked any more.
  const chosenItems = items.filter((item) => ticked.has(item.id));
  const chosen = chosenItems.map((item) => item.id);
  const withPar = chosenItems.filter((item) => item.par);

  function toggle(id: string) {
    setOutcome(null);
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }

  function send(onHand?: Record<string, Quantity>) {
    add.mutate(
      // Without a par there is nothing to count, and the payload stays as it always was.
      onHand ? { ids: chosen, onHand } : { ids: chosen },
      {
        onSuccess: (result) => {
          // Cleared once it has gone, or been kept on the tablet to go later.
          setTicked(new Set());
          setCounting(false);
          // Folded away, so the lines just added are in view on a tablet
          // instead of below the whole checklist. The keyboard's place goes to
          // the button that opens it again, not lost with the button it was on.
          setOpen(false);
          toggleRef.current?.focus();
          setOutcome(
            isQueued(result)
              ? { kind: 'queued' }
              : {
                  kind: 'added',
                  added: result.added,
                  alreadyThere: result.alreadyThere,
                  // A server from before pars doesn't say.
                  enough: result.enough ?? [],
                },
          );
        },
      },
    );
  }

  const said =
    outcome && !add.isPending
      ? outcome.kind === 'queued'
        ? t('checklist.queued')
        : [
            outcome.added > 0 ? plural('checklist.added', outcome.added) : t('checklist.addedNone'),
            outcome.alreadyThere > 0
              ? plural('checklist.alreadyThere', outcome.alreadyThere)
              : null,
            ...outcome.enough.map((name) => t('checklist.enough', { name })),
          ]
            .filter(Boolean)
            .join(' ')
      : null;

  /** Straight on, unless something ticked has a par: then first ask what is there. */
  function onAdd() {
    if (withPar.length > 0) {
      setOutcome(null);
      setCounting(true);
    } else send();
  }

  return (
    <section data-tour="checklist" className="no-print border-line bg-surface border-b-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-7">
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="btn-quiet min-h-11 px-4 text-lg"
        >
          {t('checklist.title')}
          <span aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        {open ? null : said ? (
          <p role="status" className="text-ink-soft text-base">
            {said}
          </p>
        ) : (
          <span className="text-ink-soft text-[15px]">{t('checklist.hint')}</span>
        )}
      </div>

      {open && !editing && counting && withPar.length > 0 ? (
        <OnHand
          items={withPar}
          count={chosen.length}
          pending={add.isPending}
          error={add.error ? errorMessage(translator, add.error) : null}
          onSend={send}
          onBack={() => setCounting(false)}
        />
      ) : null}

      {open && !editing && !(counting && withPar.length > 0) ? (
        <div className="px-4 pb-4 sm:px-7">
          {checklist.isError && !checklist.data ? (
            <p role="alert" className="text-danger">
              {t('checklist.loadError')}
            </p>
          ) : !checklist.data ? (
            <p className="text-ink-soft">{t('common.loading')}</p>
          ) : items.length === 0 ? (
            <p className="text-ink-soft border-line border-2 border-dashed p-5 text-center">
              {canEdit ? t('checklist.emptyChef') : t('checklist.empty')}
            </p>
          ) : (
            <Ticks
              items={items}
              stations={stations.data ?? []}
              ticked={ticked}
              onToggle={toggle}
              disabled={add.isPending}
            />
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {items.length > 0 ? (
              <button
                type="button"
                className="btn-primary min-h-12"
                disabled={chosen.length === 0 || add.isPending}
                onClick={onAdd}
              >
                {add.isPending
                  ? t('common.saving')
                  : chosen.length > 0
                    ? t('checklist.addCount', { count: chosen.length })
                    : t('checklist.add')}
              </button>
            ) : null}
            {items.length > 0 ? (
              <button type="button" className="btn-quiet min-h-11" onClick={print}>
                {t('checklistPrint.print')}
              </button>
            ) : null}
            {canEdit && checklist.data ? (
              <button type="button" className="btn-quiet min-h-11" onClick={() => setEditing(true)}>
                {t('checklist.edit')}
              </button>
            ) : null}
          </div>

          {add.error ? (
            <p role="alert" className="text-danger mt-2 text-[15px]">
              {errorMessage(translator, add.error)}
            </p>
          ) : null}
          {said ? (
            <p role="status" className="text-ink-soft mt-2 text-base">
              {said}
            </p>
          ) : null}
        </div>
      ) : null}

      {printing ? (
        <ChecklistSheet
          kitchenName={user?.kitchenName ?? ''}
          items={items}
          stations={stations.data ?? []}
        />
      ) : null}

      {open && editing && checklist.data ? (
        <Editor
          items={items}
          stations={stations.data ?? []}
          base={checklist.data.updatedAt}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * How much is there of each ticked item with a par, in the par's own unit.
 * Big boxes with a number pad, one under the other, so a cook walking the
 * fridge can fill them in with a thumb. An empty box is nothing there.
 */
function OnHand({
  items,
  count,
  pending,
  error,
  onSend,
  onBack,
}: {
  items: ChecklistItem[];
  /** Everything ticked, with a par or without: what the button adds. */
  count: number;
  pending: boolean;
  error: string | null;
  onSend: (onHand: Record<string, Quantity>) => void;
  onBack: () => void;
}) {
  const translator = useT();
  const { t } = translator;
  const [typed, setTyped] = useState<Record<string, string>>({});

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const read = items.map((item) => [item, readNumber(typed[item.id] ?? '', AMOUNT)] as const);
    // Each box says what is wrong with it; nothing goes on at another amount.
    if (read.some(([, value]) => value.problem)) return;
    const onHand: Record<string, Quantity> = {};
    for (const [item, { value }] of read) {
      if (item.par && value !== null) onHand[item.id] = { value, unit: item.par.unit };
    }
    onSend(onHand);
  }

  return (
    <form onSubmit={onSubmit} className="px-4 pb-4 sm:px-7">
      <h3 className="text-xl">{t('checklist.onHandTitle')}</h3>
      <p className="text-ink-soft mb-3 text-[15px]">{t('checklist.onHandHint')}</p>
      <fieldset disabled={pending}>
        <ul className="grid gap-x-6 lg:grid-cols-2">
          {items.map((item, index) => {
            const par = item.par!;
            const abbr = unitLabel(translator, par.unit as UnitCode);
            return (
              <li
                key={item.id}
                className="border-rule flex flex-wrap items-center gap-3 border-b py-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-lg break-words">{item.name}</span>
                  <span className="text-ink-soft text-[15px]">
                    {t('checklist.parIs', { amount: formatParAmount(par, translator) })}
                  </span>
                </span>
                <NumberInput
                  rules={AMOUNT}
                  autoFocus={index === 0}
                  aria-label={t('checklist.onHandFor', { name: item.name, unit: abbr })}
                  className="field qty h-14 w-28 text-right text-[24px]"
                  value={typed[item.id] ?? ''}
                  onText={(text) => setTyped({ ...typed, [item.id]: text })}
                  messageClassName="order-last basis-full"
                />
                <span aria-hidden className="text-ink-soft w-10 text-lg">
                  {abbr}
                </span>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {error ? (
        <p role="alert" className="text-danger mt-2 text-[15px]">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="submit" className="btn-primary min-h-12" disabled={pending}>
          {pending ? t('common.saving') : t('checklist.addCount', { count })}
        </button>
        <button type="button" className="btn-quiet min-h-12" disabled={pending} onClick={onBack}>
          {t('checklist.back')}
        </button>
      </div>
    </form>
  );
}

/** A par as the chef set it: "3 l", "2 dz", "40". */
export function formatParAmount(par: Quantity, translator: Translator): string {
  return quantityText(translator, { value: par.value, unit: par.unit as UnitCode });
}

/** What can be ticked: the items by station, each row a whole-row target. */
function Ticks({
  items,
  stations,
  ticked,
  onToggle,
  disabled,
}: {
  items: ChecklistItem[];
  stations: Station[];
  ticked: ReadonlySet<string>;
  onToggle: (id: string) => void;
  disabled: boolean;
}) {
  const { t } = useT();
  return (
    <div className="flex flex-col gap-4">
      {groupChecklist(items, stations).map((group) => (
        <fieldset key={group.station?.id ?? 'none'} disabled={disabled}>
          <legend className="eyebrow mb-1">{group.station?.name ?? t('common.anywhere')}</legend>
          <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {group.items.map((item) => (
              <li key={item.id} className="border-rule border-b">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1.5 text-lg">
                  <input
                    type="checkbox"
                    className="accent-accent h-6 w-6 shrink-0"
                    checked={ticked.has(item.id)}
                    onChange={() => onToggle(item.id)}
                  />
                  <span className="min-w-0 break-words">{item.name}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}

/**
 * Changing the checklist. Worked on as a draft and saved as a whole, so a
 * chef renaming three things makes one new version, not nine. `base` is the
 * version it was opened from, so a save over somebody else's newer one is
 * shown side by side instead of replacing it unseen.
 */
function Editor({
  items,
  stations,
  base,
  onDone,
}: {
  items: ChecklistItem[];
  stations: Station[];
  base: string;
  onDone: () => void;
}) {
  const translator = useT();
  const { t, locale } = translator;
  const save = useSaveChecklist();
  const recipes = useRecipes();
  const [draft, setDraft] = useState<ChecklistItem[]>(items);
  // A par as it is being typed, and the unit picked for it, by item id. The
  // par itself is only worked out on saving, so a half-typed "1," is no bother.
  const [parText, setParText] = useState<Record<string, string>>({});
  const [parUnit, setParUnit] = useState<Record<string, UnitCode>>({});
  // The version this was opened from stays, however the list refreshes meanwhile.
  const [opened] = useState(base);

  const rename = (id: string, name: string) =>
    setDraft(draft.map((item) => (item.id === id ? { ...item, name } : item)));
  const remove = (id: string) => setDraft(draft.filter((item) => item.id !== id));
  // Moved to another station: it goes to the end of that station's list.
  const moveTo = (id: string, stationId: string | null) =>
    setDraft([
      ...draft.filter((item) => item.id !== id),
      ...draft.filter((item) => item.id === id).map((item) => ({ ...item, stationId })),
    ]);
  // A line named just like a recipe in the book is that recipe: linked at
  // once, so the chef does not have to find it a second time.
  const append = (stationId: string | null, name: string) => {
    const same = name.trim().toLocaleLowerCase();
    const recipeId =
      (recipes.data ?? []).find(
        (recipe) => recipe.status !== 'archived' && recipe.name.trim().toLocaleLowerCase() === same,
      )?.id ?? null;
    setDraft([...draft, { id: newItemId(), stationId, name, recipeId, par: null }]);
  };
  const link = (id: string, recipeId: string | null) =>
    setDraft(draft.map((item) => (item.id === id ? { ...item, recipeId } : item)));

  /** Swap with the neighbour in the same station, wherever that is in the whole list. */
  function shift(id: string, by: -1 | 1) {
    const at = draft.findIndex((item) => item.id === id);
    const mine = draft[at];
    if (!mine) return;
    for (let i = at + by; i >= 0 && i < draft.length; i += by) {
      if (draft[i]!.stationId !== mine.stationId) continue;
      const next = [...draft];
      next[at] = draft[i]!;
      next[i] = mine;
      setDraft(next);
      return;
    }
  }

  /**
   * The unit a par is in: the one the chef picked, the one it had, or for a
   * line made from a recipe the unit the recipe yields, so "Fig gel" asks in
   * litres without anyone choosing it.
   */
  function unitFor(item: ChecklistItem): UnitCode {
    const linked = item.recipeId
      ? (recipes.data ?? []).find((recipe) => recipe.id === item.recipeId)
      : undefined;
    return (parUnit[item.id] ?? item.par?.unit ?? linked?.yield.unit ?? 'each') as UnitCode;
  }
  const textFor = (item: ChecklistItem) =>
    parText[item.id] ?? (item.par ? numberText(item.par.value, locale) : '');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Each box says what is wrong with it; no par is saved as another number.
    if (draft.some((item) => readNumber(textFor(item), AMOUNT).problem)) return;
    const named = draft
      .map((item) => {
        const value = readNumber(textFor(item), AMOUNT).value;
        // Empty, or nothing at all: no par.
        const par = value !== null && value > 0 ? { value, unit: unitFor(item) } : null;
        return { ...item, name: item.name.trim(), par };
      })
      .filter((item) => item.name !== '');
    save.mutate({ items: named, base: opened }, { onSuccess: onDone });
  }

  const groups: { station: Station | null; items: ChecklistItem[] }[] = [
    ...stations.map((station) => ({
      station: station as Station | null,
      items: draft.filter((item) => item.stationId === station.id),
    })),
    {
      station: null,
      items: draft.filter((item) => !stations.some((s) => s.id === item.stationId)),
    },
  ];
  // Stations the kitchen no longer has: those items show under "anywhere".

  return (
    <form onSubmit={onSubmit} className="px-4 pb-4 sm:px-7">
      <h3 className="text-xl">{t('checklist.editTitle')}</h3>
      <p className="text-ink-soft mb-1 text-[15px]">{t('checklist.editHint')}</p>
      <p className="text-ink-soft mb-3 text-[15px]">{t('checklist.parHint')}</p>

      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.station?.id ?? 'none'}>
            <h4 className="eyebrow mb-1">{group.station?.name ?? t('common.anywhere')}</h4>
            <ul>
              {group.items.map((item, index) => (
                <li
                  key={item.id}
                  className="border-rule flex flex-wrap items-center gap-2 border-b py-1.5"
                >
                  <input
                    aria-label={t('checklist.itemName')}
                    className="field h-11 min-w-0 flex-1 basis-48"
                    value={item.name}
                    maxLength={120}
                    onChange={(e) => rename(item.id, e.target.value)}
                  />
                  <select
                    aria-label={t('checklist.stationFor', { name: item.name })}
                    className="field h-11 w-auto max-w-40"
                    value={item.stationId ?? ''}
                    onChange={(e) => moveTo(item.id, e.target.value || null)}
                  >
                    <option value="">{t('common.anywhere')}</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-small min-w-11"
                    aria-label={t('checklist.moveUp', { name: item.name })}
                    disabled={index === 0}
                    onClick={() => shift(item.id, -1)}
                  >
                    <span aria-hidden>↑</span>
                  </button>
                  <button
                    type="button"
                    className="btn-small min-w-11"
                    aria-label={t('checklist.moveDown', { name: item.name })}
                    disabled={index === group.items.length - 1}
                    onClick={() => shift(item.id, 1)}
                  >
                    <span aria-hidden>↓</span>
                  </button>
                  <button
                    type="button"
                    className="btn-small min-w-11"
                    aria-label={t('checklist.remove', { name: item.name })}
                    onClick={() => remove(item.id)}
                  >
                    <span aria-hidden>✕</span>
                  </button>
                  <div className="flex basis-full flex-wrap items-center gap-2">
                    <span className="eyebrow">{t('checklist.par')}</span>
                    <NumberInput
                      rules={AMOUNT}
                      aria-label={t('checklist.parFor', { name: item.name })}
                      className="field qty h-11 w-24 text-right"
                      value={textFor(item)}
                      onText={(text) => setParText({ ...parText, [item.id]: text })}
                      messageClassName="order-last basis-full"
                      onKeyDown={(e) => {
                        // Enter is for the next box, not for saving the whole checklist.
                        if (e.key === 'Enter') e.preventDefault();
                      }}
                    />
                    <select
                      aria-label={t('checklist.parUnitFor', { name: item.name })}
                      className="field h-11 w-auto"
                      value={unitFor(item)}
                      onChange={(e) =>
                        setParUnit({ ...parUnit, [item.id]: e.target.value as UnitCode })
                      }
                    >
                      <UnitOptions />
                    </select>
                  </div>
                  <RecipeLinkField
                    name={item.name}
                    recipeId={item.recipeId}
                    onChange={(recipeId) => link(item.id, recipeId)}
                  />
                </li>
              ))}
            </ul>
            <NewItem onAdd={(name) => append(group.station?.id ?? null, name)} />
          </section>
        ))}
      </div>

      {save.error ? (
        <p role="alert" className="text-danger mt-3 text-[15px]">
          {errorMessage(translator, save.error)}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" className="btn-primary min-h-12" disabled={save.isPending}>
          {save.isPending ? t('common.saving') : t('checklist.save')}
        </button>
        <button type="button" className="btn-quiet min-h-12" onClick={onDone}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}

/** One more name for a station. Not a form of its own: it sits inside the editor's form. */
function NewItem({ onAdd }: { onAdd: (name: string) => void }) {
  const { t } = useT();
  const [name, setName] = useState('');

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setName('');
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        aria-label={t('checklist.newItem')}
        placeholder={t('checklist.newItem')}
        className="field h-11 min-w-0 flex-1"
        value={name}
        maxLength={120}
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds the name, instead of saving the whole checklist.
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
      />
      <button type="button" className="btn-quiet min-h-11" disabled={!name.trim()} onClick={commit}>
        {t('checklist.addItem')}
      </button>
    </div>
  );
}

/**
 * Which recipe a checklist line is made from. Typing offers matching recipes
 * from the book, like adding a line to the prep list; the line it adds then
 * links to the recipe. Not needed: most lines have none.
 */
function RecipeLinkField({
  name,
  recipeId,
  onChange,
}: {
  name: string;
  recipeId: string | null;
  onChange: (recipeId: string | null) => void;
}) {
  const { t } = useT();
  const recipes = useRecipes();
  const [searching, setSearching] = useState(false);
  const [typed, setTyped] = useState('');

  const linked = recipeId ? (recipes.data ?? []).find((r) => r.id === recipeId) : undefined;
  const query = typed.trim().toLocaleLowerCase();
  const suggestions: RecipeSummary[] =
    query.length < 2
      ? []
      : (recipes.data ?? [])
          .filter((r) => r.status !== 'archived' && r.name.toLocaleLowerCase().includes(query))
          .sort(
            (a, b) =>
              Number(!a.name.toLocaleLowerCase().startsWith(query)) -
                Number(!b.name.toLocaleLowerCase().startsWith(query)) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 5);

  if (recipeId) {
    return (
      <div className="flex basis-full items-center gap-2 text-[15px]">
        <span className="eyebrow">{t('checklist.recipe')}</span>
        <span className="text-brand min-w-0 break-words">
          {linked?.name ?? t('checklist.recipeLinked')}
        </span>
        <button
          type="button"
          className="btn-small min-h-11"
          aria-label={t('checklist.unlinkRecipe', { name })}
          onClick={() => onChange(null)}
        >
          {t('checklist.unlink')}
        </button>
      </div>
    );
  }

  if (!searching) {
    return (
      <button
        type="button"
        className="btn-quiet min-h-11 basis-full justify-start text-[15px]"
        aria-label={t('checklist.linkRecipeFor', { name })}
        onClick={() => {
          // Start from the line's own name: usually the recipe is called the same.
          setTyped(name);
          setSearching(true);
        }}
      >
        {t('checklist.linkRecipe')}
      </button>
    );
  }

  return (
    <div className="flex basis-full flex-wrap items-center gap-2">
      <input
        autoFocus
        aria-label={t('checklist.searchRecipe', { name })}
        placeholder={t('checklist.searchRecipePlaceholder')}
        className="field h-11 min-w-0 flex-1 basis-48"
        value={typed}
        autoComplete="off"
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          // Enter is for picking, not for saving the whole checklist.
          if (e.key === 'Enter') e.preventDefault();
        }}
      />
      <button type="button" className="btn-quiet min-h-11" onClick={() => setSearching(false)}>
        {t('common.cancel')}
      </button>
      {suggestions.length > 0 ? (
        <div className="flex basis-full flex-wrap items-center gap-2">
          <span className="eyebrow">{t('addTask.fromBook')}</span>
          {suggestions.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              className="toggle min-h-11 px-3 text-[15px]"
              onClick={() => {
                onChange(recipe.id);
                setSearching(false);
                setTyped('');
              }}
            >
              {recipe.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
