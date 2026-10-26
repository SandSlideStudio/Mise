import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { PrepTask, PrepTaskStatus, RecipeSummary } from '@mise/contracts';
import { ALL_UNITS, formatQuantity, isUnitCode, type UnitCode } from '@mise/domain';
import { useStations } from '../api/kitchen.js';
import {
  GONE_AFTER_MS,
  useAddRunningTask,
  useDeletePrepTask,
  useHandoverNote,
  useRunningTasks,
  useUpdateHandoverNote,
  useUpdatePrepTask,
} from '../api/running.js';
import { useRecipes } from '../api/recipes.js';
import { useCurrentUser } from '../api/session.js';
import { AppShell } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { byStation, PrepTaskRow, StationHeading } from '../components/PrepTaskRow.js';
import { clockTime, errorMessage, friendlyDate, useT } from '../i18n/index.js';
import { useNight } from '../lib/theme.js';

/**
 * What the tablet on the pass shows, and what a cook sees on their own phone.
 *
 * Everything here is sized for someone standing up in a hurry, at a metre, in
 * a glove. Quantity is the widest thing on a row because it is the only number
 * anyone needs; the "For …" line under each job is the arithmetic, and it is
 * never hidden behind a tap.
 *
 * The kitchen keeps one running list: lines go on by hand, and a ticked line
 * is gone two hours after it was ticked.
 */

type Filter = { kind: 'mine' } | { kind: 'all' } | { kind: 'station'; stationId: string };

