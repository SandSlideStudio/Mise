import { useEffect, useState, type ReactNode } from 'react';
import { LANGUAGES, type Language } from '@mise/contracts';
import { Logo } from '../components/Logo.js';
import { LANGUAGE_NAMES, useT, type MessageKey } from '../i18n/index.js';

/**
 * The paper every setup page is written on.
 *
 * Signing a contract of several pages: the table, the letterhead and the page
 * count stay put, and only the page in front of you changes. So the grid, the
 * top bar with its language buttons, the progress bar, the index of steps and
 * the buttons are drawn once, and only the text in the middle turns over.
 */

export const SETUP_STEPS: { label: MessageKey; optional?: boolean }[] = [
  { label: 'setup.stepKitchen' },
  { label: 'setup.stepYou' },
  { label: 'setup.stepBrigade' },
  { label: 'setup.stepRecipes', optional: true },
  { label: 'setup.stepSettings' },
  { label: 'setup.stepCheck' },
];

export type TurnDirection = 'forward' | 'back';

/** How long the old page takes to leave before the new one arrives. */
const LEAVE_MS = 180;

/**
 * Keep the old page on screen just long enough to turn it.
 *
 * Returns the page to draw, which lags the requested one by the length of the
 * leaving animation, and the class that animates it. Anyone who asked for less
 * motion gets the new page straight away.
 */
