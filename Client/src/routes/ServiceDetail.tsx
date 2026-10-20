import { useState, type FormEvent } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import type { PrepTask, Station } from '@mise/contracts';
import { ALL_UNITS, type UnitCode } from '@mise/domain';
import { useStaff, useStations } from '../api/kitchen.js';
import { useCurrentUser } from '../api/session.js';
import {
  addDays,
  useCarryOver,
  useCreatePrepTask,
  useDeletePrepTask,
  usePrepTasks,
  useService,
  useServices,
  useUpdatePrepTask,
} from '../api/services.js';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate, PlateHead } from '../components/Plate.js';
import { byStation, DeskListHead, PrepTaskRow, StationHeading } from '../components/PrepTaskRow.js';
import { ServiceMenu } from '../components/ServiceMenu.js';
import { errorMessage, friendlyDate, periodName, useT } from '../i18n/index.js';

/**
 * Building the prep list, at a desk.
 *
 * A two-column board: the thing being built on the left — what is on tonight
 * and the list it becomes — and the two things you occasionally reach for on
 * the right. Manual entry never goes away, because there is always something
 * on the board that no recipe knows about.
 */
export function ServiceDetail() {
  const { serviceId } = useParams({ from: '/services/$serviceId' });
  const { t, plural, locale } = useT();
  const { data: user } = useCurrentUser();
  const service = useService(serviceId);
  const stations = useStations();
  const tasks = usePrepTasks(serviceId);
  const update = useUpdatePrepTask(serviceId);
  const remove = useDeletePrepTask(serviceId);

  if (!user) return null;
  const canManage = user.role !== 'cook';

  if (service.isPending) {
    return (
      <AppShell>
        <main className="text-ink-soft mx-auto max-w-[1340px] px-5 py-10">
          {t('common.loading')}
        </main>
      </AppShell>
    );
  }

  if (service.isError || !service.data) {
    return (
      <AppShell>
        <main className="mx-auto max-w-[1340px] px-5 py-10">
          <p className="text-danger">{t('service.notFound')}</p>
          <Link to="/services" className="btn-quiet mt-5">
            {t('service.backToServices')}
          </Link>
        </main>
      </AppShell>
    );
  }

  const list = tasks.data ?? [];
  const groups = byStation(list, stations.data ?? []);
  const done = list.filter((task) => task.status === 'done').length;

  return (
    <AppShell>
      <main className="mx-auto max-w-[1340px] px-4 py-6 sm:px-[30px] sm:py-[26px]">
        <Link to="/services" className="no-print eyebrow hover:text-ink mb-3 inline-block">
          {t('service.back')}
        </Link>
        <PageHeader
          title={`${periodName(t, service.data.period)}, ${friendlyDate(locale, service.data.date)}`}
          aside={
            service.data.covers ? plural('service.coversBooked', service.data.covers) : undefined
          }
          description={canManage ? t('service.intro') : undefined}
        />

        <div
          className={
            canManage ? 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]' : undefined
          }
        >
          <div className="flex min-w-0 flex-col gap-6">
            {canManage ? <ServiceMenu service={service.data} tasks={list} /> : null}

            <Plate>
              <PlateHead
                title={t('service.theList')}
                aside={t('service.linesDone', {
                  lines: plural('service.lines', list.length),
                  done,
                })}
              />
              {tasks.isError ? (
                <LoadError className="m-4" onRetry={() => void tasks.refetch()} />
              ) : list.length === 0 ? (
                <p className="text-ink-soft p-8 text-center">
                  {t('service.emptyList')}
                  {canManage ? ` ${t('service.emptyListManage')}` : ''}
                </p>
              ) : (
                <>
                  <DeskListHead />
                  {groups.map((group) => (
                    <div key={group.station?.id ?? 'none'}>
                      <StationHeading station={group.station} tasks={group.tasks} density="desk" />
                      <ul>
                        {group.tasks.map((task) => (
                          <PrepTaskRow
                            key={task.id}
                            task={task}
                            density="desk"
                            onToggle={(next) => update.mutate({ id: task.id, status: next })}
                            onProgress={(next) =>
                              update.mutate(
                                next === 'in_progress'
                                  ? { id: task.id, status: next, assignedUserId: user.id }
                                  : { id: task.id, status: next },
                              )
                            }
                          >
                            {canManage ? (
                              <TaskControls
                                task={task}
                                serviceId={serviceId}
                                onDelete={() => remove.mutate(task.id)}
                              />
                            ) : null}
                          </PrepTaskRow>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
            </Plate>

            <div className="no-print flex gap-3">
              <button type="button" className="btn-quiet" onClick={() => window.print()}>
                {t('service.printList')}
              </button>
            </div>
          </div>

          {canManage ? (
            <aside className="no-print flex flex-col gap-6">
              <AddTaskForm serviceId={serviceId} stations={stations.data ?? []} />
              <CarryOverControl serviceId={serviceId} date={service.data.date} />
            </aside>
          ) : null}
        </div>
      </main>
    </AppShell>
  );
}

/** Assign a task to somebody, or take it off the list. */
function TaskControls({
  task,
  serviceId,
  onDelete,
}: {
  task: PrepTask;
  serviceId: string;
  onDelete: () => void;
}) {
  const { t } = useT();
  const staff = useStaff();
  const update = useUpdatePrepTask(serviceId);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <select
        aria-label={t('service.whoDoes', { task: task.description })}
        className={`border-field bg-surface-raised h-[34px] w-32 min-w-0 border px-2 text-sm md:w-full ${
          task.assignedUserId ? 'text-ink' : 'text-ink-soft'
        }`}
        value={task.assignedUserId ?? ''}
        onChange={(e) => update.mutate({ id: task.id, assignedUserId: e.target.value || null })}
      >
        <option value="">{t('common.anyone')}</option>
        {(staff.data ?? [])
          .filter((person) => person.active)
          .map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
      </select>

      {confirming ? (
        <button
          type="button"
          className="btn-small border-danger text-danger justify-self-end"
          onClick={onDelete}
          onBlur={() => setConfirming(false)}
          autoFocus
        >
          {t('service.removeConfirm')}
        </button>
      ) : (
        <button
          type="button"
          className="border-line text-ink-soft hover:text-ink flex h-[30px] w-[30px] items-center justify-center justify-self-end border text-sm"
          onClick={() => setConfirming(true)}
          aria-label={t('service.removeTask', { task: task.description })}
        >
          ✕
        </button>
      )}
    </>
  );
}

/**
 * One line, typed the way a chef would say it: how much, of what, on which
 * section. The quantity is optional because plenty of prep has no number.
 */
function AddTaskForm({ serviceId, stations }: { serviceId: string; stations: Station[] }) {
  const translator = useT();
  const { t } = translator;
  const create = useCreatePrepTask(serviceId);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<UnitCode>('kg');
  const [stationId, setStationId] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate(
      {
        description,
        stationId: stationId || null,
        quantity: amount ? { value: Number(amount), unit } : null,
      },
      {
        onSuccess: () => {
          // Only clear once it is actually saved, so a failed add does not
          // lose what somebody typed. The station stays, because the next few
          // lines are usually for the same section.
          setDescription('');
          setAmount('');
        },
      },
    );
  }

  return (
    <Plate className="p-[18px]">
      <h2 className="font-display text-brand text-xl font-semibold tracking-[0.14em] uppercase">
        {t('addTask.title')}
      </h2>
      <p className="text-ink-soft mt-1 mb-3.5 text-sm text-pretty">{t('addTask.body')}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-2.5">
        <input
          aria-label={t('addTask.what')}
          className="field"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('addTask.placeholder')}
          required
        />
        <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2.5">
          <input
            aria-label={t('common.howMuch')}
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            className="field qty text-right text-[22px] placeholder:font-sans placeholder:text-base placeholder:font-normal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('common.howMuch')}
          />
          <select
            aria-label={t('common.unit')}
            className="field"
            value={unit}
            onChange={(e) => setUnit(e.target.value as UnitCode)}
          >
            {ALL_UNITS.map((u) => (
              <option key={u.code} value={u.code}>
                {u.code}
              </option>
            ))}
          </select>
        </div>
        <select
          aria-label={t('common.station')}
          className="field"
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
        >
          <option value="">{t('common.anyStation')}</option>
          {stations.map((station) => (
            <option key={station.id} value={station.id}>
              {station.name}
            </option>
          ))}
        </select>

        {create.error ? (
          <p role="alert" className="text-danger text-sm">
            {errorMessage(translator, create.error)}
          </p>
        ) : null}

        <button type="submit" className="btn-quiet border-ink" disabled={create.isPending}>
          {t('addTask.submit')}
        </button>
      </form>
    </Plate>
  );
}

/** Move the bottom half of an earlier board onto this one. */
function CarryOverControl({ serviceId, date }: { serviceId: string; date: string }) {
  const translator = useT();
  const { t, locale } = translator;
  const carry = useCarryOver(serviceId);
  const recent = useServices({ from: addDays(date, -7), to: date });

  const candidates = (recent.data ?? []).filter(
    (s) => s.id !== serviceId && s.taskCount > s.doneCount,
  );

  if (candidates.length === 0 && !carry.isSuccess) return null;

  return (
    <Plate className="p-[18px]">
      <h2 className="font-display text-brand text-xl font-semibold tracking-[0.14em] uppercase">
        {t('carry.title')}
      </h2>
      <p className="text-ink-soft mt-1 mb-3 text-sm text-pretty">{t('carry.body')}</p>

      <ul className="flex flex-col gap-3">
        {candidates.map((service) => {
          const unfinished = service.taskCount - service.doneCount;
          return (
            <li key={service.id} className="flex flex-col gap-2">
              <span className="border-rule flex justify-between gap-2.5 border-b pb-1.5 text-[15px]">
                <span>
                  {periodName(t, service.period)}, {friendlyDate(locale, service.date)}
                </span>
                <span className="qty text-[19px]">{unfinished}</span>
              </span>
              <button
                type="button"
                className="btn-quiet border-ink w-full"
                disabled={carry.isPending}
                onClick={() => carry.mutate(service.id)}
              >
                {unfinished === 1 ? t('carry.one') : t('carry.all', { count: unfinished })}
              </button>
            </li>
          );
        })}
      </ul>

      {carry.isSuccess ? (
        <p className="text-ink-soft mt-3 text-sm">
          {carry.data.skipped > 0
            ? t('carry.resultSkipped', {
                created: carry.data.created,
                skipped: carry.data.skipped,
              })
            : t('carry.result', { created: carry.data.created })}
        </p>
      ) : null}
      {carry.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, carry.error)}
        </p>
      ) : null}
    </Plate>
  );
}
