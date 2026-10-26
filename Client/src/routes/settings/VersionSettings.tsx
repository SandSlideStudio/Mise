import type { VersionInfo } from '@mise/contracts';
import { useSetVersionCheck, useVersion } from '../../api/version.js';
import { useCurrentUser } from '../../api/session.js';
import { errorMessage, useT } from '../../i18n/index.js';

const INSTALL_COMMAND =
  'curl -fsSL https://github.com/SandSlideStudio/Mise/releases/latest/download/install.sh | sh';
const DOCKER_COMMAND = 'docker compose pull && docker compose up -d';

/**
 * Which Mise this is. An administrator also sees whether a newer one is out,
 * and how to install it on each kind of server: Mise can't update itself from
 * inside its own container, and shouldn't be given the power to.
 */
export function VersionSettings() {
  const translator = useT();
  const { t } = translator;
  const { data: user } = useCurrentUser();
  const version = useVersion();
  const setCheck = useSetVersionCheck();

  if (!version.data || !user) return null;
  const info = version.data;
  const isAdmin = user.role === 'admin';

  return (
    <section className="border-rule mt-10 border-t pt-8">
      <h2 className="mb-2 text-2xl">{t('version.title')}</h2>
      <p className="text-lg">{t('version.running', { version: info.current })}</p>

      {isAdmin ? (
        <div className="mt-3 flex max-w-2xl flex-col gap-5">
          <Status info={info} />

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="accent-accent mt-1 h-5 w-5 shrink-0"
              checked={info.checkEnabled}
              disabled={setCheck.isPending}
              onChange={(e) => setCheck.mutate(e.target.checked)}
            />
            <span>
              <span className="font-medium">{t('version.checkLabel')}</span>
              <span className="text-ink-soft block text-sm">{t('version.checkHint')}</span>
            </span>
          </label>
          {setCheck.error ? (
            <p role="alert" className="text-danger text-sm">
              {errorMessage(translator, setCheck.error)}
            </p>
          ) : null}

          {info.newer && info.latest ? (
            <HowToUpdate current={info.current} latest={info.latest} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Status({ info }: { info: VersionInfo }) {
  const { t } = useT();
  if (!info.checkEnabled) return null;
  if (info.newer && info.latest) {
    return (
      <div className="bg-accent-wash border-accent border-l-[6px] px-5 py-4">
        <p className="text-lg font-semibold">{t('version.newer', { version: info.latest })}</p>
        {info.releaseUrl ? (
          <a
            className="text-accent underline underline-offset-4"
            href={info.releaseUrl}
            target="_blank"
            rel="noreferrer"
          >
            {t('version.whatChanged')}
          </a>
        ) : null}
      </div>
    );
  }
  if (info.checkFailed) return <p className="text-ink-soft">{t('version.checkFailed')}</p>;
  if (info.latest) return <p className="text-ink-soft">{t('version.upToDate')}</p>;
  return <p className="text-ink-soft">{t('version.notChecked')}</p>;
}

function HowToUpdate({ current, latest }: { current: string; latest: string }) {
  const { t } = useT();
  const major = latest.split('.')[0]!;
  const newMajor = major !== current.split('.')[0];

  return (
    <div>
      <h3 className="mb-3 text-xl">{t('version.howTitle')}</h3>
      <p className="text-ink-soft mb-4 text-sm">{t('version.backupFirst')}</p>
      {newMajor ? (
        <p className="mb-4 font-medium">{t('version.major', { version: latest, major })}</p>
      ) : null}
      <dl className="flex flex-col gap-4">
        <div>
          <dt className="font-semibold">{t('version.howTrueNas')}</dt>
          <dd className="text-ink-soft">{t('version.howTrueNasSteps')}</dd>
        </div>
        <div>
          <dt className="font-semibold">{t('version.howInstaller')}</dt>
          <dd className="text-ink-soft">{t('version.howInstallerSteps')}</dd>
          <dd>
            <Command text={INSTALL_COMMAND} />
          </dd>
        </div>
        <div>
          <dt className="font-semibold">{t('version.howDocker')}</dt>
          <dd className="text-ink-soft">{t('version.howDockerSteps')}</dd>
          <dd>
            <Command text={DOCKER_COMMAND} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Command({ text }: { text: string }) {
  return (
    <code className="bg-surface-sunk border-line mt-1.5 block overflow-x-auto border px-3 py-2 font-mono text-sm whitespace-pre">
      {text}
    </code>
  );
}
