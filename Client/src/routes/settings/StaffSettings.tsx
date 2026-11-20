import { useState, type FormEvent } from 'react';
import { PasswordInput } from '../../components/PasswordInput.js';
import { PasswordConfirm, refusedForPassword } from '../../components/PasswordConfirm.js';
import { useOutside } from '../../api/access.js';
import { passwordAsked } from '../../lib/passwordAsked.js';
import { mayManage, ROLES, type Role, type Station, type User } from '@mise/contracts';
import {
  useCreateStaff,
  useKitchen,
  usePinOnlyStatus,
  useRemoveStaff,
  useUnlockStaff,
  useStaff,
  useStations,
  useUpdateStaff,
} from '../../api/kitchen.js';
import { useCurrentUser } from '../../api/session.js';
import { fetchPersonData, usePrivacySummary } from '../../api/privacy.js';
import { saveFile } from '../../components/PrintSheets.js';
import { errorMessage, roleName, useT } from '../../i18n/index.js';
import { readablePersonData } from '../../lib/personData.js';

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
  // Changing the brigade is for head chefs and administrators; a sous chef
  // sees who is on it, and can download their own data.
  const mayChange = me?.role === 'admin' || me?.role === 'head_chef';
  // While PIN-only sign-in waits, whoever still needs a new PIN is marked.
  const pinOnly = usePinOnlyStatus(mayChange);
  const waiting = new Set(
    pinOnly.data?.state === 'waiting' ? pinOnly.data.waiting.map((p) => p.id) : [],
  );

  if (staff.isPending) return <p className="text-ink-soft">{t('line.loading')}</p>;
  if (staff.isError && staff.data === undefined)
    return <p className="text-danger">{t('staff.loadError')}</p>;

  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-2xl">{t('staff.title')}</h2>
        {mayChange ? (
          <button type="button" className="btn-small" onClick={() => setAdding(true)}>
            {t('staff.add')}
          </button>
        ) : null}
      </div>

      {adding && mayChange ? (
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
            needsNewPin={waiting.has(person.id)}
            canManage={
              me != null && mayChange && (person.id === me.id || mayManage(me.role, person.role))
            }
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
  needsNewPin,
  canManage,
  editing,
  onEdit,
  onDone,
}: {
  person: User;
  stations: Station[];
  isSelf: boolean;
  /** PIN-only sign-in waits for them to be given a new PIN. */
  needsNewPin: boolean;
  /** Whether you may edit or remove them. */
  canManage: boolean;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const translator = useT();
  const { t } = translator;
  const remove = useRemoveStaff();
  const unlock = useUnlockStaff();
  const [confirming, setConfirming] = useState(false);
  const [showData, setShowData] = useState(false);

  const station = stations.find((s) => s.id === person.defaultStationId);
  const locked = person.lockedUntil !== null && new Date(person.lockedUntil) > new Date();

  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* Room for the name and role first: on a phone the tags and buttons
            go below them, instead of squeezing them into a column of dots. */}
        <div className="min-w-0 flex-1 basis-56">
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
          {needsNewPin ? (
            <span className="tag border-accent text-accent">{t('pinOnly.needsNewPin')}</span>
          ) : null}
          {person.hasPassword ? <span className="tag">{t('staff.passwordTag')}</span> : null}
          {locked ? (
            <span className="tag border-danger text-danger">{t('staff.locked')}</span>
          ) : null}
        </div>

        {locked && canManage ? (
          <button
            type="button"
            className="btn-small"
            disabled={unlock.isPending}
            onClick={() => unlock.mutate(person.id)}
          >
            {t('staff.unlock')}
          </button>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <button type="button" className="btn-small" onClick={onEdit}>
              {editing ? t('common.cancel') : t('common.edit')}
            </button>
          ) : null}
          {canManage || isSelf ? (
            <button
              type="button"
              className="btn-small"
              aria-expanded={showData}
              onClick={() => setShowData(!showData)}
            >
              {isSelf ? t('staff.yourData') : t('staff.theirData')}
            </button>
          ) : null}
          {!isSelf && canManage && !confirming ? (
            <button type="button" className="btn-small" onClick={() => setConfirming(true)}>
              {t('staff.removeForGood')}
            </button>
          ) : null}
        </div>
      </div>

      {showData ? <PersonDataDownload person={person} /> : null}

      {confirming ? (
        <RemoveForGood
          person={person}
          pending={remove.isPending}
          onRemove={() => remove.mutate(person.id, { onSettled: () => setConfirming(false) })}
          onCancel={() => setConfirming(false)}
        />
      ) : null}

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

/**
 * Everything Mise holds about someone, for when they ask. Readable for them,
 * and the same as JSON for a computer.
 */
function PersonDataDownload({ person }: { person: User }) {
  const translator = useT();
  const { t } = translator;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function download(as: 'text' | 'json') {
    setPending(true);
    setError(null);
    try {
      const data = await fetchPersonData(person.id);
      const name = `${person.displayName} - Mise`;
      if (as === 'json') {
        const json = JSON.stringify(data, null, 2);
        saveFile(new Blob([json], { type: 'application/json' }), `${name}.json`);
      } else {
        const text = readablePersonData(translator, data);
        saveFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${name}.txt`);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-surface border-line mt-4 border px-4 py-4">
      <p className="text-ink-soft text-sm">
        {t('staff.theirDataHint', { name: person.displayName })}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          className="btn-quiet"
          disabled={pending}
          onClick={() => void download('text')}
        >
          {t('staff.downloadReadable')}
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={pending}
          onClick={() => void download('json')}
        >
          {t('staff.downloadJson')}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-danger mt-2 text-sm">
          {errorMessage(translator, error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Removing someone can't be undone, and backups made before still hold them
 * until they rotate out. Both are said before anything happens.
 */
function RemoveForGood({
  person,
  pending,
  onRemove,
  onCancel,
}: {
  person: User;
  pending: boolean;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { t, plural } = useT();
  const privacy = usePrivacySummary();
  const backups = privacy.data?.backups;
  const remote = backups && (backups.webdav || backups.onedrive);

  return (
    <div role="alert" className="border-danger bg-surface-raised mt-4 border-l-[6px] px-5 py-4">
      <p className="font-medium">{t('staff.removeTitle', { name: person.displayName })}</p>
      <p className="text-ink-soft mt-1 text-sm">{t('staff.removeWhat')}</p>
      {backups ? (
        <p className="text-ink-soft mt-2 text-sm">
          {plural('staff.removeBackupsLocal', backups.keepLocal)}
          {remote ? ` ${plural('staff.removeBackupsRemote', backups.keepRemote)}` : ''}{' '}
          {t('staff.removeBackupsDownloaded')}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" className="btn-danger" disabled={pending} onClick={onRemove}>
          {t('staff.removeForGood')}
        </button>
        <button type="button" className="btn-quiet" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
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
  const kitchen = useKitchen();
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
  const [currentPassword, setCurrentPassword] = useState('');

  const pending = create.isPending || update.isPending;
  const error = create.error ?? update.error;

  const outside = useOutside();
  const asked = passwordAsked({
    person,
    meId: me?.id,
    outside,
    edit: { email: email || null, password, pin, role },
  });
  const asksPassword = asked !== null || refusedForPassword(error);
  const ownSignIn = asked === 'self';

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const shared = {
      displayName,
      role,
      defaultStationId: stationId || null,
      email: email || null,
      ...(asksPassword && currentPassword ? { currentPassword } : {}),
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
          <p className="text-ink-soft mt-1.5 text-sm">
            {kitchen.data && kitchen.data.pinOnly !== 'off'
              ? t('pinOnly.pinHint')
              : t('staff.pinHint')}
          </p>
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
            <PasswordInput
              id="password"
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

      {asksPassword ? (
        <div className="border-line grid gap-5 border-t pt-4 sm:grid-cols-2">
          <div>
            <PasswordConfirm
              id="currentPassword"
              className=""
              label={ownSignIn ? t('confirm.currentPasswordLabel') : t('confirm.passwordLabel')}
              value={currentPassword}
              onChange={setCurrentPassword}
            />
            <p className="text-ink-faint mt-1.5 text-sm">
              {ownSignIn ? t('confirm.whySelf') : t('confirm.whyOutside')}
            </p>
          </div>
        </div>
      ) : null}

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
