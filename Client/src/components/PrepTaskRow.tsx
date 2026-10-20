import type { ReactNode } from 'react';
import type { PrepTask, PrepTaskStatus, Station } from '@mise/contracts';
import { formatQuantity, humanize, isUnitCode } from '@mise/domain';
import { useT, type Translator } from '../i18n/index.js';

/**
 * One line of the prep list, at two sizes.
 *
 * On the line it is the only control anyone touches all afternoon, so the
 * whole row is the target and it is sized for a nitrile thumb at a metre. At
 * the desk the same drawing tightens to a table, because a mouse is accurate.
 *
 * Done is drawn four ways at once — a filled mark, a strike, a bar in the left
 * margin and a sunk ground — so a bad screen, a colourblind cook and a
 * photocopy all read it the same.
 *
 * Beside the row sits a second, smaller tick: "being made". It puts the name
 * of whoever tapped it on the line, so two cooks do not both start the stock.
 */

export type Density = 'line' | 'desk';

/** Starting a job, or putting it back. */
export type ProgressChange = 'in_progress' | 'open';

/** Column widths of a desk row, shared with its heading so they line up. */
export const DESK_COLUMNS = 'md:grid-cols-[26px_96px_minmax(0,1fr)_150px_96px_132px_96px]';

export function formatTaskQuantity(task: PrepTask): string | null {
  if (!task.quantity || !isUnitCode(task.quantity.unit)) return null;
  // Stored in base units, so 2000 g reads back as 2 kg.
  return formatQuantity(humanize({ value: task.quantity.value, unit: task.quantity.unit }));
}

export function PrepTaskRow({
  task,
  onToggle,
  onProgress,
  disabled,
  density = 'line',
  children,
}: {
  task: PrepTask;
  onToggle?: (next: PrepTaskStatus) => void;
  /** Mark the job as being made by whoever is signed in, or clear that. */
  onProgress?: (next: ProgressChange) => void;
  disabled?: boolean;
  density?: Density;
  /** Desk-only controls, such as who it is for and taking it off the list. */
  children?: ReactNode;
}) {
  return density === 'line' ? (
    <LineRow task={task} onToggle={onToggle} onProgress={onProgress} disabled={disabled} />
  ) : (
    <DeskRow task={task} onToggle={onToggle} onProgress={onProgress} disabled={disabled}>
      {children}
    </DeskRow>
  );
}

