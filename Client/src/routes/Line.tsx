import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { RosterEntry } from '@mise/contracts';
import { usePinLogin, useRoster, useSetupStatus } from '../api/session.js';
import { LoadError } from '../components/LoadError.js';
import { Logo } from '../components/Logo.js';
import { Plate } from '../components/Plate.js';
import { errorMessage, roleName, useT } from '../i18n/index.js';

/**
 * Sign-in for the shared tablet on the pass.
 *
 * Always night: it sits on a dim pass all day waiting for someone. It speaks
 * the kitchen's language, since nobody has said who they are yet, and it keeps
 * the time in the corner because a tablet on a wall gets looked at for that.
 *
 * Names are the tap target, not a field: big cards that read from the far side
 * of the larder, each carrying the station so the right Marco taps the right
 * Marco. The PIN pad signs in the moment the last digit lands, the way a card
 * machine does, and shakes its head at a wrong one.
 */

const MIN_PIN = 4;
const MAX_PIN = 8;

/** Long enough to see the slots turn before the app opens. */
const WELCOME_MS = 650;

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function Line() {
  const { t } = useT();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const roster = useRoster(true);
  // Read from the latest list, so a PIN changed meanwhile is seen at its new length.
  const selected = roster.data?.find((person) => person.id === selectedId) ?? null;

  let body: ReactNode;
  if (roster.isPending) {
    body = (
      <Centered key="loading">
        <p className="text-ink-soft font-display text-2xl tracking-[0.12em] uppercase">
          {t('line.loading')}
        </p>
      </Centered>
    );
  } else if (roster.isError) {
    body = (
      <Centered key="error">
        <LoadError className="w-full max-w-xl" onRetry={() => void roster.refetch()} />
      </Centered>
    );
  } else if (roster.data === null) {
    // The endpoint answers with null when this is not an enrolled tablet.
    body = <NotEnrolled key="not-enrolled" />;
  } else if (selected) {
    body = <PinPad key={selected.id} person={selected} onCancel={() => setSelectedId(null)} />;
  } else {
    body = (
      <Roster
        key="roster"
        people={roster.data ?? []}
        onPick={(person) => setSelectedId(person.id)}
      />
    );
  }

  return (
    <div className="night grid-paper text-ink flex min-h-dvh flex-col">
      <TabletBar />
      {body}
    </div>
  );
}

