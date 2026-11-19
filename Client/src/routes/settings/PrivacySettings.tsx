import type { ReactNode } from 'react';
import type { PrivacySummary } from '@mise/contracts';
import { usePrivacySummary } from '../../api/privacy.js';
import { useT, type Translator } from '../../i18n/index.js';

/**
 * What Mise keeps about people, for how long, and where it sends anything.
 *
 * The kitchen answers to its staff for their data, so this is written for the
 * chef who has to answer a cook asking "what do you have on me?". The numbers
 * are this server's own, not the defaults.
 */
export function PrivacySettings() {
  const translator = useT();
  const { t } = translator;
  const summary = usePrivacySummary();

  if (summary.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (summary.isError && summary.data === undefined)
    return <p className="text-danger">{t('privacy.loadError')}</p>;
  const data = summary.data;

  return (
    <section className="flex max-w-2xl flex-col gap-10">
      <div>
        <h2 className="mb-3 text-2xl">{t('privacy.title')}</h2>
        <p>{t('privacy.intro')}</p>
        <p className="text-ink-soft mt-2">{t('privacy.staffTools')}</p>
      </div>

      <Part title={t('privacy.keptTitle')}>
        <Item text={t('privacy.keptNames')} />
        <Item text={t('privacy.keptSecrets')} />
        <Item text={t('privacy.keptLines')} detail={linesKept(translator, data)} />
        <Item text={t('privacy.keptNote')} />
        <Item text={t('privacy.keptRecipes')} />
        <Item text={t('privacy.keptAllergenChanges')} />
        <Item
          text={t('privacy.keptSessions')}
          detail={t('privacy.keptSessionsHow', {
            days: data.passwordSessionDays,
            hours: data.pinSessionHours,
          })}
        />
        <Item text={t('privacy.keptTablets')} />
        <Item
          text={t('privacy.keptOutside')}
          detail={t('privacy.keptOutsideHow', {
            days: data.outsideDeviceIdleDays,
            hours: data.outsideRequestHours,
          })}
        />
        <Item text={t('privacy.keptOffline', { days: data.offlineAnswersDays })} />
        <Item text={t('privacy.keptLockout')} />
      </Part>

      <Part title={t('privacy.backupsTitle')}>
        <Item text={t('privacy.backupsWhat')} />
        <Item
          text={translator.plural('privacy.backupsLocal', data.backups.keepLocal)}
          detail={t('privacy.backupsNights')}
        />
        {data.backups.webdav || data.backups.onedrive ? (
          <Item text={translator.plural('privacy.backupsRemote', data.backups.keepRemote)} />
        ) : (
          <Item text={t('privacy.backupsOnlyHere')} />
        )}
        <Item text={t('privacy.backupsLeftOut')} />
      </Part>

      <Part title={t('privacy.sentTitle')}>
        <Item
          text={t('privacy.sentGithub')}
          detail={data.updateCheck ? t('privacy.sentGithubOn') : t('privacy.sentOff')}
        />
        <Item
          text={t('privacy.sentLetsEncrypt')}
          detail={data.domainHttps ? t('privacy.sentOn') : t('privacy.sentOff')}
        />
        <Item
          text={t('privacy.sentOnedrive')}
          detail={data.backups.onedrive ? t('privacy.sentOn') : t('privacy.sentOff')}
        />
        <Item
          text={t('privacy.sentWebdav')}
          detail={data.backups.webdav ? t('privacy.sentOn') : t('privacy.sentOff')}
        />
        <Item text={t('privacy.sentNothingElse')} strong />
      </Part>
    </section>
  );
}

function linesKept(translator: Translator, data: PrivacySummary): string {
  const { t, plural } = translator;
  if (data.tickedRetention === 'delete') {
    return plural('privacy.linesDeleted', data.runningListHours);
  }
  if (data.tickedKeepDays === null) return t('privacy.linesKeptForGood');
  return plural('privacy.linesKeptDays', data.tickedKeepDays);
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="eyebrow mb-3">{title}</h3>
      <ul className="divide-line border-line bg-surface-raised divide-y border">{children}</ul>
    </div>
  );
}

function Item({ text, detail, strong }: { text: string; detail?: string; strong?: boolean }) {
  return (
    <li className="px-4 py-3">
      <p className={strong ? 'font-medium' : undefined}>{text}</p>
      {detail ? <p className="text-ink-soft mt-0.5 text-sm">{detail}</p> : null}
    </li>
  );
}
