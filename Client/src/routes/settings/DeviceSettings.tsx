import { useState, type FormEvent } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { useDevices, useEnrollDevice, useRevokeDevice } from '../../api/kitchen.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * Kitchen tablets.
 *
 * Enrolling writes a long-lived cookie onto whatever device does the
 * enrolling, which means an administrator has to walk to the tablet and do it
 * there. That is deliberate: it is also why nobody ever has to read a token
 * out loud or type one in.
 */
export function DeviceSettings() {
  const translator = useT();
  const { t, locale } = translator;
  const devices = useDevices();
  const enroll = useEnrollDevice();
  const revoke = useRevokeDevice();
  const [name, setName] = useState('');

  function onEnroll(event: FormEvent) {
    event.preventDefault();
    enroll.mutate(name, { onSuccess: () => setName('') });
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale);
  const active = (devices.data ?? []).filter((d) => d.revokedAt === null);
  const revoked = (devices.data ?? []).filter((d) => d.revokedAt !== null);

  return (
    <section>
      <h2 className="mb-1.5 text-2xl">{t('devices.title')}</h2>
      <p className="text-ink-soft mb-5 text-sm">{t('devices.body')}</p>

      {devices.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
      {devices.isError ? (
        <LoadError className="mb-5" onRetry={() => void devices.refetch()} />
      ) : null}

      {active.length > 0 ? (
        <ul className="divide-line border-line bg-surface-raised divide-y border">
          {active.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{device.name}</p>
                <p className="text-ink-soft mt-0.5 text-sm">
                  {t('devices.enrolled', { date: day(device.enrolledAt) })}
                  {' · '}
                  {device.lastSeenAt
                    ? t('devices.lastUsed', { date: day(device.lastSeenAt) })
                    : t('devices.neverUsed')}
                </p>
              </div>
              <RevokeButton
                onRevoke={() => revoke.mutate(device.id)}
                pending={revoke.isPending}
                name={device.name}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {devices.isSuccess && active.length === 0 ? (
        <p className="text-ink-soft border-line border border-dashed p-6 text-center">
          {t('devices.empty')}
        </p>
      ) : null}

      <form onSubmit={onEnroll} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="deviceName">
            {t('devices.enrolLabel')}
          </label>
          <input
            id="deviceName"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('devices.placeholder')}
            required
          />
        </div>
        <button type="submit" className="btn-quiet" disabled={enroll.isPending}>
          {enroll.isPending ? t('devices.enrolling') : t('devices.enrol')}
        </button>
      </form>

      {enroll.isSuccess ? (
        <p className="text-ink-soft mt-3 text-sm">{t('devices.enrolledOk')}</p>
      ) : null}
      {enroll.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, enroll.error)}
        </p>
      ) : null}

      {revoked.length > 0 ? (
        <>
          <h3 className="eyebrow mt-8 mb-3">{t('devices.revokedTitle')}</h3>
          <ul className="divide-line border-line bg-surface-raised divide-y border">
            {revoked.map((device) => (
              <li key={device.id} className="text-ink-soft p-4 text-sm">
                {device.name} ·{' '}
                {device.revokedAt ? t('devices.revokedOn', { date: day(device.revokedAt) }) : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function RevokeButton({
  onRevoke,
  pending,
  name,
}: {
  onRevoke: () => void;
  pending: boolean;
  name: string;
}) {
  const { t } = useT();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" className="btn-small" onClick={() => setConfirming(true)}>
        {t('devices.revoke')}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn-small border-danger text-danger"
      onClick={onRevoke}
      disabled={pending}
      title={t('devices.revokeTitle', { name })}
    >
      {t('devices.reallyRevoke')}
    </button>
  );
}