function TabletBar() {
  const { locale } = useT();
  const status = useSetupStatus();
  const now = useNow();
  const kitchenName = status.data?.kitchenName;

  return (
    <header className="bg-surface-raised border-rule border-b">
      <div className="flex h-[68px] items-center gap-4 px-5 sm:h-[84px] sm:px-10">
        <Logo size={34} wordmarkClassName="text-[28px] sm:text-[30px]" />
        {kitchenName ? (
          <>
            <span aria-hidden className="bg-rule hidden h-7 w-px sm:block" />
            <span className="text-ink-soft font-display hidden truncate text-lg font-semibold tracking-[0.12em] uppercase sm:block">
              {kitchenName}
            </span>
          </>
        ) : null}
        <div className="ml-auto flex items-baseline gap-4">
          <span className="text-ink-faint font-display hidden text-base tracking-[0.12em] uppercase md:inline">
            {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' })}
          </span>
          <time
            dateTime={now.toISOString()}
            className="qty text-[30px] leading-none sm:text-[40px]"
          >
            {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
          </time>
        </div>
      </div>
    </header>
  );
}

/** The clock in the corner. A quarter-minute is close enough for a minute display. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Roster({
  people,
  onPick,
}: {
  people: RosterEntry[];
  onPick: (person: RosterEntry) => void;
}) {
  const { t } = useT();

  return (
    <main className="fade-swap flex flex-1 flex-col px-5 pt-7 pb-8 sm:px-10 sm:pt-10 sm:pb-10">
      <p className="text-brand font-display text-sm font-semibold tracking-[0.16em] uppercase sm:text-base">
        {t('line.eyebrow')}
      </p>
      <h1 className="mt-2 text-[52px] leading-none sm:text-[76px] xl:text-[88px]">
        {t('line.whoIsOn')}
      </h1>
      <span aria-hidden className="bg-brand mt-4 block h-0.5 w-16 sm:mt-5" />
      <p className="text-ink-soft mt-4 text-xl sm:text-[22px]">{t('line.tapNamePin')}</p>

      {people.length === 0 ? (
        <Plate className="bg-surface-raised mt-8 max-w-2xl p-8">
          <p className="text-ink-soft text-xl text-pretty">{t('line.nobodyHasPin')}</p>
        </Plate>
      ) : (
        <ul className="mt-8 grid auto-rows-[minmax(104px,1fr)] grid-cols-1 gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {people.map((person, i) => (
            <li key={person.id} className="stagger-in" style={{ '--i': i } as CSSProperties}>
              <button
                type="button"
                onClick={() => onPick(person)}
                className="group bg-surface-raised border-rule hover:border-ink-soft active:bg-surface-sunk flex h-full w-full items-center gap-4 border-2 px-5 py-4 text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] sm:gap-5 sm:px-6"
              >
                <Monogram name={person.displayName} />
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="font-display truncate text-[32px] leading-none font-semibold sm:text-[38px]">
                    {person.displayName}
                  </span>
                  <span className="text-brand truncate text-base tracking-[0.12em] uppercase sm:text-lg">
                    {person.stationName ?? roleName(t, person.role)}
                  </span>
                </span>
                <Arrow className="text-ink-faint group-hover:text-accent h-7 w-7 shrink-0 transition-colors duration-150" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="text-ink-faint mt-auto pt-8 text-lg sm:text-[19px]">
        {t('line.notOnList')}{' '}
        <Link to="/login" className="text-accent underline underline-offset-4">
          {t('line.signInEmail')}
        </Link>
      </p>
    </main>
  );
}

function NotEnrolled() {
  const { t } = useT();
  return (
    <Centered>
      <Plate className="bg-surface-raised flex w-full max-w-xl flex-col items-start gap-5 p-8 sm:p-10">
        <svg
          aria-hidden
          className="text-brand h-10 w-10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="4.5" y="2" width="15" height="20" />
          <path d="M9.5 11V9a2.5 2.5 0 0 1 5 0v2" />
          <rect x="8.5" y="11" width="7" height="5" />
        </svg>
        <h1 className="text-[40px] leading-none text-pretty sm:text-[52px]">
          {t('line.notEnrolledTitle')}
        </h1>
        <span aria-hidden className="bg-brand block h-0.5 w-14" />
        <p className="text-ink-soft text-xl text-pretty">{t('line.notEnrolledBody')}</p>
        <Link
          to="/login"
          className="btn-quiet font-display mt-2 flex h-16 items-center gap-4 border-2 px-6 text-xl font-semibold tracking-[0.1em] uppercase"
        >
          {t('line.signInPassword')}
          <Arrow className="h-6 w-6" />
        </Link>
      </Plate>
    </Centered>
  );
}

function PinPad({ person, onCancel }: { person: RosterEntry; onCancel: () => void }) {
  const translator = useT();
  const { t, plural } = translator;
  const navigate = useNavigate();
  const pinLogin = usePinLogin();
  const queryClient = useQueryClient();
  const [pin, setPin] = useState('');
  // Each miss remounts the slots, so a second wrong PIN shakes again.
  const [misses, setMisses] = useState(0);
  const [welcomed, setWelcomed] = useState(false);

  const length = person.pinLength;
  const slots = length ?? Math.max(MIN_PIN, pin.length);
  const busy = pinLogin.isPending || welcomed;

  function submit(value: string) {
    pinLogin.mutate(
      { userId: person.id, pin: value },
      {
        onSuccess: () => {
          setWelcomed(true);
          window.setTimeout(() => void navigate({ to: '/' }), WELCOME_MS);
        },
        onError: () => {
          setPin('');
          setMisses((count) => count + 1);
          // In case their PIN was changed since the list was loaded.
          void queryClient.invalidateQueries({ queryKey: ['roster'] });
        },
      },
    );
  }

  function press(digit: string) {
    if (busy || pin.length >= (length ?? MAX_PIN)) return;
    if (pinLogin.isError) pinLogin.reset();
    const next = pin + digit;
    setPin(next);
    // With the length known, the PIN goes the moment it is complete.
    if (next.length === (length ?? MAX_PIN)) submit(next);
  }

  function confirm() {
    if (!busy && length === null && pin.length >= MIN_PIN) submit(pin);
  }

  function back() {
    if (!busy) setPin((current) => current.slice(0, -1));
  }

  function clear() {
    if (!busy) setPin('');
  }

  // A tablet with a keyboard attached, or a chef testing at a desk.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') back();
      else if (event.key === 'Enter') confirm();
      else if (event.key === 'Escape' && !busy) onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const note = welcomed
    ? { text: t('line.welcome', { name: person.displayName }), tone: 'text-accent' }
    : pinLogin.error
      ? { text: errorMessage(translator, pinLogin.error), tone: 'text-danger' }
      : pinLogin.isPending
        ? { text: t('line.checking'), tone: 'text-brand' }
        : { text: t('line.enterPin'), tone: 'text-ink-faint' };

  const wrong = pinLogin.isError && pin.length === 0;

  return (
    <main className="fade-swap flex flex-1 flex-col md:flex-row">
      <section className="bg-surface-sunk border-rule flex flex-col border-b-2 px-6 py-6 sm:px-10 sm:py-8 md:w-[46%] md:max-w-[580px] md:shrink-0 md:border-r-2 md:border-b-0 md:px-12 md:py-12">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-ink-soft hover:text-ink font-display flex items-center gap-3 self-start text-lg font-semibold tracking-[0.12em] uppercase transition-colors disabled:opacity-50 sm:text-xl"
        >
          <Arrow className="h-6 w-6 rotate-180" />
          {t('line.notMe')}
        </button>

        <div className="mt-6 flex items-center gap-5 md:mt-12">
          <Monogram name={person.displayName} large />
          <div className="min-w-0">
            <p className="text-brand font-display text-base tracking-[0.16em] uppercase sm:text-lg">
              {t('line.signingIn')}
            </p>
            <h1 className="mt-1 truncate text-[44px] leading-none sm:text-[56px] md:text-[64px]">
              {person.displayName}
            </h1>
            <p className="text-ink-soft mt-2 truncate text-lg tracking-[0.1em] uppercase">
              {person.stationName ?? roleName(t, person.role)}
            </p>
          </div>
        </div>

        <div
          key={misses}
          role="status"
          aria-label={plural('line.digitsTyped', pin.length)}
          className={`mt-8 flex flex-wrap gap-3 sm:gap-4 md:mt-auto ${wrong ? 'shake' : ''}`}
        >
          {Array.from({ length: slots }, (_, slot) => {
            const filled = slot < pin.length;
            return (
              <span
                key={slot}
                className={`flex h-12 w-12 items-center justify-center border-[3px] transition-colors duration-200 sm:h-14 sm:w-14 ${
                  welcomed
                    ? 'border-accent bg-accent'
                    : wrong
                      ? 'border-danger'
                      : filled
                        ? 'border-ink'
                        : 'border-field'
                }`}
              >
                {filled ? (
                  <span className={`pop block h-4 w-4 ${welcomed ? 'bg-accent-ink' : 'bg-ink'}`} />
                ) : null}
              </span>
            );
          })}
        </div>

        <p
          key={note.text}
          role={pinLogin.error ? 'alert' : undefined}
          className={`fade-swap mt-4 min-h-8 text-xl sm:text-2xl ${note.tone}`}
        >
          {note.text}
        </p>
      </section>

      <div className="bg-rule grid min-h-[52dvh] flex-1 grid-cols-3 grid-rows-4 gap-px md:min-h-0">
        {DIGITS.map((digit) => (
          <Key key={digit} onClick={() => press(digit)} disabled={busy}>
            {digit}
          </Key>
        ))}
        {length === null ? (
          <Key tone="accent" onClick={confirm} disabled={busy || pin.length < MIN_PIN}>
            {t('line.ok')}
          </Key>
        ) : (
          <Key tone="quiet" onClick={clear} disabled={busy || pin.length === 0}>
            {t('line.clear')}
          </Key>
        )}
        <Key onClick={() => press('0')} disabled={busy}>
          0
        </Key>
        <Key
          tone="quiet"
          onClick={back}
          disabled={busy || pin.length === 0}
          label={t('common.delete')}
        >
          <svg
            aria-hidden
            className="h-9 w-9 sm:h-11 sm:w-11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          >
            <path d="M8.5 5H21v14H8.5L2.5 12z" />
            <path d="m12 9.5 5 5m0-5-5 5" strokeLinecap="round" />
          </svg>
        </Key>
      </div>
    </main>
  );
}

function Key({
  onClick,
  disabled,
  tone = 'digit',
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  tone?: 'digit' | 'quiet' | 'accent';
  label?: string;
  children: ReactNode;
}) {
  const tones = {
    digit: 'bg-surface-raised text-ink text-[44px] font-semibold sm:text-[56px] active:bg-rule',
    quiet:
      'bg-surface-sunk text-ink-soft text-xl tracking-[0.1em] uppercase sm:text-2xl active:bg-rule',
    accent:
      'bg-accent text-accent-ink text-2xl font-semibold tracking-[0.1em] uppercase sm:text-3xl',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`font-display flex items-center justify-center transition-[background-color,transform,opacity] duration-100 active:scale-[0.97] disabled:opacity-40 ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

/** Two initials in an ochre square: how the tablet tells people apart at a glance. */
function Monogram({ name, large = false }: { name: string; large?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0]!.toUpperCase())
    .join('');
  return (
    <span
      aria-hidden
      className={`border-accent text-accent font-display flex shrink-0 items-center justify-center border-2 font-semibold ${
        large
          ? 'h-20 w-20 text-[36px] sm:h-24 sm:w-24 sm:text-[44px]'
          : 'h-14 w-14 text-2xl sm:h-16 sm:w-16 sm:text-[28px]'
      }`}
    >
      {initials}
    </span>
  );
}

function Arrow({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      className={className}
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

function Centered({ children }: { children: ReactNode }) {
  return (
    <main className="fade-swap flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
      {children}
    </main>
  );
}