export function usePageTurn<T>(page: T, direction: TurnDirection) {
  const [shown, setShown] = useState(page);

  useEffect(() => {
    if (page === shown) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(
      () => {
        setShown(page);
        window.scrollTo({ top: 0 });
      },
      still ? 0 : LEAVE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [page, shown]);

  // Leaving is worked out, not stored: the old page must get its leaving class
  // in the very render that asks for a new one. A flag set afterwards would
  // let the old page replay its arrival for a frame whenever direction flips.
  const leaving = page !== shown;
  return {
    shown,
    className: leaving ? `page-leave-${direction}` : `page-enter-${direction}`,
  };
}

export function SetupFrame({
  position,
  language,
  onLanguage,
  onSubmit,
  turnKey,
  turnClassName,
  children,
  footer,
  aside,
  closing = false,
}: {
  /** 0 is the welcome page, 1 to 6 are the steps, 7 is signed and done. */
  position: number;
  language: Language;
  onLanguage: (next: Language) => void;
  onSubmit: () => void;
  turnKey: string;
  turnClassName: string;
  children: ReactNode;
  footer: ReactNode;
  aside: ReactNode;
  /** Fades the whole frame away, on the way into the app. */
  closing?: boolean;
}) {
  const { t } = useT();
  const total = SETUP_STEPS.length;
  const label =
    position === 0
      ? t('welcome.step0')
      : position > total
        ? t('setup.readyLabel')
        : `${t('setup.stepOf', { current: position, total })} · ${t(SETUP_STEPS[position - 1]!.label)}`;

  return (
    <div className={`grid-paper flex min-h-dvh flex-col ${closing ? 'frame-leave' : ''}`}>
      <header className="bg-surface-raised border-rule sticky top-0 z-20 border-b">
        <div className="flex h-[60px] items-center justify-between gap-6 px-5 sm:h-[76px] sm:px-10 xl:h-[72px] xl:px-16">
          <div className="flex min-w-0 items-center gap-3.5">
            <Logo size={30} wordmarkClassName="text-[24px] sm:text-[27px]" />
            <span aria-hidden className="bg-rule hidden h-[22px] w-px xl:block" />
            <span className="text-ink-faint hidden truncate font-mono text-xs xl:block">
              {window.location.host}
            </span>
          </div>
          <span
            key={`short-${position}`}
            className="fade-swap text-accent font-display text-[11px] font-semibold tracking-[0.16em] uppercase sm:hidden"
          >
            {position === 0
              ? t('welcome.step0')
              : t('setup.stepShort', { current: Math.min(position, total), total })}
          </span>
          <div className="hidden items-center gap-3.5 sm:flex">
            <span className="text-ink-faint font-display hidden text-[11px] font-semibold tracking-[0.16em] uppercase xl:inline">
              {t('kitchen.language')}
            </span>
            <div className="bg-rule flex gap-px p-px">
              {LANGUAGES.map((code) => (
                <LanguageButton
                  key={code}
                  code={code}
                  label={code.toUpperCase()}
                  selected={code === language}
                  onLanguage={onLanguage}
                  className="h-12 min-w-16 px-3.5 text-[17px] tracking-[0.1em] xl:h-8 xl:min-w-[52px] xl:px-3 xl:text-sm"
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 sm:px-10 xl:px-16">
          <div
            role="progressbar"
            aria-label={t('setup.title')}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.min(position, total)}
            aria-valuetext={label}
            className="flex h-[3px] gap-0.5"
          >
            {SETUP_STEPS.map((step, i) => (
              <span key={step.label} className="bg-line relative flex-1 overflow-hidden">
                <span
                  className="bg-accent absolute inset-0 origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
                  style={{ transform: `scaleX(${i < position ? 1 : 0})` }}
                />
              </span>
            ))}
          </div>
          <p
            key={`label-${position}`}
            className="fade-swap text-accent font-display hidden pt-2 pb-2.5 text-[11px] font-semibold tracking-[0.16em] uppercase sm:block"
          >
            {label}
          </p>
          <div className="h-2.5 sm:hidden" />
        </div>
      </header>

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="mx-auto grid w-full max-w-[1440px] flex-1 content-start gap-8 px-5 pt-6 pb-32 sm:px-10 sm:pt-8 lg:grid-cols-[minmax(0,1fr)_388px] lg:gap-10 lg:pb-8 xl:grid-cols-[minmax(0,1fr)_520px] xl:gap-[72px] xl:px-16 xl:pt-9 xl:pb-11"
      >
        <section className="flex min-w-0 flex-col">
          <div key={turnKey} className={turnClassName}>
            {children}
          </div>
          <div className="hidden min-h-8 flex-1 lg:block" />
          {/* One set of buttons: pinned to the bottom on a phone, under the page on a tablet or desk. */}
          {footer ? (
            <div className="bg-surface-raised border-rule fixed inset-x-0 bottom-0 z-20 border-t px-5 pt-3.5 pb-[18px] sm:px-10 lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:pt-6">
              {footer}
            </div>
          ) : null}
        </section>

        <aside className="flex min-w-0 flex-col gap-6 lg:self-start">{aside}</aside>
      </form>
    </div>
  );
}

/** The signed page: a box and a tick draw themselves, then the app opens. */
export function ReadyPage({ kitchenName }: { kitchenName: string }) {
  const { t } = useT();
  return (
    <>
      <svg
        aria-hidden
        className="draw-tick text-accent h-20 w-20 xl:h-24 xl:w-24"
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <rect className="draw-box" x="2" y="2" width="44" height="44" pathLength={1} />
        <path className="draw-check" d="m13 25 7 7 15-16" pathLength={1} />
      </svg>
      <div role="status" className="page-late mt-7 xl:mt-9">
        <PageHeading
          eyebrow={t('setup.readyEyebrow')}
          title={t('setup.readyTitle', { kitchen: kitchenName })}
        >
          {t('setup.readyBody')}
        </PageHeading>
      </div>
    </>
  );
}

/** Eyebrow, headline, olive rule and lead: the top of every page. */
export function PageHeading({
  eyebrow,
  title,
  tag,
  children,
}: {
  eyebrow: string;
  title: string;
  tag?: string;
  children: ReactNode;
}) {
  return (
    <header>
      <p className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
        {eyebrow}
      </p>
      <h1 className="text-ink mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[38px] leading-[1.02] tracking-[-0.01em] text-pretty sm:mt-3 sm:text-[48px] sm:leading-none xl:mt-4 xl:text-[62px] xl:tracking-[-0.015em]">
        <span>{title}</span>
        {tag ? <span className="tag-accent text-xs tracking-[0.14em]">{tag}</span> : null}
      </h1>
      <span
        aria-hidden
        className="bg-brand mt-3.5 block h-0.5 w-12 sm:mt-4 sm:w-14 xl:mt-[22px] xl:w-16"
      />
      <p className="text-ink-soft mt-3.5 max-w-[52ch] text-base leading-normal text-pretty sm:mt-4 xl:mt-[22px] xl:text-[17px] xl:leading-[1.55]">
        {children}
      </p>
    </header>
  );
}

/** The six steps on a plate: ticked when done, marked where you are. */
export function StepIndex({
  position,
  onPick,
}: {
  position: number;
  /** Jump back to a finished step. */
  onPick?: (index: number) => void;
}) {
  const { t } = useT();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
          {t('welcome.stepsLabel')}
        </h2>
        <span className="text-ink-faint font-mono text-[11px]">{t('welcome.duration')}</span>
      </div>
      <ol className="border-rule mt-2.5 border-b xl:mt-3.5">
        {SETUP_STEPS.map((step, i) => {
          const number = i + 1;
          const done = position > 0 && number < position;
          const current = number === position;
          const row = `grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 py-2 text-left transition-[background-color,padding] duration-300 sm:grid-cols-[26px_minmax(0,1fr)_auto] sm:gap-3 sm:py-[9px] xl:grid-cols-[30px_minmax(0,1fr)_auto] xl:gap-3.5 xl:py-[11px] ${
            current ? 'bg-accent-wash pl-3 shadow-[inset_3px_0_0_var(--color-accent)]' : 'pl-0'
          }`;
          const content = (
            <>
              <span className="text-accent font-display text-sm font-semibold tabular-nums sm:text-[15px] xl:text-[17px]">
                {done ? <Tick /> : String(number).padStart(2, '0')}
              </span>
              <span
                className={`font-display text-lg font-semibold tracking-[0.03em] transition-colors duration-300 sm:text-[19px] xl:text-[21px] ${
                  done ? 'text-ink-soft' : 'text-ink'
                }`}
              >
                {t(step.label)}
              </span>
              {step.optional ? (
                <span className="tag-accent whitespace-nowrap">{t('setup.optional')}</span>
              ) : (
                <span />
              )}
            </>
          );
          return (
            <li
              key={step.label}
              aria-current={current ? 'step' : undefined}
              className={i === 0 ? 'border-rule border-t' : 'border-line border-t'}
            >
              {done && onPick ? (
                <button
                  type="button"
                  onClick={() => onPick(i)}
                  className={`${row} hover:bg-surface-sunk cursor-pointer`}
                >
                  {content}
                </button>
              ) : (
                <div className={row}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function LanguageButton({
  code,
  label,
  selected,
  onLanguage,
  className,
}: {
  code: Language;
  label: string;
  selected: boolean;
  onLanguage: (next: Language) => void;
  className: string;
}) {
  return (
    <button
      type="button"
      lang={code}
      aria-pressed={selected}
      aria-label={LANGUAGE_NAMES[code]}
      onClick={() => onLanguage(code)}
      className={`font-display font-semibold uppercase transition-colors ${className} ${
        selected
          ? 'bg-accent text-accent-ink'
          : 'bg-surface-raised text-ink-soft hover:bg-surface-sunk hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

/** The ochre button that moves the contract on a page. */
export function ForwardButton({
  children,
  disabled,
  autoFocus,
}: {
  children: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      autoFocus={autoFocus}
      className="btn-primary font-display flex h-14 min-w-0 flex-1 items-center justify-between gap-4 px-6 text-xl font-semibold tracking-[0.12em] uppercase sm:h-[60px] sm:text-[22px] lg:flex-none lg:px-8 xl:min-w-[340px] xl:gap-[22px] xl:text-[23px]"
    >
      <span className="truncate">{children}</span>
      <Arrow />
    </button>
  );
}

export function BackButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn-quiet font-display flex h-14 shrink-0 items-center gap-3 px-4 text-lg font-semibold tracking-[0.12em] uppercase sm:h-[60px] sm:px-6 sm:text-xl"
    >
      <Arrow back />
      <span className="hidden sm:inline">{children}</span>
      <span className="sr-only sm:hidden">{children}</span>
    </button>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden
      className={`h-[22px] w-[22px] shrink-0 ${back ? 'rotate-180' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  );
}

function Tick() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}
