import { useState, type FormEvent } from 'react';
import type { Station } from '@mise/contracts';
import {
  useCreateStation,
  useDeleteStation,
  useReorderStations,
  useStations,
  useUpdateStation,
} from '../../api/kitchen.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * Stations.
 *
 * Every prep list in the system is grouped by these, and the order here is the
 * order a prep list prints in, so it should read the way the kitchen is laid
 * out rather than alphabetically.
 */
export function StationSettings() {
  const translator = useT();
  const { t } = translator;
  const stations = useStations();
  const create = useCreateStation();
  const remove = useDeleteStation();
  const reorder = useReorderStations();
  const [name, setName] = useState('');

  if (stations.isPending) return <p className="text-ink-soft">{t('stations.loading')}</p>;
  if (stations.isError) return <p className="text-danger">{t('stations.loadError')}</p>;

  const list = stations.data;

  function move(index: number, direction: -1 | 1) {
    const next = [...list];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    reorder.mutate(next.map((s) => s.id));
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    create.mutate({ name, sortOrder: list.length }, { onSuccess: () => setName('') });
  }

  return (
    <section>
      <h2 className="mb-1.5 text-2xl">{t('stations.title')}</h2>
      <p className="text-ink-soft mb-5 text-sm">{t('stations.body')}</p>

      <ul className="divide-line border-line bg-surface-raised divide-y border">
        {list.map((station, index) => (
          <StationRow
            key={station.id}
            station={station}
            isFirst={index === 0}
            isLast={index === list.length - 1}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
            onDelete={() => remove.mutate(station.id)}
            deleting={remove.isPending}
          />
        ))}
      </ul>

      {list.length === 0 ? (
        <p className="text-ink-soft border-line border border-dashed p-6 text-center">
          {t('stations.empty')}
        </p>
      ) : null}

      <form onSubmit={onAdd} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="stationName">
            {t('stations.addLabel')}
          </label>
          <input
            id="stationName"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('stations.placeholder')}
            required
          />
        </div>
        <button type="submit" className="btn-quiet" disabled={create.isPending}>
          {t('common.add')}
        </button>
      </form>

      {create.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, create.error)}
        </p>
      ) : null}
      {remove.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, remove.error)}
        </p>
      ) : null}
    </section>
  );
}

function StationRow({
  station,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onDelete,
  deleting,
}: {
  station: Station;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useT();
  const update = useUpdateStation();
  const [name, setName] = useState(station.name);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function save(event: FormEvent) {
    event.preventDefault();
    update.mutate({ id: station.id, name }, { onSuccess: () => setRenaming(false) });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      {renaming ? (
        <form onSubmit={save} className="flex flex-1 flex-wrap items-center gap-2">
          <input
            className="field min-w-40 flex-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <button type="submit" className="btn-small" disabled={update.isPending}>
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn-small"
            onClick={() => {
              setName(station.name);
              setRenaming(false);
            }}
          >
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 font-medium">{station.name}</span>

          <div className="flex gap-1">
            <button
              type="button"
              className="btn-small"
              onClick={onMoveUp}
              disabled={isFirst}
              aria-label={t('stations.moveEarlier', { name: station.name })}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn-small"
              onClick={onMoveDown}
              disabled={isLast}
              aria-label={t('stations.moveLater', { name: station.name })}
            >
              ↓
            </button>
          </div>

          <button type="button" className="btn-small" onClick={() => setRenaming(true)}>
            {t('stations.rename')}
          </button>

          {confirming ? (
            <button
              type="button"
              className="btn-small border-danger text-danger"
              onClick={onDelete}
              disabled={deleting}
            >
              {t('common.reallyDelete')}
            </button>
          ) : (
            <button type="button" className="btn-small" onClick={() => setConfirming(true)}>
              {t('common.delete')}
            </button>
          )}
        </>
      )}
    </li>
  );
}
