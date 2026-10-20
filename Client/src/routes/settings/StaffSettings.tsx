import { useState, type FormEvent } from 'react';
import { mayManage, ROLES, type Role, type Station, type User } from '@mise/contracts';
import {
  useCreateStaff,
  useRemoveStaff,
  useStaff,
  useStations,
  useUpdateStaff,
} from '../../api/kitchen.js';
import { useCurrentUser } from '../../api/session.js';
import { errorMessage, roleName, useT } from '../../i18n/index.js';

/**
 * The brigade.
 *
 * Most people in a kitchen only ever need a name, a station and four digits.
 * Email and password are for the handful who manage the place, so the form
 * leads with the PIN and treats the rest as the exception.
 */
export function StaffSettings() {
  const { t } = useT();
  const staff = useStaff();
  const stations = useStations();
  const { data: me } = useCurrentUser();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);

  if (staff.isPending) return <p className="text-ink-soft">{t('line.loading')}</p>;
  if (staff.isError) return <p className="text-danger">{t('staff.loadError')}</p>;

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-2xl">{t('staff.title')}</h2>
        <button type="button" className="btn-small" onClick={() => setAdding(true)}>
          {t('staff.add')}
        </button>
      </div>

      {adding ? (
        <div className="mb-5">
          <StaffForm
            stations={stations.data ?? []}
            onClose={() => setAdding(false)}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : null}

      <ul className="divide-line border-line bg-surface-raised divide-y border">
        {staff.data.map((person) => (
          <StaffRow
            key={person.id}
            person={person}
            stations={stations.data ?? []}
            isSelf={person.id === me?.id}
            canManage={me != null && (person.id === me.id || mayManage(me.role, person.role))}
            editing={editing?.id === person.id}
            onEdit={() => setEditing(editing?.id === person.id ? null : person)}
            onDone={() => setEditing(null)}
          />
        ))}
      </ul>
    </section>
  );
}

function StaffRow({
  person,
  stations,
  isSelf,
  canManage,
  editing,
  onEdit,
  onDone,
}: {
  person: User;
  stations: Station[];
  isSelf: boolean;
  /** Whether you may edit or remove them. */
  canManage: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const translator = useT();
  const { t } = translator;
  const remove = useRemoveStaff();
  const [confirming, setConfirming] = useState(false);

  const station = stations.find((s) => s.id === person.defaultStationId);
  const locked = person.lockedUntil !== null && new Date(person.lockedUntil) > new Date();

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            {person.displayName}
            {isSelf ? <span className="text-ink-soft font-normal"> {t('staff.you')}</span> : null}
          </p>
          <p className="text-ink-soft mt-0.5 text-sm">
            {roleName(t, person.role)}
            {station ? ` · ${station.name}` : ''}
            {person.email ? ` · ${person.email}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {person.hasPin ? <span className="tag">{t('staff.pinTag')}</span> : null}
          {person.hasPassword ? <span className="tag">{t('staff.passwordTag')}</span> : null}
          {locked ? (
            <span className="tag border-danger text-danger">{t('staff.locked')}</span>
          ) : null}
        </div>

        <div className="flex gap-2">
          {canManage ? (
            <button type="button" className="btn-small" onClick={onEdit}>
              {editing ? t('common.cancel') : t('common.edit')}
            </button>
          ) : null}
          {!isSelf && canManage ? (
            confirming ? (
              <button
                type="button"
                className="btn-small border-danger text-danger"
                onClick={() => remove.mutate(person.id, { onSettled: () => setConfirming(false) })}
                disabled={remove.isPending}
              >
                {t('common.reallyRemove')}
              </button>
            ) : (
              <button type="button" className="btn-small" onClick={() => setConfirming(true)}>
                {t('common.remove')}
              </button>
            )
          ) : null}
        </div>
      </div>

      {remove.error ? (
        <p role="alert" className="text-danger mt-2 text-sm">
          {errorMessage(translator, remove.error)}
        </p>
      ) : null}

      {editing ? (
        <div className="mt-4">
          <StaffForm person={person} stations={stations} onClose={onDone} onDone={onDone} />
        </div>
      ) : null}
    </li>
  );
}

function StaffForm({
  person,
  stations,
  onClose,
  onDone,
}: {
  person?: User;
  stations: Station[];
  onClose: () => void;
  onDone: () => void;
}) {
  const translator = useT();
  const { t } = translator;
  const create = useCreateStaff();
  const update = useUpdateStaff();
  const { data: me } = useCurrentUser();
  const editing = person !== undefined;
  // Only the roles you may give out, plus the one this person already has.
  const roles = [...ROLES]
    .reverse()
    .filter((value) => (me && mayManage(me.role, value)) || value === person?.role);

  const [displayName, setDisplayName] = useState(person?.displayName ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'cook');
  const [stationId, setStationId] = useState(person?.defaultStationId ?? '');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState(person?.email ?? '');
  const [password, setPassword] = useState('');

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const shared = {
      displayName,
      role,
      defaultStationId: stationId || null,
      email: email || null,
    };

    if (editing) {
      update.mutate(
        {
          id: person.id,
          ...shared,
          ...(pin ? { pin } : {}),
          ...(password ? { password } : {}),
        },
        { onSuccess: onDone },
      );
    } else {
      create.mutate(
        { ...shared, ...(pin ? { pin } : {}), ...(password ? { password } : {}) },
        { onSuccess: onDone },
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="card flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="displayName">
            {t('common.name')}
          </label>
          <input
            id="displayName"
            className="field"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('staff.namePlaceholder')}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="role">
            {t('staff.role')}
          </label>
          <select
            id="role"
            className="field"
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {roles.map((value) => (
              <option key={value} value={value}>
                {roleName(t, value)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="station">
            {t('staff.station')}
          </label>
          <select
            id="station"
            className="field"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
          >
            <option value="">{t('staff.noStation')}</option>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="pin">
            {editing && person.hasPin ? t('staff.newPin') : t('staff.pinTag')}
          </label>
          <input
            id="pin"
            className="field"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder={editing && person.hasPin ? t('staff.keepIt') : t('staff.pinPlaceholder')}
          />
          <p className="text-ink-soft mt-1.5 text-sm">{t('staff.pinHint')}</p>
        </div>
      </div>

      <details className="border-line border-t pt-4" open={Boolean(person?.email)}>
        <summary className="text-ink-soft cursor-pointer text-sm font-medium">
          {t('staff.passwordSection')}
        </summary>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="email">
              {t('common.email')}
            </label>
            <input
              id="email"
              type="email"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              {editing && person.hasPassword ? t('staff.newPassword') : t('common.password')}
            </label>
            <input
              id="password"
              type="password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={
                editing && person.hasPassword ? t('staff.keepIt') : t('staff.passwordPlaceholder')
              }
            />
          </div>
        </div>
      </details>

      {error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(translator, error)}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t('common.saving') : editing ? t('common.save') : t('staff.addSubmit')}
        </button>
        <button type="button" className="btn-quiet" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
