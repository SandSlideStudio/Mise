import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { BackupDestination, BackupFile, BackupStatus, OnedriveStatus } from '@mise/contracts';
import { LoadError } from '../../components/LoadError.js';
import {
  backupDownloadUrl,
  useBackupStatus,
  useConfirmRecoveryKey,
  useConnectOnedrive,
  useDisconnectOnedrive,
  useRecoveryKey,
  useRunBackup,
  useTestBackupDestination,
  useUpdateBackups,
} from '../../api/backups.js';
import { useKitchen } from '../../api/kitchen.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * Nightly backups: when the last one worked, where they go, and the recovery
 * key that opens them. Administrators only; a backup holds everyone's sign-in.
 */
export function BackupSettings() {
  const translator = useT();
  const { t } = translator;
  const status = useBackupStatus();
  const run = useRunBackup();

  if (status.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (status.isError) return <LoadError onRetry={() => void status.refetch()} />;

  const data = status.data;
  const newest = data.files[0];
  const onlyHere = data.sendTo.length === 0;

  return (
    <section className="flex flex-col gap-10">
      {onlyHere ? <OnlyHere /> : null}
      <div>
        <h2 className="mb-1.5 text-2xl">{t('backups.title')}</h2>
        <p className="text-ink-soft mb-5 max-w-2xl text-sm">{t('backups.body')}</p>

        <div className="card flex flex-col gap-4">
          <p className="text-lg">
            {data.lastSuccessAt
              ? t('backups.lastGood', { time: moment(translator.locale, data.lastSuccessAt) })
              : t('backups.never')}
          </p>

          {data.lastError ? (
            <div role="alert" className="border-danger border-2 px-4 py-3">
              <p className="text-danger font-semibold">{t('backups.failed')}</p>
              <p className="text-danger">{t(`backups.reason.${data.lastError}`)}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? t('backups.running') : t('backups.now')}
            </button>
            {newest ? (
              <a className="btn-quiet" href={backupDownloadUrl(newest.name)} download>
                {t('backups.download')}
              </a>
            ) : null}
          </div>
          {run.error ? (
            <p role="alert" className="text-danger text-sm">
              {errorMessage(translator, run.error)}
            </p>
          ) : null}
        </div>
      </div>

      <RecoveryKey confirmed={data.keyConfirmed} />
      {/* Starts over when OneDrive connects, which changes where backups go. */}
      <Destination key={`${data.sendTo.join()}:${data.onedrive.account ?? ''}`} status={data} />
      <KeptFiles files={data.files} />
    </section>
  );
}

function moment(locale: string, iso: string): string {
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

function fileSize(locale: string, bytes: number): string {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  return bytes >= 1_000_000
    ? `${number(bytes / 1_000_000, 1)} MB`
    : `${number(Math.max(1, bytes / 1000), 0)} kB`;
}

function RecoveryKey({ confirmed }: { confirmed: boolean }) {
  const translator = useT();
  const { t } = translator;
  const [shown, setShown] = useState(false);
  const key = useRecoveryKey(shown);
  const confirm = useConfirmRecoveryKey();
  const kitchen = useKitchen();
  const visible = shown && key.data ? key.data.recoveryKey : null;

  // Printing shows only the sheet below, not the settings page around it.
  function print() {
    const root = document.documentElement;
    const done = () => {
      root.classList.remove('printing-key');
      window.removeEventListener('afterprint', done);
    };
    root.classList.add('printing-key');
    window.addEventListener('afterprint', done);
    window.print();
  }

  return (
    <div>
      <h3 className="mb-1.5 text-xl">{t('backups.keyTitle')}</h3>
      <p className="text-ink-soft mb-4 max-w-2xl text-sm">{t('backups.keyBody')}</p>

      <div className="card flex flex-col gap-4">
        {visible ? (
          <p className="font-mono text-xl tracking-wider break-all select-all sm:text-2xl">
            {visible}
          </p>
        ) : null}
        {shown && key.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
        {shown && key.isError ? <LoadError onRetry={() => void key.refetch()} /> : null}

        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-quiet" onClick={() => setShown(!shown)}>
            {shown ? t('backups.keyHide') : t('backups.keyShow')}
          </button>
          {visible ? (
            <button type="button" className="btn-quiet" onClick={print}>
              {t('backups.keyPrint')}
            </button>
          ) : null}
          {visible && !confirmed ? (
            <button
              type="button"
              className="btn-primary"
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {t('backups.keyConfirm')}
            </button>
          ) : null}
        </div>
        {confirmed ? <p className="text-ink-soft text-sm">{t('backups.keyConfirmed')}</p> : null}
      </div>

      {visible
        ? createPortal(
            <div className="print-key">
              <h1>{t('backups.keyPrintTitle', { kitchen: kitchen.data?.name ?? 'Mise' })}</h1>
              <p className="print-key-code">{visible}</p>
              <p>{t('backups.keyPrintBody')}</p>
              <p>{new Date().toLocaleDateString(translator.locale, { dateStyle: 'long' })}</p>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const LOCAL_KEEP = [3, 7, 14, 30];
const REMOTE_KEEP = [7, 14, 30, 60, 90];

/**
 * Backups kept only on the server go when the server goes. Said at the top of
 * the page until they also go somewhere else.
 */
function OnlyHere() {
  const { t } = useT();
  const toDestination = () =>
    document.getElementById('backup-destination')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div role="status" className="bg-accent-wash border-accent border-l-[6px] px-5 py-4">
      <p className="text-lg font-semibold">{t('backups.onlyHereTitle')}</p>
      <p className="text-ink-soft mt-1 max-w-2xl">{t('backups.onlyHereBody')}</p>
      <button type="button" className="btn-small mt-3" onClick={toDestination}>
        {t('backups.onlyHereAction')}
      </button>
    </div>
  );
}

function Destination({ status }: { status: BackupStatus }) {
  const translator = useT();
  const { t, plural } = translator;
  const update = useUpdateBackups();
  const test = useTestBackupDestination();

  const [sendTo, setSendTo] = useState<BackupDestination[]>(status.sendTo);
  const toWebdav = sendTo.includes('webdav');
  const toOnedrive = sendTo.includes('onedrive');
  const toggle = (place: BackupDestination) =>
    setSendTo((current) =>
      current.includes(place) ? current.filter((p) => p !== place) : [...current, place],
    );
  const [url, setUrl] = useState(status.webdavUrl ?? '');
  const [username, setUsername] = useState(status.webdavUsername ?? '');
  const [password, setPassword] = useState('');
  const [hour, setHour] = useState(status.hour);
  const [keepLocal, setKeepLocal] = useState(status.keepLocal);
  const [keepRemote, setKeepRemote] = useState(status.keepRemote);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate(
      {
        sendTo,
        webdavUrl: url.trim() || null,
        webdavUsername: username.trim() || null,
        ...(password ? { webdavPassword: password } : {}),
        hour,
        timeZone: zone,
        keepLocal,
        keepRemote,
      },
      { onSuccess: () => setPassword('') },
    );
  }

  function onTest() {
    test.mutate({
      webdavUrl: url.trim(),
      webdavUsername: username.trim() || null,
      ...(password ? { webdavPassword: password } : {}),
    });
  }

  const keepOptions = (values: number[], current: number) =>
    [...new Set([...values, current])].sort((a, b) => a - b);

  return (
    <div id="backup-destination" className="scroll-mt-6">
      <h3 className="mb-4 text-xl">{t('backups.whereTitle')}</h3>

      <form onSubmit={onSubmit} className="card flex max-w-2xl flex-col gap-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">{t('backups.whereTitle')}</legend>
          {/* Every backup is made here first, so this one can't be switched off. */}
          <Choice
            checked
            disabled
            onChange={() => {}}
            title={t('backups.whereLocal')}
            hint={t('backups.whereLocalHint')}
          />
          <Choice
            checked={toWebdav}
            onChange={() => toggle('webdav')}
            title={t('backups.whereWebdav')}
            hint={t('backups.whereWebdavHint')}
          />
          <Choice
            checked={toOnedrive}
            onChange={() => toggle('onedrive')}
            title={t('backups.whereOnedrive')}
            hint={t('backups.whereOnedriveHint')}
          />
        </fieldset>

        {toWebdav ? (
          <div className="border-line flex flex-col gap-4 border-l-4 pl-4">
            <div>
              <label className="label" htmlFor="webdavUrl">
                {t('backups.webdavUrl')}
              </label>
              <input
                id="webdavUrl"
                className="field"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://nas.local:5005/backups/mise"
                required
              />
              <p className="text-ink-soft mt-1.5 text-sm">{t('backups.webdavUrlHint')}</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="webdavUser">
                  {t('backups.webdavUser')}
                </label>
                <input
                  id="webdavUser"
                  className="field"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="webdavPassword">
                  {t('backups.webdavPassword')}
                </label>
                <input
                  id="webdavPassword"
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                {status.hasWebdavPassword ? (
                  <p className="text-ink-soft mt-1.5 text-sm">{t('backups.webdavPasswordKept')}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-quiet"
                disabled={test.isPending || !url.trim()}
                onClick={onTest}
              >
                {test.isPending ? t('backups.testing') : t('backups.test')}
              </button>
              {test.isSuccess ? (
                <p role="status" className="text-sm">
                  {t('backups.testOk')}
                </p>
              ) : null}
              {test.error ? (
                <p role="alert" className="text-danger text-sm">
                  {errorMessage(translator, test.error)}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {toOnedrive ? <OnedrivePanel onedrive={status.onedrive} /> : null}

        {sendTo.length > 0 ? (
          <div>
            <label className="label" htmlFor="keepRemote">
              {toWebdav && toOnedrive
                ? t('backups.keepBoth')
                : toOnedrive
                  ? t('backups.keepOnedrive')
                  : t('backups.keepRemote')}
            </label>
            <select
              id="keepRemote"
              className="field"
              value={keepRemote}
              onChange={(e) => setKeepRemote(Number(e.target.value))}
            >
              {keepOptions(REMOTE_KEEP, keepRemote).map((count) => (
                <option key={count} value={count}>
                  {plural('backups.copies', count)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="backupHour">
              {t('backups.when')}
            </label>
            <select
              id="backupHour"
              className="field"
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, value) => (
                <option key={value} value={value}>
                  {`${String(value).padStart(2, '0')}:00`}
                </option>
              ))}
            </select>
            <p className="text-ink-soft mt-1.5 text-sm">{t('backups.zone', { zone })}</p>
          </div>
          <div>
            <label className="label" htmlFor="keepLocal">
              {t('backups.keepLocal')}
            </label>
            <select
              id="keepLocal"
              className="field"
              value={keepLocal}
              onChange={(e) => setKeepLocal(Number(e.target.value))}
            >
              {keepOptions(LOCAL_KEEP, keepLocal).map((count) => (
                <option key={count} value={count}>
                  {plural('backups.copies', count)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {update.error ? (
          <p role="alert" className="text-danger text-sm">
            {errorMessage(translator, update.error)}
          </p>
        ) : null}
        {update.isSuccess ? <p className="text-ink-soft text-sm">{t('common.saved')}</p> : null}

        <div>
          <button
            type="submit"
            className="btn-primary"
            disabled={update.isPending || (toOnedrive && !status.onedrive.account)}
          >
            {update.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Connecting OneDrive: Microsoft hands out a short code, someone types it in
 * at Microsoft's page on any phone or computer, and this page notices.
 */
function OnedrivePanel({ onedrive }: { onedrive: OnedriveStatus }) {
  const translator = useT();
  const { t } = translator;
  const connect = useConnectOnedrive();
  const disconnect = useDisconnectOnedrive();

  if (onedrive.account) {
    return (
      <div className="border-line flex flex-wrap items-center gap-3 border-l-4 pl-4">
        <p className="flex-1">{t('backups.onedriveConnected', { account: onedrive.account })}</p>
        <button
          type="button"
          className="btn-small"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          {t('backups.onedriveDisconnect')}
        </button>
      </div>
    );
  }

  if (onedrive.connecting) {
    const { verificationUri, userCode } = onedrive.connecting;
    return (
      <div className="border-accent flex flex-col gap-3 border-l-4 pl-4">
        <p>{t('backups.onedriveCodeIntro')}</p>
        <a
          className="text-lg font-medium underline underline-offset-4"
          href={verificationUri}
          target="_blank"
          rel="noreferrer"
        >
          {verificationUri.replace(/^https?:\/\//, '')}
        </a>
        <p className="font-mono text-3xl tracking-[0.2em] select-all">{userCode}</p>
        <p role="status" className="text-ink-soft text-sm">
          {t('backups.onedriveWaiting')}
        </p>
        <p className="text-ink-soft text-sm">{t('backups.onedriveUnverified')}</p>
        <div>
          <button type="button" className="btn-small" onClick={() => disconnect.mutate()}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-line flex flex-col gap-3 border-l-4 pl-4">
      <div>
        <button
          type="button"
          className="btn-quiet"
          disabled={connect.isPending}
          onClick={() => connect.mutate()}
        >
          {connect.isPending ? t('backups.onedriveStarting') : t('backups.onedriveConnect')}
        </button>
      </div>
      {onedrive.connectError ? (
        <p role="alert" className="text-danger text-sm">
          {t(`backups.onedrive.${onedrive.connectError}`)}
        </p>
      ) : null}
      {connect.error ? (
        <p role="alert" className="text-danger text-sm">
          {errorMessage(translator, connect.error)}
        </p>
      ) : null}
    </div>
  );
}

function Choice({
  checked,
  disabled,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  title: string;
  hint: string;
}) {
  return (
    <label
      className={`flex gap-3 border-2 p-4 transition-colors ${
        disabled ? 'cursor-default' : 'cursor-pointer'
      } ${checked ? 'border-accent bg-accent-wash' : 'border-line'}`}
    >
      <input
        type="checkbox"
        className="accent-accent mt-1 size-4 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-ink-soft mt-0.5 block text-sm">{hint}</span>
      </span>
    </label>
  );
}

function KeptFiles({ files }: { files: BackupFile[] }) {
  const translator = useT();
  const { t, locale } = translator;

  return (
    <div>
      <h3 className="mb-4 text-xl">{t('backups.kept')}</h3>
      {files.length === 0 ? (
        <p className="text-ink-soft border-line border border-dashed p-6 text-center">
          {t('backups.keptEmpty')}
        </p>
      ) : (
        <ul className="divide-line border-line bg-surface-raised divide-y border">
          {files.map((file) => (
            <li key={file.name} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{moment(locale, file.createdAt)}</p>
                <p className="text-ink-soft mt-0.5 text-sm">{fileSize(locale, file.size)}</p>
              </div>
              <a className="btn-small" href={backupDownloadUrl(file.name)} download>
                {t('backups.download')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
