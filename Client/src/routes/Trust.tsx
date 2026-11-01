import { useState, type ReactNode } from 'react';
import { httpsAddress, useTrustInfo } from '../api/connection.js';
import { BASE_URL } from '../api/client.js';
import { Logo } from '../components/Logo.js';
import { Plate } from '../components/Plate.js';
import { useT, type MessageKey } from '../i18n/index.js';

/**
 * Trusting the kitchen certificate, on the tablet itself, before anyone signs
 * in. Download it, follow the steps for this kind of device, then check: the
 * check opens this same page over HTTPS, and a tablet that trusts the
 * certificate simply loads it and is told so. One that doesn't gets the
 * browser's own warning, which says the same thing more loudly.
 */

type System = 'ios' | 'android' | 'windows' | 'mac' | 'other';

const SYSTEMS: System[] = ['ios', 'android', 'windows', 'mac', 'other'];

const STEPS: Record<System, MessageKey[]> = {
  ios: ['trust.ios1', 'trust.ios2', 'trust.ios3'],
  android: ['trust.android1', 'trust.android2'],
  windows: ['trust.windows1', 'trust.windows2'],
  mac: ['trust.mac1', 'trust.mac2'],
  other: ['trust.other1'],
};

function thisSystem(): System {
  const ua = navigator.userAgent;
  // iPads say they're Macs, but Macs have no touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Macintosh/.test(ua)) return 'mac';
  return 'other';
}

export function Trust() {
  const { t } = useT();
  const info = useTrustInfo();
  const [system, setSystem] = useState<System>(thisSystem);
  const secure = window.location.protocol === 'https:';

  const address = info.data ? httpsAddress(info.data.names, info.data.port) : '';

  return (
    <div className="grid-paper flex min-h-dvh flex-col">
      <header className="bg-surface-raised border-rule border-b">
        <div className="flex h-[60px] items-center gap-3.5 px-5 sm:h-[72px] sm:px-10">
          <Logo size={30} wordmarkClassName="text-[24px] sm:text-[27px]" />
        </div>
      </header>

      <main className="page-enter-forward mx-auto w-full max-w-[760px] flex-1 px-5 py-10 sm:px-10">
        <p className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase">
          {t('trust.eyebrow')}
        </p>
        <h1 className="mt-3 text-[38px] leading-[1.05] sm:text-[48px]">{t('trust.title')}</h1>
        <span aria-hidden className="bg-brand mt-4 block h-0.5 w-14" />

        {info.isPending ? <p className="text-ink-soft mt-6">{t('common.loading')}</p> : null}

        {info.data && !info.data.enabled ? (
          <p className="text-ink-soft mt-6 text-lg">{t('trust.notOn')}</p>
        ) : null}

        {info.data?.enabled && secure ? (
          <Plate className="bg-surface-raised mt-8 flex flex-col gap-4 p-6">
            <p className="font-display text-accent text-2xl font-semibold tracking-[0.06em] uppercase">
              ✓ {t('trust.trusted')}
            </p>
            <p className="text-ink-soft">{t('trust.trustedBody')}</p>
            <a href="/" className="btn-primary self-start">
              {t('trust.openMise')}
            </a>
          </Plate>
        ) : null}

        {info.data?.enabled && !secure ? (
          <>
            <p className="text-ink-soft mt-4 text-lg text-pretty">{t('trust.body')}</p>

            <div role="tablist" className="border-line mt-8 flex overflow-x-auto border-b">
              {SYSTEMS.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={system === entry}
                  onClick={() => setSystem(entry)}
                  className={`font-display -mb-px shrink-0 border-b-4 px-4 py-2.5 text-base font-semibold tracking-[0.1em] uppercase ${
                    system === entry ? 'border-accent text-ink' : 'text-ink-soft border-transparent'
                  }`}
                >
                  {t(`trust.system.${entry}` as MessageKey)}
                </button>
              ))}
            </div>

            <ol className="mt-6 flex flex-col gap-5">
              <Step n={1}>
                <p>{t(system === 'ios' ? 'trust.downloadIos' : 'trust.download')}</p>
                <a
                  href={`${BASE_URL}/connection/kitchen-certificate.crt`}
                  className="btn-primary mt-3 inline-flex"
                  download="mise-kitchen.crt"
                >
                  {t('trust.downloadButton')}
                </a>
              </Step>
              {STEPS[system].map((key, i) => (
                <Step key={key} n={i + 2}>
                  <p>{t(key)}</p>
                </Step>
              ))}
              <Step n={STEPS[system].length + 2}>
                <p>{t('trust.check')}</p>
                <a href={`${address}/trust`} className="btn-quiet mt-3 inline-flex">
                  {t('trust.checkButton')}
                </a>
              </Step>
            </ol>

            {info.data.fingerprint ? (
              <details className="text-ink-faint mt-10 text-sm">
                <summary className="cursor-pointer">{t('trust.fingerprint')}</summary>
                <p className="mt-2 font-mono text-xs break-all">{info.data.fingerprint}</p>
              </details>
            ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="font-display text-accent w-6 shrink-0 text-2xl font-semibold">{n}</span>
      <div className="min-w-0 flex-1 text-[17px]">{children}</div>
    </li>
  );
}