function LineRow({
  task,
  onToggle,
  onProgress,
  disabled,
}: {
  task: PrepTask;
  onToggle?: (next: PrepTaskStatus) => void;
  onProgress?: (next: ProgressChange) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const done = task.status === 'done';
  const making = task.status === 'in_progress';
  const quantity = formatTaskQuantity(task);
  const soft = done ? 'text-ink-faint' : 'text-ink-soft';

  return (
    <li className="border-rule flex items-stretch border-b">
      <button
        type="button"
        disabled={disabled || !onToggle}
        onClick={() => onToggle?.(done ? 'open' : 'done')}
        aria-pressed={done}
        data-tour="task"
        className={`grid min-h-[88px] min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] items-start gap-x-3 border-l-[6px] py-4 pr-4 pl-2.5 text-left transition-colors disabled:cursor-default sm:min-h-[104px] sm:grid-cols-[52px_minmax(0,1fr)] sm:py-5 sm:pr-5 sm:pl-3 md:grid-cols-[66px_168px_minmax(0,1fr)_210px] md:gap-x-0 md:pt-[22px] md:pr-7 md:pl-[16px] ${
          done
            ? 'bg-done border-ink'
            : making
              ? 'bg-accent-wash border-accent enabled:active:bg-surface-sunk'
              : 'bg-surface-raised enabled:active:bg-surface-sunk border-transparent'
        }`}
      >
        <Mark done={done} size="line" className="row-span-3 md:row-span-1" />

        {quantity ? (
          <span
            className={`qty text-[28px] sm:text-[32px] md:text-[38px] ${done ? 'text-ink-faint line-through' : ''}`}
          >
            {quantity}
          </span>
        ) : (
          <span className="hidden md:block" aria-hidden />
        )}

        <span className="col-start-2 flex min-w-0 flex-col gap-[3px] md:col-start-auto">
          <span
            className={`text-[21px] leading-[1.1] font-medium sm:text-[23px] md:text-[27px] ${
              done ? 'text-ink-faint line-through' : 'text-ink'
            }`}
          >
            {task.description}
          </span>
          {task.notes.length > 0 ? (
            <span className={`text-lg md:text-xl ${soft}`}>{task.notes.join(', ')}</span>
          ) : null}
          <Provenance task={task} className={`text-base tracking-[0.04em] md:text-lg ${soft}`} />
        </span>

        <span
          className={`col-start-2 mt-1 text-[15px] tracking-[0.06em] uppercase sm:text-base md:col-start-auto md:mt-0 md:text-right md:text-[19px] ${
            making ? 'text-accent font-semibold' : soft
          }`}
        >
          {who(t, task)}
        </span>
      </button>

      {onProgress ? (
        done ? (
          // Keep the column, so finished rows line up with the rest.
          <span
            className="bg-done border-rule no-print w-[76px] shrink-0 border-l sm:w-[92px]"
            aria-hidden
          />
        ) : (
          <ProgressTick
            task={task}
            making={making}
            onProgress={onProgress}
            disabled={disabled}
            size="line"
          />
        )
      ) : null}
    </li>
  );
}

function DeskRow({
  task,
  onToggle,
  onProgress,
  disabled,
  children,
}: {
  task: PrepTask;
  onToggle?: (next: PrepTaskStatus) => void;
  onProgress?: (next: ProgressChange) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { t } = useT();
  const done = task.status === 'done';
  const making = task.status === 'in_progress';
  const quantity = formatTaskQuantity(task);
  const shared = task.usedBy.length;

  return (
    <li className={`border-rule border-b ${done ? 'bg-done' : making ? 'bg-accent-wash' : ''}`}>
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-l-[5px] py-2.5 pr-[18px] pl-[13px] ${DESK_COLUMNS} ${
          done ? 'border-ink' : making ? 'border-accent' : 'border-transparent'
        }`}
      >
        <button
          type="button"
          disabled={disabled || !onToggle}
          onClick={() => onToggle?.(done ? 'open' : 'done')}
          aria-pressed={done}
          data-tour="task"
          className={`flex min-w-0 items-center gap-3 text-left disabled:cursor-default md:col-span-4 md:grid md:grid-cols-subgrid ${
            done ? 'opacity-60' : ''
          }`}
        >
          <Mark done={done} size="desk" />
          <span
            className={`qty shrink-0 text-[22px] md:text-right ${done ? 'text-ink-soft line-through' : ''}`}
          >
            {quantity ?? ''}
          </span>
          <span className="min-w-0">
            <span className={`text-[17px] ${done ? 'text-ink-soft line-through' : ''}`}>
              {task.description}
            </span>
            {task.notes.length > 0 ? (
              <span className="text-ink-soft"> {task.notes.join(', ')}</span>
            ) : null}
            {task.source === 'manual' ? (
              <span className="tag tag-accent ml-2 px-1.5 py-0 text-[11px]">
                {t('task.addedByHand')}
              </span>
            ) : shared > 1 ? (
              <span className="tag tag-brand ml-2 px-1.5 py-0 text-[11px]">
                {t('task.sharedBy', { count: shared })}
              </span>
            ) : null}
            {making ? (
              <span className="text-accent block text-sm font-semibold">{who(t, task)}</span>
            ) : null}
            {done && task.completedByName ? (
              <span className="text-ink-soft block text-sm">
                {t('task.doneBy', { name: task.completedByName })}
              </span>
            ) : null}
            <Provenance task={task} className="text-ink-soft block text-sm md:hidden" />
          </span>
          <span className="text-ink-soft hidden text-sm md:block">
            {task.usedBy.length > 0 ? task.usedBy.map((use) => use.recipeName).join(', ') : '—'}
          </span>
        </button>

        {onProgress && !done ? (
          <ProgressTick
            task={task}
            making={making}
            onProgress={onProgress}
            disabled={disabled}
            size="desk"
          />
        ) : (
          <span className="hidden md:block" aria-hidden />
        )}

        {children ? (
          <div className="no-print flex items-center gap-2 md:contents">{children}</div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The small tick: "being made". Deliberately its own target beside the row,
 * so reaching for it never ticks the job off by accident.
 */
function ProgressTick({
  task,
  making,
  onProgress,
  disabled,
  size,
}: {
  task: PrepTask;
  making: boolean;
  onProgress: (next: ProgressChange) => void;
  disabled?: boolean;
  size: Density;
}) {
  const { t } = useT();
  const label = t('task.beingMade');
  const box = size === 'line' ? 'h-7 w-7 text-base' : 'h-[18px] w-[18px] text-xs';

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={making}
      aria-label={`${label}: ${task.description}`}
      data-tour="being-made"
      onClick={() => onProgress(making ? 'open' : 'in_progress')}
      className={
        size === 'line'
          ? `no-print border-rule flex w-[76px] shrink-0 flex-col items-center justify-center gap-1.5 border-l px-1 text-center transition-colors disabled:opacity-45 sm:w-[92px] ${
              making
                ? 'bg-accent-wash text-accent'
                : 'bg-surface-raised text-ink-soft active:bg-surface-sunk'
            }`
          : `no-print inline-flex items-center gap-1.5 justify-self-start text-left transition-colors disabled:opacity-45 ${
              making ? 'text-accent' : 'text-ink-soft hover:text-ink'
            }`
      }
    >
      <span
        aria-hidden
        className={`flex shrink-0 items-center justify-center border-2 leading-none ${box} ${
          making ? 'border-accent bg-accent text-accent-ink' : 'border-ink-soft'
        }`}
      >
        {making ? '✓' : ''}
      </span>
      <span
        className={`leading-tight font-medium tracking-[0.06em] uppercase ${
          size === 'line' ? 'text-[11px] sm:text-xs' : 'text-[11px]'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

/** Column headings over a desk list. */
export function DeskListHead() {
  const { t } = useT();
  return (
    <div
      className={`col-head hidden gap-x-3 border-l-[5px] border-l-transparent py-[9px] pr-[18px] pl-[13px] md:grid ${DESK_COLUMNS}`}
    >
      <span />
      <span className="text-right">{t('common.amount')}</span>
      <span>{t('task.colWhat')}</span>
      <span>{t('task.colFor')}</span>
      <span>{t('task.inProgress')}</span>
      <span>{t('task.colWho')}</span>
      <span />
    </div>
  );
}

/** The tick. A filled mark, never a tint. */
function Mark({
  done,
  size,
  className = '',
}: {
  done: boolean;
  size: Density;
  className?: string;
}) {
  const box =
    size === 'line'
      ? 'h-9 w-9 border-[3px] text-[24px] sm:h-10 sm:w-10 sm:text-[26px]'
      : 'h-[22px] w-[22px] border-2 text-sm';
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center leading-none ${box} ${
        done ? 'border-ink bg-ink text-surface' : 'border-ink-soft'
      } ${className}`}
    >
      {done ? '✓' : ''}
    </span>
  );
}

/**
 * Where a generated total came from.
 *
 * The first time this button produces a number a chef disagrees with, they
 * need to be able to see the arithmetic. Otherwise they go back to the
 * whiteboard and never come back.
 */
function Provenance({ task, className }: { task: PrepTask; className: string }) {
  const { t } = useT();
  if (task.source !== 'generated' || task.usedBy.length === 0) return null;
  return (
    <span className={className}>
      {t('task.forRecipes', { recipes: task.usedBy.map((use) => use.recipeName).join(', ') })}
    </span>
  );
}

function who(t: Translator['t'], task: PrepTask): string {
  if (task.status === 'done' && task.completedByName) {
    return t('task.doneBy', { name: task.completedByName });
  }
  if (task.status === 'in_progress') {
    return task.assignedUserName
      ? t('task.beingMadeBy', { name: task.assignedUserName })
      : t('task.beingMade');
  }
  return task.assignedUserName ?? t('common.anyone');
}

/**
 * A station's band. Olive while there is work on it; once it is clear it sinks
 * to a grey bar, so "nothing left here" reads from across the room without
 * counting.
 */
export function StationHeading({
  station,
  tasks,
  density = 'line',
}: {
  station: Station | null;
  tasks: PrepTask[];
  density?: Density;
}) {
  const { t } = useT();
  const done = tasks.filter((task) => task.status === 'done').length;
  const clear = tasks.length > 0 && done === tasks.length;
  const size =
    density === 'line'
      ? 'h-12 px-4 text-xl sm:h-14 sm:px-5 sm:text-[22px] md:px-7 md:text-[26px]'
      : 'px-[18px] py-2 text-[19px]';

  return (
    <h3 className={`band ${size}`} data-clear={clear}>
      <span>{station?.name ?? t('common.anywhere')}</span>
      <span className="tracking-[0.06em]">
        {done} / {tasks.length}
      </span>
    </h3>
  );
}

/** Split a list into station blocks, in the order the stations are arranged. */
export function byStation(
  tasks: PrepTask[],
  stations: Station[],
): { station: Station | null; tasks: PrepTask[] }[] {
  const groups: { station: Station | null; tasks: PrepTask[] }[] = [];
  for (const station of stations) {
    const matching = tasks.filter((task) => task.stationId === station.id);
    if (matching.length > 0) groups.push({ station, tasks: matching });
  }
  const unassigned = tasks.filter((task) => !stations.some((s) => s.id === task.stationId));
  if (unassigned.length > 0) groups.push({ station: null, tasks: unassigned });
  return groups;
}
