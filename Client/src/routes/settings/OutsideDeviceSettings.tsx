import { useState, type FormEvent } from 'react';
import type { RemoteDevice } from '@mise/contracts';
import {
  useApproveRemoteDevice,
  useRemoteDevices,
  useRemoveRemoteDevice,
} from '../../api/access.js';
import { LoadError } from '../../components/LoadError.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * Phones and laptops outside the kitchen's network.
 *
 * From outside, Mise answers nothing but its request page until a device is
 * approved here. A request shows the code the person asking sees on their
 * screen: check it with them before approving, so the right device gets in.
 * Approving from outside asks for your password again.
 */
export function OutsideDeviceSettings() {
  const { t } = useT();
  const remote = useRemoteDevices();
  const devices = remote.data?.devices ?? [];
  const waiting = devices.filter((d) => d.status === 'pending');
  const approved = devices.filter((d) => d.status === 'approved');

  return (
    <section className="border-line mt-12 border-t pt-8">
      <h2 className="mb-1.5 text-2xl">{t('outside.title')}</h2>
      <p className="text-ink-soft mb-5 max-w-[70ch] text-sm">{t('outside.body')}</p>

      {remote.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
      {remote.isError ? <LoadError className="mb-5" onRetry={() => void remote.refetch()} /> : null}

      {waiting.length > 0 ? (
        <>
          <h3 className="eyebrow mb-3">{t('outside.waiting')}</h3>
          <ul className="border-accent bg-surface-raised divide-line mb-8 divide-y border-2">
            {waiting.map((device) => (
              <WaitingDevice key={device.id} device={device} inside={remote.data!.inside} />
            ))}
          </ul>
        </>
      ) : null}

      {approved.length > 0 ? (
        <>
          <h3 className="eyebrow mb-3">{t('outside.approved')}</h3>
          <ul className="divide-line border-line bg-surface-raised divide-y border">
            {approved.map((device) => (
              <ApprovedDevice key={device.id} device={device} />
            ))}
          </ul>
        </>
      ) : null}

      {remote.isSuccess && devices.length === 0 ? (
        <p className="text-ink-soft border-line border border-dashed p-6 text-center">
          {t('outside.empty')}
        </p>
      ) : null}
    </section>
  );
}

function when(locale: string, iso: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function WaitingDevice({ device, inside }: { device: RemoteDevice; inside: boolean }) {
  const translator = useT();
  const { t, locale } = translator;
  const approve = useApproveRemoteDevice();
  const remove = useRemoveRemoteDevice();
  const [askingPassword, setAskingPassword] = useState(false);
  const [password, setPassword] = useState('');

  function onApprove(event?: FormEvent) {
    event?.preventDefault();
    if (!inside && !askingPassword) {
      setAskingPassword(true);
      return;
    }
    approve.mutate({ id: device.id, password: inside ? undefined : password });
  }

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{device.name}</p>
          <p className="text-ink-soft mt-0.5 text-sm">
            {[device.browser, device.address, when(locale, device.requestedAt)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="text-right">
          <p className="text-ink-faint text-[11px] tracking-[0.12em] uppercase">
            {t('outside.code')}
          </p>
          <p className="font-display text-[26px] leading-none font-semibold tracking-[0.12em]">
            {device.code}
          </p>
        </div>
      </div>
      <p className="text-ink-soft text-sm">{t('outside.checkCode')}</p>

      {askingPassword ? (
        <form onSubmit={onApprove} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor={`password-${device.id}`}>
              {t('outside.passwordLabel')}
            </label>
            <input
              id={`password-${device.id}`}
              type="password"
              className="field"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn-primary" disabled={approve.isPending || !password}>
            {t('outside.approve')}
          </button>
          <button type="button" className="btn-quiet" onClick={() => setAskingPassword(false)}>
            {t('common.cancel')}
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary min-h-11"
            onClick={() => onApprove()}
            disabled={approve.isPending}
          >
            {t('outside.approve')}
          </button>
          <button
            type="button"
            className="btn-quiet min-h-11"
            onClick={() => remove.mutate(device.id)}
            disabled={remove.isPending}
          >
            {t('outside.deny')}
          </button>
        </div>
      )}
      {!inside && askingPassword ? (
        <p className="text-ink-faint text-sm">{t('outside.passwordWhy')}</p>
      ) : null}
      {approve.error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(translator, approve.error)}
        </p>
      ) : null}
    </li>
  );
}

function ApprovedDevice({ device }: { device: RemoteDevice }) {
  const { t, locale } = useT();
  const remove = useRemoveRemoteDevice();
  const [confirming, setConfirming] = useState(false);
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale);

  const approvedLine = device.approvedAt
    ? device.approvedBy
      ? device.approvedFrom
        ? t('outside.approvedByFrom', {
            name: device.approvedBy,
            device: device.approvedFrom,
            date: day(device.approvedAt),
          })
        : t('outside.approvedBy', { name: device.approvedBy, date: day(device.approvedAt) })
      : t('outside.approvedOn', { date: day(device.approvedAt) })
    : null;

  return (
    <li className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {device.name}
          {device.thisDevice ? (
            <span className="tag tag-accent ml-2 px-1.5 py-0 text-[11px]">
              {t('outside.thisDevice')}
            </span>
          ) : null}
        </p>
        <p className="text-ink-soft mt-0.5 text-sm">
          {[
            device.browser,
            approvedLine,
            device.lastSeenAt ? t('devices.lastUsed', { date: day(device.lastSeenAt) }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {confirming ? (
        <button
          type="button"
          className="btn-small border-danger text-danger"
          onClick={() => remove.mutate(device.id)}
          disabled={remove.isPending}
          title={device.thisDevice ? t('outside.revokeSelf') : undefined}
        >
          {device.thisDevice ? t('outside.reallyRevokeSelf') : t('devices.reallyRevoke')}
        </button>
      ) : (
        <button type="button" className="btn-small" onClick={() => setConfirming(true)}>
          {t('devices.revoke')}
        </button>
      )}
    </li>
  );
}
