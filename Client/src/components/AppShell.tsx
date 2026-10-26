import { Link, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { LANGUAGES, type Language } from '@mise/contracts';
import { useBackupStatus } from '../api/backups.js';
import { useCurrentUser, useLogout, useUpdateMe } from '../api/session.js';
import { dismissRefusal, useLastRefusal, usePendingTickCount } from '../api/ticks.js';
import { useVersion } from '../api/version.js';
import {
  errorMessage,
  inSentence,
  LANGUAGE_NAMES,
  roleName,
  useT,
  type MessageKey,
} from '../i18n/index.js';
import { Logo } from './Logo.js';

/**
 * The frame around every signed-in page. Kept deliberately thin: a kitchen
 * screen should be mostly the work, not mostly navigation.
 *
 * On a phone the navigation drops to its own full-width row under the logo,
 * so every destination stays one thumb away instead of hiding behind a menu.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
  const translator = useT();
  const { t } = translator;
  const logout = useLogout();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!user) return null;

  const canManage = user.role !== 'cook';

  return (
    <div className="min-h-dvh">
      <header className="app-header no-print border-line bg-surface-raised border-b">
        <div className="flex flex-wrap items-stretch lg:flex-nowrap">
          <Link
            to="/"
            className="border-rule flex min-h-14 shrink-0 items-center border-r px-4 sm:px-[22px]"
            aria-label={t('shell.home')}
          >
            <Logo size={32} wordmarkClassName="text-[26px] hidden sm:inline" />
          </Link>

          <nav className="border-rule order-last flex w-full min-w-0 items-stretch overflow-x-auto border-t lg:order-none lg:w-auto lg:border-t-0">
            <NavLink to="/" label="nav.today" active={pathname === '/'} />
            <NavLink to="/recipes" label="nav.recipes" active={pathname.startsWith('/recipes')} />
            <NavLink to="/menus" label="nav.menus" active={pathname.startsWith('/menus')} />
            {canManage ? (
              <NavLink
                to="/ingredients"
                label="nav.ingredients"
                active={pathname.startsWith('/ingredients')}
              />
            ) : null}
            {canManage ? (
              <NavLink
                to="/settings"
                label="nav.settings"
                active={pathname.startsWith('/settings')}
                badge={user.role === 'admin' ? <UpdateDot /> : null}
              />
            ) : null}
          </nav>

          <div
            data-tour="account"
            className="border-rule ml-auto flex shrink-0 items-center gap-2.5 border-l px-4 sm:gap-3.5 sm:px-[22px]"
          >
            <span className="text-ink-soft hidden text-[15px] xl:inline">
              {user.displayName} · {inSentence(translator, roleName(t, user.role))}
            </span>
            <LanguagePicker />
            <button
              type="button"
              className="btn-small"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              {t('shell.signOut')}
            </button>
          </div>
        </div>
      </header>

      {logout.isError ? (
        <p role="alert" className="no-print text-danger mx-4 mt-3 sm:mx-7">
          {t('shell.signOutFailed')}
        </p>
      ) : null}

      <div className="app-main">
        <TickStatus />
        {user.role === 'admin' && !pathname.startsWith('/settings') ? <BackupWarning /> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Says plainly when a tick hasn't reached the server yet, or was refused. A
 * cook who thinks a job is marked done walks away from it.
 */
function TickStatus() {
  const translator = useT();
  const { t, plural } = translator;
  const waiting = usePendingTickCount();
  const refused = useLastRefusal();
  if (waiting === 0 && !refused) return null;

  return (
    <div className="no-print mx-4 mt-4 flex flex-col gap-3 sm:mx-7">
      {waiting > 0 ? (
        <p
          role="status"
          className="border-accent bg-accent-wash border-2 px-4 py-3 text-lg sm:px-5"
        >
          <span className="font-display font-semibold tracking-[0.04em]">
            {plural('today.pending', waiting)}
          </span>{' '}
          {t('today.pendingStill')}
        </p>
      ) : null}
      {refused ? (
        <div
          role="alert"
          className="border-danger flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 sm:px-5"
        >
          <p className="text-danger text-lg">
            {t('today.tickRefused', { reason: errorMessage(translator, refused) })}
          </p>
          <button type="button" className="btn-small" onClick={dismissRefusal}>
            {t('common.dismiss')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tells administrators when the kitchen isn't safely backed up. Nobody notices
 * a failed backup until the day they need it.
 */
function BackupWarning() {
  const { t } = useT();
  const status = useBackupStatus();
  const data = status.data;
  if (!data?.problem) return null;
  // Only once there's a backup to open; right after setup it would be noise.
  if (data.problem === 'key_unconfirmed' && data.files.length === 0) return null;

  const message: MessageKey =
    data.problem === 'failed'
      ? 'backups.bannerFailed'
      : data.problem === 'stale'
        ? 'backups.bannerStale'
        : 'backups.bannerKey';

  return (
    <div
      role={data.problem === 'key_unconfirmed' ? 'status' : 'alert'}
      className={`no-print mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 border-2 px-4 py-3 sm:mx-7 sm:px-5 ${
        data.problem === 'key_unconfirmed' ? 'border-accent bg-accent-wash' : 'border-danger'
      }`}
    >
      <p className={`text-lg ${data.problem === 'key_unconfirmed' ? '' : 'text-danger'}`}>
        {t(message)}
      </p>
      <a className="btn-small" href="/settings?tab=backups">
        {t('backups.bannerAction')}
      </a>
    </div>
  );
}

/**
 * Anyone's own language. Shows as a two-letter code so it costs nothing on a
 * phone, over a native select so choosing works everywhere a select does.
 */
function LanguagePicker() {
  const { data: user } = useCurrentUser();
  const { t, language } = useT();
  const update = useUpdateMe();
  if (!user) return null;

  return (
    <label className="btn-small focus-within:outline-accent relative cursor-pointer focus-within:outline-2 focus-within:outline-offset-2">
      <span aria-hidden>{language}</span>
      <select
        aria-label={t('shell.language')}
        value={user.language ?? ''}
        disabled={update.isPending}
        onChange={(e) => update.mutate({ language: (e.target.value || null) as Language | null })}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">
          {t('shell.languageKitchen', { language: LANGUAGE_NAMES[user.kitchenLanguage] })}
        </option>
        {LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_NAMES[code]}
          </option>
        ))}
      </select>
    </label>
  );
}

function NavLink({
  to,
  label,
  active,
  badge,
}: {
  to: string;
  label: MessageKey;
  active: boolean;
  badge?: ReactNode;
}) {
  const { t } = useT();
  return (
    <Link
      to={to}
      data-tour={`nav-${to === '/' ? 'today' : to.slice(1)}`}
      aria-current={active ? 'page' : undefined}
      className={`font-display flex h-12 shrink-0 grow items-center justify-center border-b-4 px-3 text-base font-semibold tracking-[0.1em] uppercase transition-colors sm:text-lg lg:h-[58px] lg:grow-0 lg:px-5 lg:text-xl ${
        active ? 'border-accent text-ink' : 'text-ink-soft hover:text-ink border-transparent'
      }`}
    >
      {t(label)}
      {badge}
    </Link>
  );
}

/** A quiet dot on Settings for an administrator while a newer Mise is out. */
function UpdateDot() {
  const { t } = useT();
  const version = useVersion();
  if (!version.data?.newer) return null;
  return (
    <span
      role="img"
      aria-label={t('nav.updateAvailable')}
      title={t('nav.updateAvailable')}
      className="bg-accent ml-2 inline-block h-2.5 w-2.5 rounded-full"
    />
  );
}

/** Consistent page heading, so every screen introduces itself the same way. */
export function PageHeader({
  title,
  aside,
  description,
}: {
  title: string;
  aside?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-[34px] sm:text-[44px]">{title}</h1>
        {aside ? <span className="text-ink-soft text-lg">{aside}</span> : null}
      </div>
      {description ? (
        <p className="text-ink-soft mt-1.5 max-w-[78ch] text-base text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
