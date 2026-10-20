import type { ReactNode } from 'react';
import { LANGUAGES, type Language } from '@mise/contracts';
import { Plate } from '../components/Plate.js';
import { LANGUAGE_NAMES, useT, type MessageKey } from '../i18n/index.js';
import { LanguageButton, PageHeading, StepIndex } from './SetupFrame.js';

/**
 * Page zero of setup: the first thing anyone sees on a new server.
 *
 * It says what Mise is, what setup will ask for and that nothing leaves this
 * server. It is drawn on the same frame as the six steps, so pressing the
 * button turns a page rather than opening a different app.
 */

const HAVE_READY: MessageKey[] = ['welcome.r1', 'welcome.r2', 'welcome.r3', 'welcome.r4'];

/** Headline and the three things Mise does. */
export function WelcomePage() {
  const { t } = useT();
  return (
    <>
      <PageHeading eyebrow={t('welcome.eyebrow')} title={t('welcome.headline')}>
        {t('welcome.lead1')} <span className="text-ink">{t('welcome.lead2')}</span>
      </PageHeading>

      <ul className="page-late mt-5 flex flex-col gap-3.5 sm:mt-[18px] xl:mt-6 xl:gap-[18px]">
        <Feature icon={<SpecIcon />} title={t('welcome.f1t')} body={t('welcome.f1b')} />
        <Feature icon={<ListsIcon />} title={t('welcome.f2t')} body={t('welcome.f2b')} />
        <Feature icon={<TabletIcon />} title={t('welcome.f3t')} body={t('welcome.f3b')} />
      </ul>
    </>
  );
}

/** The plate beside the welcome page, and on a phone the language choice under it. */
export function WelcomeAside({
  language,
  onLanguage,
}: {
  language: Language;
  onLanguage: (next: Language) => void;
}) {
  const { t } = useT();
  return (
    <>
      <Plate className="bg-surface-raised flex flex-col gap-[18px] px-[18px] py-5 sm:gap-[22px] sm:px-6 sm:pt-[26px] sm:pb-6 xl:gap-[26px] xl:px-8 xl:pt-[34px] xl:pb-[30px]">
        <StepIndex position={0} />
        <div>
          <h2 className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
            {t('welcome.readyLabel')}
          </h2>
          <ul className="mt-2.5 flex flex-col gap-2 xl:mt-3 xl:gap-[9px]">
            {HAVE_READY.map((item) => (
              <li
                key={item}
                className="grid grid-cols-[13px_minmax(0,1fr)] items-start gap-2.5 xl:gap-3"
              >
                <span
                  aria-hidden
                  className="border-accent mt-1.5 block h-[7px] w-[7px] border xl:mt-[7px]"
                />
                <span className="text-ink text-sm leading-[1.45] xl:text-[15px]">{t(item)}</span>
              </li>
            ))}
          </ul>
          <p className="border-line text-ink-soft mt-3 border-t pt-3 text-[13px] leading-[1.45] text-pretty xl:mt-4 xl:pt-3.5 xl:text-sm xl:leading-normal">
            {t('welcome.changeNote')}
          </p>
        </div>
      </Plate>

      {/* Phone only: the top bar has no room for the language buttons. */}
      <div className="sm:hidden">
        <h2 className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase">
          {t('kitchen.language')}
        </h2>
        <div className="bg-rule mt-2.5 grid grid-cols-3 gap-px p-px">
          {LANGUAGES.map((code) => (
            <LanguageButton
              key={code}
              code={code}
              label={LANGUAGE_NAMES[code]}
              selected={code === language}
              onLanguage={onLanguage}
              className="h-12 text-base tracking-[0.08em]"
            />
          ))}
          <span className="bg-surface" />
        </div>
      </div>
      <SelfHostNote className="lg:hidden" />
    </>
  );
}

export function SelfHostNote({ className = '' }: { className?: string }) {
  const { t } = useT();
  return (
    <div
      className={`grid max-w-[50ch] grid-cols-[18px_minmax(0,1fr)] items-start gap-2.5 xl:grid-cols-[20px_minmax(0,1fr)] xl:gap-3 ${className}`}
    >
      <svg
        aria-hidden
        className="text-ink-faint mt-0.5"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.5" y="4" width="19" height="7" />
        <rect x="2.5" y="13" width="19" height="7" />
        <path d="M6 7.5h.01M6 16.5h.01" />
      </svg>
      <p className="text-ink-soft text-[13px] leading-[1.45] text-pretty xl:text-sm xl:leading-normal">
        {t('welcome.selfHost')}
      </p>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[26px_minmax(0,1fr)] sm:gap-3.5 xl:grid-cols-[28px_minmax(0,1fr)] xl:gap-4">
      <span className="text-brand">{icon}</span>
      <div>
        <h2 className="text-ink font-display text-[17px] font-semibold tracking-[0.08em] uppercase sm:text-lg xl:text-[19px]">
          {title}
        </h2>
        <p className="text-ink-soft mt-0.5 max-w-[44ch] text-sm leading-[1.45] text-pretty sm:mt-[3px] sm:text-[15px] xl:mt-1 xl:leading-normal">
          {body}
        </p>
      </div>
    </li>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      className="h-[22px] w-[22px] sm:h-6 sm:w-6 xl:h-[26px] xl:w-[26px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A spec sheet with a scale arrow beside it. */
function SpecIcon() {
  return (
    <Icon>
      <rect x="2.5" y="2.5" width="13" height="19" />
      <path d="M5.5 7h7M5.5 11h7M5.5 15h4.5" />
      <path d="M20 8v8m0-8-1.8 1.8M20 8l1.8 1.8M20 16l-1.8-1.8M20 16l1.8-1.8" />
    </Icon>
  );
}

/** Three station columns, each with a tick. */
function ListsIcon() {
  return (
    <Icon>
      <rect x="2" y="4" width="20" height="16" />
      <path d="M8.7 4v16M15.3 4v16" />
      <path d="m3.6 9.2 1.3 1.3 2-2M10.3 9.2l1.3 1.3 2-2M17 9.2l1.3 1.3 2-2" />
    </Icon>
  );
}

/** A tablet with a ticked line. */
function TabletIcon() {
  return (
    <Icon>
      <rect x="4.5" y="2" width="15" height="20" />
      <path d="M8 6.5h8M8 10h8" />
      <path d="m8.4 15.6 1.6 1.6 3.2-3.2" />
    </Icon>
  );
}
