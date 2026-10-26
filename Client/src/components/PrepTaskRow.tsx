import { useState } from 'react';
import type { PrepTask, PrepTaskStatus, Station } from '@mise/contracts';
import { formatQuantity, humanize, isUnitCode } from '@mise/domain';
import { useT, type Translator } from '../i18n/index.js';

/**
 * One line of the prep list.
 *
 * On the line it is the only control anyone touches all afternoon, so the
 * whole row is the target and it is sized for a nitrile thumb at a metre.
 *
 * Done is drawn four ways at once — a filled mark, a strike, a bar in the left
 * margin and a sunk ground — so a bad screen, a colourblind cook and a
 * photocopy all read it the same.
 *
 * Beside the row sits a second, smaller tick: "being made". It puts the name
 * of whoever tapped it on the line, so two cooks do not both start the stock.
 * A chef also gets a way to take a line off the list again.
 */

/** Starting a job, or putting it back. */
export type ProgressChange = 'in_progress' | 'open';

export function formatTaskQuantity(task: PrepTask): string | null {
  if (!task.quantity || !isUnitCode(task.quantity.unit)) return null;
  // Stored in base units, so 2000 g reads back as 2 kg.
  return formatQuantity(humanize({ value: task.quantity.value, unit: task.quantity.unit }));
}

export function PrepTaskRow({
  task,
  note,
  onToggle,
  onProgress,
  onRemove,
  disabled,
}: {
  task: PrepTask;
  /** A line under the name, such as when a ticked line will drop off. */
  note?: string | null;
  onToggle?: (next: PrepTaskStatus) => void;
  /** Mark the job as being made by whoever is signed in, or clear that. */
  onProgress?: (next: ProgressChange) => void;
  /** Take the line off the list. Only offered to chefs. */
  onRemove?: () => void;
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
        <Mark done={done} className="row-span-3 md:row-span-1" />

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
          {note ? <span className={`text-lg md:text-xl ${soft}`}>{note}</span> : null}
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
          <ProgressTick task={task} making={making} onProgress={onProgress} disabled={disabled} />
        )
      ) : null}

      {onRemove ? <RemoveButton task={task} onRemove={onRemove} disabled={disabled} /> : null}
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
}: {
  task: PrepTask;
  making: boolean;
  onProgress: (next: ProgressChange) => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const label = t('task.beingMade');

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={making}
      aria-label={`${label}: ${task.description}`}
      data-tour="being-made"
      onClick={() => onProgress(making ? 'open' : 'in_progress')}
      className={`no-print border-rule flex w-[76px] shrink-0 flex-col items-center justify-center gap-1.5 border-l px-1 text-center transition-colors disabled:opacity-45 sm:w-[92px] ${
        making
          ? 'bg-accent-wash text-accent'
          : 'bg-surface-raised text-ink-soft active:bg-surface-sunk'
      }`}
    >
      <span
        aria-hidden
        className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 text-base leading-none ${
          making ? 'border-accent bg-accent text-accent-ink' : 'border-ink-soft'
        }`}
      >
        {making ? '✓' : ''}
      </span>
      <span className="text-[11px] leading-tight font-medium tracking-[0.06em] uppercase sm:text-xs">
        {label}
      </span>
    </button>
  );
}

/**
 * Taking a line off the list. Two taps, the second on the same spot, so a
 * glove brushing past never removes somebody's work.
 */
function RemoveButton({
  task,
  onRemove,
  disabled,
}: {
  task: PrepTask;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={t('task.remove', { task: task.description })}
      onClick={() => (confirming ? onRemove() : setConfirming(true))}
      onBlur={() => setConfirming(false)}
      className={`no-print border-rule flex w-[64px] shrink-0 flex-col items-center justify-center gap-1 border-l px-1 text-center transition-colors disabled:opacity-45 sm:w-[76px] ${
        confirming
          ? 'bg-danger text-white'
          : 'bg-surface-raised text-ink-soft active:bg-surface-sunk'
      }`}
    >
      <span aria-hidden className="text-xl leading-none">
        ✕
      </span>
      <span className="text-[11px] leading-tight font-medium tracking-[0.06em] uppercase">
        {confirming ? t('task.removeConfirm') : t('common.remove')}
      </span>
    </button>
  );
}

/** The tick. A filled mark, never a tint. */
function Mark({ done, className = '' }: { done: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center border-[3px] text-[24px] leading-none sm:h-10 sm:w-10 sm:text-[26px] ${
        done ? 'border-ink bg-ink text-surface' : 'border-ink-soft'
      } ${className}`}
    >
      {done ? '✓' : ''}
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
export function StationHeading({ station, tasks }: { station: Station | null; tasks: PrepTask[] }) {
  const { t } = useT();
  const done = tasks.filter((task) => task.status === 'done').length;
  const clear = tasks.length > 0 && done === tasks.length;

  return (
    <h3
      className="band h-12 px-4 text-xl sm:h-14 sm:px-5 sm:text-[22px] md:px-7 md:text-[26px]"
      data-clear={clear}
    >
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
