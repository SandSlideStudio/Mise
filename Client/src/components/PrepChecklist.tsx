import { useState, type FormEvent } from 'react';
import type { ChecklistItem, Station } from '@mise/contracts';
import { isQueued } from '../api/client.js';
import {
  groupChecklist,
  newItemId,
  useAddFromChecklist,
  useChecklist,
  useSaveChecklist,
} from '../api/checklist.js';
import { useKitchen, useStations } from '../api/kitchen.js';
import { useCurrentUser } from '../api/session.js';
import { errorMessage, useT } from '../i18n/index.js';

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

type Outcome = { kind: 'added'; added: number; alreadyThere: number } | { kind: 'queued' } | null;

function Panel() {
  const translator = useT();
  const { t, plural } = translator;
  const { data: user } = useCurrentUser();
  const canEdit = user?.role !== 'cook';
  const checklist = useChecklist();
  const stations = useStations();
  const add = useAddFromChecklist();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [outcome, setOutcome] = useState<Outcome>(null);

  const items = checklist.data?.items ?? [];
  // An item the chef has removed since it was ticked isn't ticked any more.
  const chosen = items.filter((item) => ticked.has(item.id)).map((item) => item.id);

  function toggle(id: string) {
    setOutcome(null);
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }

  function send() {
    add.mutate(
      { ids: chosen },
      {
        onSuccess: (result) => {
          // Cleared once it has gone, or been kept on the tablet to go later.
          setTicked(new Set());
          setOutcome(
            isQueued(result)
              ? { kind: 'queued' }
              : { kind: 'added', added: result.added, alreadyThere: result.alreadyThere },
          );
        },
      },
    );
  }

  return (
    <section data-tour="checklist" className="no-print border-line bg-surface border-b-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-7">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="btn-quiet min-h-11 px-4 text-lg"
        >
          {t('checklist.title')}
          <span aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        {!open ? <span className="text-ink-soft text-[15px]">{t('checklist.hint')}</span> : null}
      </div>

      {open && !editing ? (
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
                onClick={send}
              >
                {add.isPending
                  ? t('common.saving')
                  : chosen.length > 0
                    ? t('checklist.addCount', { count: chosen.length })
                    : t('checklist.add')}
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
          {outcome && !add.isPending ? (
            <p role="status" className="text-ink-soft mt-2 text-base">
              {outcome.kind === 'queued'
                ? t('checklist.queued')
                : [
                    outcome.added > 0
                      ? plural('checklist.added', outcome.added)
                      : t('checklist.addedNone'),
                    outcome.alreadyThere > 0
                      ? plural('checklist.alreadyThere', outcome.alreadyThere)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' ')}
            </p>
          ) : null}
        </div>
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
  const { t } = translator;
  const save = useSaveChecklist();
  const [draft, setDraft] = useState<ChecklistItem[]>(items);
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
  const append = (stationId: string | null, name: string) =>
    setDraft([...draft, { id: newItemId(), stationId, name }]);

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

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const named = draft
      .map((item) => ({ ...item, name: item.name.trim() }))
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
      <p className="text-ink-soft mb-3 text-[15px]">{t('checklist.editHint')}</p>

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
