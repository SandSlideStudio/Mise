import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import type { ServicePeriod } from '@mise/contracts';
import { useCurrentUser } from '../api/session.js';
import { addDays, todayIso, useCreateService, useServices } from '../api/services.js';
import { AppShell, PageHeader } from '../components/AppShell.js';
import { LoadError } from '../components/LoadError.js';
import { Plate } from '../components/Plate.js';
import { errorMessage, friendlyDate, periodName, useT } from '../i18n/index.js';

const PERIODS: ServicePeriod[] = ['breakfast', 'lunch', 'dinner', 'prep_day', 'event'];

const COLUMNS = 'sm:grid-cols-[minmax(0,1fr)_110px_150px]';

/** Planning: the fortnight around today, and a form to add a service. */
export function Services() {
  const { t, locale } = useT();
  const { data: user } = useCurrentUser();
  const today = todayIso();
  const services = useServices({ from: addDays(today, -7), to: addDays(today, 21) });
  const [adding, setAdding] = useState(false);

  if (!user) return null;
  const canManage = user.role !== 'cook';

  return (
    <AppShell>
      <main className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <PageHeader title={t('nav.services')} description={t('services.subtitle')} />
          {canManage && !adding ? (
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              {t('services.plan')}
            </button>
          ) : null}
        </div>

        {adding ? (
          <NewServiceForm onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
        ) : null}

        <Plate>
          <div className={`col-head hidden gap-3 px-6 py-[9px] sm:grid ${COLUMNS}`}>
            <span>{t('services.colService')}</span>
            <span className="text-right">{t('services.colCovers')}</span>
            <span className="text-right">{t('services.colPrep')}</span>
          </div>

          {services.isPending ? (
            <p className="text-ink-soft px-6 py-6">{t('common.loading')}</p>
          ) : null}

          {services.isError ? (
            <LoadError className="m-4 sm:m-6" onRetry={() => void services.refetch()} />
          ) : null}

          {services.data?.length === 0 ? (
            <p className="text-ink-soft px-6 py-10 text-center">{t('services.empty')}</p>
          ) : null}

          <ul>
            {services.data?.map((service) => {
              const past = service.date < today;
              return (
                <li key={service.id}>
                  <Link
                    to="/services/$serviceId"
                    params={{ serviceId: service.id }}
                    className={`border-rule hover:bg-surface-sunk grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-5 py-3 transition-colors sm:px-6 ${COLUMNS} ${
                      past ? 'text-ink-soft' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="font-display text-2xl font-semibold">
                        {periodName(t, service.period)}
                      </span>
                      {service.date === today ? (
                        <span className="tag tag-accent ml-2.5 px-1.5 py-0 align-middle text-[11px]">
                          {t('services.todayTag')}
                        </span>
                      ) : null}
                      <span className="text-ink-soft block text-[15px]">
                        {friendlyDate(locale, service.date)}
                      </span>
                    </span>
                    <span className="hidden text-right sm:block">
                      {service.covers ? (
                        <span className="qty text-[22px]">{service.covers}</span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </span>
                    <span className="text-right">
                      {service.taskCount === 0 ? (
                        <span className="text-ink-faint text-sm">{t('services.noPrep')}</span>
                      ) : (
                        <span className="font-display text-xl font-semibold tracking-[0.04em]">
                          {service.doneCount} / {service.taskCount}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Plate>
      </main>
    </AppShell>
  );
}

function NewServiceForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const translator = useT();
  const { t } = translator;
  const create = useCreateService();
  const [date, setDate] = useState(todayIso());
  const [period, setPeriod] = useState<ServicePeriod>('dinner');
  const [covers, setCovers] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    create.mutate({ date, period, covers: covers ? Number(covers) : null }, { onSuccess: onDone });
  }

  return (
    <Plate className="mb-8 p-5 sm:p-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <h2 className="font-display text-brand text-xl font-semibold tracking-[0.14em] uppercase">
          {t('services.plan')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="date">
              {t('services.date')}
            </label>
            <input
              id="date"
              type="date"
              className="field"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="period">
              {t('services.period')}
            </label>
            <select
              id="period"
              className="field"
              value={period}
              onChange={(e) => setPeriod(e.target.value as ServicePeriod)}
            >
              {PERIODS.map((value) => (
                <option key={value} value={value}>
                  {periodName(t, value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="covers">
              {t('services.coversBooked')}
            </label>
            <input
              id="covers"
              type="number"
              min={0}
              className="field qty text-xl"
              value={covers}
              onChange={(e) => setCovers(e.target.value)}
              placeholder={t('common.optional')}
            />
          </div>
        </div>

        {create.error ? (
          <p role="alert" className="text-danger text-sm">
            {errorMessage(translator, create.error)}
          </p>
        ) : null}

        <div className="flex gap-3">
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? t('common.creating') : t('common.create')}
          </button>
          <button type="button" className="btn-quiet" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Plate>
  );
}