export function Today() {
  const { data: user } = useCurrentUser();
  const { t, locale } = useT();
  const stations = useStations();
  const [night, toggleNight] = useNight();
  const today = useToday();

  if (!user) return null;
  const myStation = stations.data?.find((s) => s.id === user.defaultStationId);

  return (
    <AppShell>
      <main className="pb-12">
        <div className="border-line bg-surface-raised flex items-center gap-x-4 gap-y-3 border-b-2 px-4 py-3 sm:flex-wrap sm:gap-x-6 sm:px-7 sm:py-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[28px] sm:text-[34px]">{t('nav.today')}</h1>
            <span className="text-ink-soft truncate text-[15px] sm:text-lg">
              {friendlyDate(locale, today)}
            </span>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3 sm:gap-7">
            <button
              type="button"
              onClick={toggleNight}
              aria-pressed={night}
              className="btn-quiet no-print h-12 border-2 px-4 text-lg tracking-[0.1em] sm:h-16 sm:px-[22px] sm:text-[22px]"
            >
              {night ? t('today.day') : t('today.night')}
            </button>
            <div className="hidden flex-col items-end sm:flex">
              <span className="font-display text-2xl leading-[1.1] font-semibold sm:text-[26px]">
                {user.displayName}
              </span>
              {myStation ? (
                <span className="text-brand text-[15px] tracking-[0.08em] uppercase sm:text-[17px]">
                  {myStation.name}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <RunningPrep />
      </main>
    </AppShell>
  );
}

/** Today where the tablet is, which is where the cook is standing. */
function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/**
 * Today's date, kept current past midnight on a tablet that's never reloaded.
 */
function useToday(): string {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const check = () => setToday(todayIso());
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

/**
 * One running list for the whole kitchen. Lines go on by hand, and a ticked
 * line is gone two hours after it was ticked, so the list never turns into
 * three years of finished work.
 */
function RunningPrep() {
  const { data: user } = useCurrentUser();
  const { t, locale } = useT();
  const tasks = useRunningTasks();
  const update = useUpdatePrepTask();
  const remove = useDeletePrepTask();
  const canManage = user?.role !== 'cook';

  // Lines drop off on the clock, not only when someone taps, so keep time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = tasks.data?.filter(
    (task) =>
      !(
        task.status === 'done' &&
        task.completedAt &&
        Date.parse(task.completedAt) + GONE_AFTER_MS <= now
      ),
  );

  // Say when a ticked line will go, so nobody is surprised when it does.
  const noteFor = (task: PrepTask) =>
    task.status === 'done' && task.completedAt
      ? t('running.goneAt', {
          time: clockTime(locale, new Date(Date.parse(task.completedAt) + GONE_AFTER_MS)),
        })
      : null;

  return (
    <Board
      title={t('running.title')}
      subtitle={t('running.subtitle')}
      tasks={visible}
      failed={tasks.isError ? () => void tasks.refetch() : undefined}
      emptyText={t('running.empty')}
      onToggle={(id, status) =>
        // Starting a job puts your name on it, so the kitchen sees who has it.
        update.mutate(
          status === 'in_progress'
            ? { id, status, assignedUserId: user?.id ?? null }
            : { id, status },
        )
      }
      noteFor={noteFor}
      onRemove={canManage ? (id) => remove.mutate(id) : undefined}
      header={
        <>
          <Handover canEdit={canManage} />
          {canManage ? <AddRunningLine /> : null}
        </>
      }
    />
  );
}

/**
 * The note the last shift left for this one: "fish is late, stock on at 3".
 * Large enough to read from the pass, with who wrote it and when, so nobody
 * acts on yesterday's note thinking it is today's. Chefs write it; everyone
 * reads it.
 */
function Handover({ canEdit }: { canEdit: boolean }) {
  const translator = useT();
  const { t, locale } = translator;
  const note = useHandoverNote();
  const update = useUpdateHandoverNote();
  const [draft, setDraft] = useState<string | null>(null);

  const text = note.data?.text ?? null;
  if (!text && !canEdit) return null;

  function save(value: string) {
    update.mutate(value, { onSuccess: () => setDraft(null) });
  }

  if (draft !== null) {
    return (
      <form
        className="no-print bg-accent-wash border-accent border-b-2 border-l-[6px] px-4 py-3 sm:px-7"
        onSubmit={(event) => {
          event.preventDefault();
          save(draft);
        }}
      >
        <label className="eyebrow mb-2 block" htmlFor="handover">
          {t('handover.title')}
        </label>
        <textarea
          id="handover"
          className="field min-h-24 py-2.5 text-lg"
          value={draft}
          maxLength={1000}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('handover.placeholder')}
        />
        {update.error ? (
          <p role="alert" className="text-danger mt-2 text-[15px]">
            {errorMessage(translator, update.error)}
          </p>
        ) : null}
        <div className="mt-2.5 flex flex-wrap gap-2.5">
          <button type="submit" className="btn-primary min-h-11" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('handover.save')}
          </button>
          <button type="button" className="btn-quiet min-h-11" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </button>
          {text ? (
            <button
              type="button"
              className="btn-quiet min-h-11 sm:ml-auto"
              disabled={update.isPending}
              onClick={() => save('')}
            >
              {t('handover.clear')}
            </button>
          ) : null}
        </div>
      </form>
    );
  }

  if (!text) {
    return (
      <div className="no-print border-line border-b-2 px-4 py-2.5 sm:px-7">
        <button
          type="button"
          className="text-accent text-[17px] underline underline-offset-4"
          onClick={() => setDraft('')}
        >
          {t('handover.empty')}
        </button>
      </div>
    );
  }

  const at = note.data?.at ? new Date(note.data.at) : null;
  return (
    <div
      data-tour="handover"
      className="bg-accent-wash border-accent flex flex-wrap items-start gap-x-6 gap-y-2 border-b-2 border-l-[6px] px-4 py-3 sm:px-7 sm:py-4"
    >
      <div className="min-w-0 flex-1">
        <span className="eyebrow">{t('handover.title')}</span>
        <p className="mt-1 text-xl leading-snug whitespace-pre-line sm:text-[23px]">{text}</p>
        {note.data?.byName && at ? (
          <p className="text-ink-soft mt-1 text-[15px]">
            {t('handover.by', {
              name: note.data.byName,
              when: at.toLocaleString(locale, {
                weekday: 'short',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <button
          type="button"
          className="btn-quiet no-print min-h-11"
          onClick={() => setDraft(text)}
        >
          {t('handover.edit')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Putting something on the running list. Adding what is already waiting on
 * the same station puts the amount onto that line, and says so.
 *
 * Typing offers matching recipes from the book. Picking one links the line to
 * its spec, so whoever makes it can open the recipe at the amount asked for.
 */
function AddRunningLine() {
  const translator = useT();
  const { t } = translator;
  const stations = useStations();
  const add = useAddRunningTask();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<UnitCode>('kg');
  const [stationId, setStationId] = useState('');
  const [mergedInto, setMergedInto] = useState<string | null>(null);
  const [linked, setLinked] = useState<RecipeSummary | null>(null);
  const recipes = useRecipes();
  const amountField = useRef<HTMLInputElement>(null);

  const typed = description.trim().toLocaleLowerCase();
  const suggestions =
    linked || typed.length < 2
      ? []
      : (recipes.data ?? [])
          .filter((r) => r.status !== 'archived' && r.name.toLocaleLowerCase().includes(typed))
          .sort(
            (a, b) =>
              Number(!a.name.toLocaleLowerCase().startsWith(typed)) -
                Number(!b.name.toLocaleLowerCase().startsWith(typed)) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 5);

  function pick(recipe: RecipeSummary) {
    setLinked(recipe);
    setDescription(recipe.name);
    if (isUnitCode(recipe.yield.unit)) setUnit(recipe.yield.unit);
    if (recipe.stationId && !stationId) setStationId(recipe.stationId);
    amountField.current?.focus();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    add.mutate(
      {
        description,
        stationId: stationId || null,
        recipeId: linked?.id ?? null,
        quantity: amount ? { value: Number(amount), unit } : null,
      },
      {
        onSuccess: (result) => {
          // Clear only once it has landed, and keep the station: the next few
          // lines are usually for the same section.
          setMergedInto(result.merged ? result.task.description : null);
          setDescription('');
          setAmount('');
          setLinked(null);
        },
      },
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      data-tour="add-line"
      className="no-print bg-surface-raised border-line grid grid-cols-[minmax(0,1fr)_96px_84px] gap-2.5 border-b-2 px-4 py-3 sm:px-7 md:grid-cols-[minmax(0,1fr)_110px_90px_200px_auto]"
    >
      <input
        aria-label={t('addTask.what')}
        className="field col-span-3 h-12 text-lg md:col-span-1"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          // Changing the words breaks the link to the recipe that was picked.
          if (linked && e.target.value !== linked.name) setLinked(null);
        }}
        placeholder={t('addTask.placeholder')}
        autoComplete="off"
        required
      />
      <input
        ref={amountField}
        aria-label={t('common.howMuch')}
        type="number"
        inputMode="decimal"
        step="any"
        min={0}
        className="field qty col-span-2 h-12 text-right text-[22px] placeholder:font-sans placeholder:text-base placeholder:font-normal md:col-span-1"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={t('common.howMuch')}
      />
      <select
        aria-label={t('common.unit')}
        className="field h-12"
        value={unit}
        onChange={(e) => setUnit(e.target.value as UnitCode)}
      >
        {ALL_UNITS.map((u) => (
          <option key={u.code} value={u.code}>
            {u.code}
          </option>
        ))}
      </select>
      <select
        aria-label={t('common.station')}
        className="field col-span-3 h-12 md:col-span-1"
        value={stationId}
        onChange={(e) => setStationId(e.target.value)}
      >
        <option value="">{t('common.anyStation')}</option>
        {(stations.data ?? []).map((station) => (
          <option key={station.id} value={station.id}>
            {station.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="btn-primary col-span-3 min-h-12 md:col-span-1"
        disabled={add.isPending}
      >
        {t('addTask.submit')}
      </button>

      {suggestions.length > 0 ? (
        <div className="col-span-3 flex flex-wrap items-center gap-2 md:col-span-5">
          <span className="eyebrow">{t('addTask.fromBook')}</span>
          {suggestions.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              className="toggle min-h-10 px-3 text-[15px]"
              onClick={() => pick(recipe)}
            >
              {recipe.name}
              {isUnitCode(recipe.yield.unit) ? (
                <span className="text-ink-soft">
                  {' · '}
                  {t('addTask.makes', {
                    amount: formatQuantity({ value: recipe.yield.value, unit: recipe.yield.unit }),
                  })}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {linked ? (
        <p role="status" className="text-brand col-span-3 text-[15px] md:col-span-5">
          {t('addTask.linked', { name: linked.name })}
        </p>
      ) : null}

      {mergedInto && !add.isPending ? (
        <p role="status" className="text-ink-soft col-span-3 text-[15px] md:col-span-5">
          {t('running.merged', { name: mergedInto })}
        </p>
      ) : null}
      {add.error ? (
        <p role="alert" className="text-danger col-span-3 text-[15px] md:col-span-5">
          {errorMessage(translator, add.error)}
        </p>
      ) : null}
    </form>
  );
}

/**
 * A list on the line: its heading and progress, the station filters, and the
 * rows grouped by station in the order the kitchen is laid out.
 */
function Board({
  title,
  subtitle,
  tasks,
  failed,
  emptyText,
  onToggle,
  noteFor,
  onRemove,
  header,
}: {
  title: string;
  subtitle: string | null;
  tasks: PrepTask[] | undefined;
  /** Set when the list didn't load: tries again. */
  failed?: () => void;
  emptyText: string;
  onToggle: (id: string, status: PrepTaskStatus) => void;
  noteFor?: (task: PrepTask) => string | null;
  onRemove?: (id: string) => void;
  header?: ReactNode;
}) {
  const { data: user } = useCurrentUser();
  const { t } = useT();
  const stations = useStations();
  // A cook opens the tablet on their own work, which is what they want on a
  // busy afternoon.
  const [filter, setFilter] = useState<Filter>({ kind: 'mine' });
  const [filterTouched, setFilterTouched] = useState(false);

  const all = tasks ?? [];

  const isMine = (task: PrepTask) =>
    (user?.defaultStationId != null && task.stationId === user.defaultStationId) ||
    task.assignedUserId === user?.id;

  // If there is nothing of theirs on it, show the whole board rather than an
  // empty screen. Only until they touch a filter themselves.
  useEffect(() => {
    if (filterTouched || !tasks || filter.kind !== 'mine') return;
    if (!tasks.some(isMine)) setFilter({ kind: 'all' });
  }, [tasks, filter, filterTouched]);

  const visible = all.filter((task) => {
    if (filter.kind === 'mine') return isMine(task);
    if (filter.kind === 'station') return task.stationId === filter.stationId;
    return true;
  });

  const groups = byStation(visible, stations.data ?? []);
  const done = all.filter((task) => task.status === 'done').length;
  const progress = all.length === 0 ? 0 : Math.round((done / all.length) * 100);

  function pick(next: Filter) {
    setFilterTouched(true);
    setFilter(next);
  }

  return (
    <section className="mt-2">
      <div className="bg-surface border-line flex flex-wrap items-center gap-x-6 gap-y-2 border-b-2 px-4 py-3 sm:px-7 sm:py-4">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[28px] sm:text-[34px]">{title}</h2>
          {subtitle ? (
            <span className="text-ink-soft text-base text-pretty sm:text-lg">{subtitle}</span>
          ) : null}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1.5">
          <span className="font-display text-xl font-semibold tracking-[0.04em] sm:text-[26px]">
            {t('today.progress', { done, total: all.length })}
          </span>
          <span
            className="bg-rule block h-2.5 w-36 sm:w-[220px]"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('today.progressLabel', { period: title })}
          >
            <span className="bg-accent block h-2.5" style={{ width: `${progress}%` }} />
          </span>
        </div>
      </div>

      {header}

      <div
        data-tour="stations"
        className="no-print border-line flex gap-2.5 overflow-x-auto border-b-2 px-4 py-3 sm:gap-3 sm:px-7 sm:py-[18px]"
      >
        <Chip active={filter.kind === 'mine'} onClick={() => pick({ kind: 'mine' })}>
          {t('today.mine')}
        </Chip>
        <Chip active={filter.kind === 'all'} onClick={() => pick({ kind: 'all' })}>
          {t('today.all')}
        </Chip>
        {(stations.data ?? []).map((station) => (
          <Chip
            key={station.id}
            active={filter.kind === 'station' && filter.stationId === station.id}
            onClick={() => pick({ kind: 'station', stationId: station.id })}
          >
            {station.name}
          </Chip>
        ))}
      </div>

      {failed && tasks === undefined ? (
        <LoadError className="mx-4 my-6 sm:mx-7" onRetry={failed} />
      ) : tasks === undefined ? (
        <Quiet>{t('common.loading')}</Quiet>
      ) : all.length === 0 ? (
        <Quiet>{emptyText}</Quiet>
      ) : visible.length === 0 ? (
        <Quiet>{filter.kind === 'mine' ? t('today.nothingMine') : t('today.nothingStation')}</Quiet>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={group.station?.id ?? 'none'}>
              <StationHeading station={group.station} tasks={group.tasks} />
              <ul>
                {group.tasks.map((task) => (
                  <PrepTaskRow
                    key={task.id}
                    task={task}
                    note={noteFor?.(task)}
                    onToggle={(next) => onToggle(task.id, next)}
                    onProgress={(next) => onToggle(task.id, next)}
                    onRemove={onRemove ? () => onRemove(task.id) : undefined}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`font-display h-12 shrink-0 border-2 px-4 text-lg font-semibold tracking-[0.08em] uppercase transition-colors sm:h-14 sm:px-5 sm:text-xl md:h-[68px] md:px-7 md:text-[26px] ${
        active ? 'border-accent bg-accent text-accent-ink' : 'border-rule text-ink bg-transparent'
      }`}
    >
      {children}
    </button>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-6 sm:px-7">
      <p className="text-ink-soft border-line border-2 border-dashed p-6 text-center text-xl sm:p-8">
        {children}
      </p>
    </div>
  );
}
