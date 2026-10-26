import { useEffect, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import type { Role } from '@mise/contracts';
import { useCurrentUser, useUpdateMe } from '../api/session.js';
import { useT, type MessageKey } from '../i18n/index.js';
import { Plate } from './Plate.js';

/**
 * The first-time tour.
 *
 * Everyone is asked once, the first time they arrive in the app: the
 * administrator straight after setup, a manager on their first password
 * sign-in, a cook the first time they tap their name on the pass tablet. The
 * answer is kept against the person on the server, so it follows them from
 * tablet to tablet rather than being asked again on each.
 *
 * The tour itself dims the page and walks a spotlight across the real thing:
 * the navigation, the station filter, a prep line, the "being made" tick. A
 * stop whose subject is not on screen (an empty prep list on day one) still
 * explains itself, just without the spotlight.
 */

interface Stop {
  /** Matches a `data-tour` attribute on the page. */
  target?: string;
  title: MessageKey;
  body: MessageKey;
}

function stopsFor(role: Role): Stop[] {
  const manager = role !== 'cook';
  const stops: Stop[] = [
    { title: 'tour.welcomeTitle', body: 'tour.welcomeBody' },
    { target: 'nav-today', title: 'nav.today', body: 'tour.todayBody' },
    { target: 'stations', title: 'tour.stationsTitle', body: 'tour.stationsBody' },
    { target: 'task', title: 'tour.tickTitle', body: 'tour.tickBody' },
    { target: 'being-made', title: 'task.beingMade', body: 'tour.makingBody' },
  ];
  if (manager) {
    stops.push({ target: 'add-line', title: 'tour.addLineTitle', body: 'tour.addLineBody' });
  }
  stops.push({ target: 'nav-recipes', title: 'nav.recipes', body: 'tour.recipesBody' });
  if (manager) {
    stops.push(
      { target: 'nav-ingredients', title: 'nav.ingredients', body: 'tour.ingredientsBody' },
      { target: 'nav-settings', title: 'nav.settings', body: 'tour.settingsBody' },
    );
  }
  stops.push(
    { target: 'account', title: 'tour.accountTitle', body: 'tour.accountBody' },
    { title: 'tour.doneTitle', body: 'tour.doneBody' },
  );
  return stops;
}

/** Long enough for the page change into the app to finish first. */
const ASK_AFTER_MS = 700;

/** The dimming, fixed rather than themed: it has to darken paper and night alike. */
const DIM = 'rgba(20, 21, 16, 0.6)';

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function TourHost() {
  const { data: user } = useCurrentUser();
  const update = useUpdateMe();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [phase, setPhase] = useState<'waiting' | 'asking' | 'touring' | 'done'>('waiting');

  const due = user != null && !user.tourSeen;

  useEffect(() => {
    if (!due || phase !== 'waiting') return;
    const timer = window.setTimeout(() => setPhase('asking'), ASK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [due, phase]);

  if (!user) return null;

  function answer(takeTour: boolean) {
    // Either answer counts: nobody is asked twice.
    update.mutate({ tourSeen: true });
    if (!takeTour) {
      setPhase('done');
      return;
    }
    if (pathname !== '/') void navigate({ to: '/' });
    setPhase('touring');
  }

  if (phase === 'asking') {
    return <TourPrompt name={user.displayName} onAnswer={answer} />;
  }
  if (phase === 'touring') {
    return (
      <Tour
        stops={stopsFor(user.role)}
        kitchenName={user.kitchenName}
        onClose={() => setPhase('done')}
      />
    );
  }
  return null;
}

function TourPrompt({ name, onAnswer }: { name: string; onAnswer: (takeTour: boolean) => void }) {
  const { t } = useT();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onAnswer(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return (
    <div
      className="tour-backdrop fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
      style={{ background: DIM }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-prompt-title"
        className="tour-card w-full max-w-[460px]"
      >
        <Plate className="bg-surface-raised flex flex-col gap-4 p-6 sm:p-8">
          <p className="text-ink-faint font-display text-xs font-semibold tracking-[0.16em] uppercase">
            {t('tour.promptEyebrow', { name })}
          </p>
          <h2
            id="tour-prompt-title"
            className="text-ink text-[34px] leading-none text-pretty sm:text-[40px]"
          >
            {t('tour.promptTitle')}
          </h2>
          <span aria-hidden className="bg-brand block h-0.5 w-12" />
          <p className="text-ink-soft text-pretty">{t('tour.promptBody')}</p>
          <div className="mt-2 flex flex-col gap-2.5 sm:flex-row-reverse">
            <button
              type="button"
              autoFocus
              onClick={() => onAnswer(true)}
              className="btn-primary font-display h-14 flex-1 text-lg font-semibold tracking-[0.12em] uppercase"
            >
              {t('tour.start')}
            </button>
            <button
              type="button"
              onClick={() => onAnswer(false)}
              className="btn-quiet font-display h-14 flex-1 text-lg font-semibold tracking-[0.12em] uppercase"
            >
              {t('tour.notNow')}
            </button>
          </div>
          <p className="text-ink-faint text-sm">{t('tour.promptNote')}</p>
        </Plate>
      </div>
    </div>
  );
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

function Tour({
  stops,
  kitchenName,
  onClose,
}: {
  stops: Stop[];
  kitchenName: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const stop = stops[Math.min(index, stops.length - 1)]!;
  const last = index === stops.length - 1;

  // Find what this stop is about, bring it into view, and keep following it:
  // the page may still be loading, scrolling, or changing size underneath.
  useEffect(() => {
    if (!stop.target) {
      setBox(null);
      return;
    }
    let frame = 0;
    let broughtIntoView = false;
    const follow = () => {
      const element = document.querySelector<HTMLElement>(`[data-tour="${stop.target}"]`);
      const rect = element?.getBoundingClientRect();
      const visible = rect && rect.width > 0 && rect.height > 0;
      if (element && visible && !broughtIntoView) {
        element.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
        broughtIntoView = true;
      }
      const next = visible
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null;
      setBox((current) => (sameBox(current, next) ? current : next));
      frame = window.requestAnimationFrame(follow);
    };
    follow();
    return () => window.cancelAnimationFrame(frame);
  }, [stop.target]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') {
        if (last) onClose();
        else setIndex((i) => i + 1);
      } else if (event.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last, onClose]);

  const pad = 6;
  const spot = box
    ? {
        top: box.top - pad,
        left: box.left - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      }
    : { top: window.innerHeight / 2, left: window.innerWidth / 2, width: 0, height: 0 };
  // Keep the card out of the way of whatever it is pointing at.
  const cardAtTop = box !== null && box.top + box.height / 2 > window.innerHeight * 0.55;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('tour.label')}
      className="fixed inset-0 z-50"
    >
      {/* Holds the page still while the tour talks about it. */}
      <div className="tour-backdrop absolute inset-0" />
      <div
        aria-hidden
        className={`tour-spot pointer-events-none fixed ${box ? 'outline-accent outline-2' : ''}`}
        style={{ ...spot, boxShadow: `0 0 0 200vmax ${DIM}` }}
      />

      <div
        key={cardAtTop ? 'top' : 'bottom'}
        className={`tour-card fixed inset-x-4 flex justify-center sm:inset-x-6 ${
          cardAtTop ? 'top-4 sm:top-6' : 'bottom-4 sm:bottom-6'
        }`}
      >
        <Plate className="bg-surface-raised flex w-full max-w-[440px] flex-col gap-3 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-accent font-display text-xs font-semibold tracking-[0.16em] uppercase tabular-nums">
              {index + 1} / {stops.length}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="text-ink-soft hover:text-ink font-display text-xs font-semibold tracking-[0.14em] uppercase"
            >
              {t('tour.skip')}
            </button>
          </div>
          <div aria-hidden className="flex h-[3px] gap-0.5">
            {stops.map((_, i) => (
              <span key={i} className="bg-line relative flex-1 overflow-hidden">
                <span
                  className="bg-accent absolute inset-0 origin-left transition-transform duration-500 ease-out motion-reduce:transition-none"
                  style={{ transform: `scaleX(${i <= index ? 1 : 0})` }}
                />
              </span>
            ))}
          </div>

          <div key={index} className="fade-swap" aria-live="polite">
            <h2 className="text-ink mt-1 text-[28px] leading-none text-pretty sm:text-[32px]">
              {t(stop.title, { kitchen: kitchenName })}
            </h2>
            <p className="text-ink-soft mt-2 text-pretty">{t(stop.body)}</p>
          </div>

          <div className="mt-2 flex gap-2.5">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="btn-quiet font-display h-12 px-5 text-base font-semibold tracking-[0.12em] uppercase"
              >
                {t('setup.back')}
              </button>
            ) : null}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? onClose() : setIndex(index + 1))}
              className="btn-primary font-display h-12 flex-1 text-base font-semibold tracking-[0.12em] uppercase"
            >
              {last ? t('tour.finish') : t('setup.next')}
            </button>
          </div>
        </Plate>
      </div>
    </div>
  );
}
