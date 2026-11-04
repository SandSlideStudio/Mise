import type { PrepTask } from '@mise/contracts';
import { useStations } from '../api/kitchen.js';
import { useRunningTasks } from '../api/running.js';
import { useT } from '../i18n/index.js';
import { byStation, formatTaskQuantity } from './PrepTaskRow.js';

/**
 * The prep list on paper, printed every day in some kitchens, so as little
 * ink as it can be: a box and what to make, with how much, grouped by
 * station. Only what is still to do: a line ticked on the tablet isn't
 * printed, and one being made prints like any other.
 */
export function PrepListPrint({ kitchenName }: { kitchenName: string }) {
  const { t, locale } = useT();
  const tasks = useRunningTasks();
  const stations = useStations();

  const open = (tasks.data ?? []).filter(
    (task: PrepTask) => task.status === 'open' || task.status === 'in_progress',
  );
  const groups = byStation(open, stations.data ?? []);
  const day = new Date().toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <article className="hidden text-black print:block">
      <header className="flex items-baseline justify-between gap-6 border-b-[0.5px] border-black pb-2">
        <h1 className="text-[18pt] font-medium">{t('prepPrint.title')}</h1>
        <p className="text-[9.5pt]">
          {kitchenName} · {day}
        </p>
      </header>

      {groups.length === 0 ? <p className="mt-6 text-[12pt]">{t('prepPrint.empty')}</p> : null}

      {groups.map(({ station, tasks: lines }) => (
        <section key={station?.id ?? 'anywhere'} className="keep-together">
          <h2 className="font-display mt-[5.5mm] mb-1 text-[10pt] font-medium tracking-[0.14em] uppercase">
            {station?.name ?? t('common.anywhere')}
          </h2>
          {lines.map((task) => {
            const amount = formatTaskQuantity(task);
            return (
              <p key={task.id} className="flex items-center gap-[3.5mm] py-[1.6mm] text-[12.5pt]">
                <span
                  aria-hidden
                  className="h-[4.6mm] w-[4.6mm] shrink-0 border-[0.6px] border-black"
                />
                {amount
                  ? t('prepPrint.line', { name: task.description, amount })
                  : task.description}
              </p>
            );
          })}
        </section>
      ))}
    </article>
  );
}
