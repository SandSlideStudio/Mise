import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { LANGUAGES } from '@mise/contracts';
import { useLogin, useSetupStatus } from '../api/session.js';
import { Logo } from '../components/Logo.js';
import { AboutLine } from '../components/AboutLine.js';
import { Plate } from '../components/Plate.js';
import { errorMessage, usePreviewLanguage, useT } from '../i18n/index.js';
import { ForwardButton, LanguageButton } from './SetupFrame.js';

/**
 * Email and password: chefs and managers, on any device.
 *
 * Drawn on the same paper as setup, so the screen a manager meets every day
 * looks like the one that created the kitchen. Cooks are pointed at the
 * tablet instead, where a name and a PIN are quicker than an email address.
 */
export function Login() {
  const translator = useT();
  const { t, language } = translator;
  const preview = usePreviewLanguage();
  const navigate = useNavigate();
  const status = useSetupStatus();
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Counts failed tries, so the same error shakes again on a second miss.
  const [attempts, setAttempts] = useState(0);

  const kitchenName = status.data?.kitchenName ?? null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (login.isPending || !email.trim() || !password) return;
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: () => void navigate({ to: '/' }),
        onError: () => setAttempts((count) => count + 1),
      },
    );
  }

  return (
    <div className="grid-paper flex min-h-dvh flex-col">
      <header className="bg-surface-raised border-rule border-b">
        <div className="flex h-[60px] items-center justify-between gap-4 px-5 sm:h-[72px] sm:px-10 xl:px-16">
          <div className="flex min-w-0 items-center gap-3.5">
            <Logo size={30} wordmarkClassName="text-[24px] sm:text-[27px]" />
            <span aria-hidden className="bg-rule hidden h-[22px] w-px md:block" />
            <span className="text-ink-faint hidden truncate font-mono text-xs md:block">
              {window.location.host}
            </span>
          </div>
          <div
            role="group"
            aria-label={t('kitchen.language')}
            className="bg-rule flex shrink-0 gap-px p-px"
          >
            {LANGUAGES.map((code) => (
              <LanguageButton
                key={code}
                code={code}
                label={code.toUpperCase()}
                selected={code === language}
                onLanguage={preview}
                className="h-9 min-w-9 px-2 text-sm tracking-[0.08em] sm:h-10 sm:min-w-12 sm:px-3 sm:text-[15px]"
              />
            ))}
          </div>
        </div>
      </header>

      <main className="page-enter-forward mx-auto grid w-full max-w-[1200px] flex-1 content-center gap-10 px-5 py-10 sm:px-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-16 xl:grid-cols-[minmax(0,1fr)_440px] xl:px-16">
        <section className="min-w-0">
          <p className="text-ink-faint font-display text-[11px] font-semibold tracking-[0.16em] uppercase xl:text-xs">
            {t('login.eyebrow')}
          </p>
          <h1 className="text-ink mt-3 text-[40px] leading-[1.02] tracking-[-0.01em] text-pretty sm:text-[52px] sm:leading-none xl:mt-4 xl:text-[62px] xl:tracking-[-0.015em]">
            {kitchenName ? t('login.titleKitchen', { kitchen: kitchenName }) : t('login.title')}
          </h1>
          <span aria-hidden className="bg-brand mt-4 block h-0.5 w-14 xl:mt-[22px] xl:w-16" />
          <p className="text-ink-soft mt-4 max-w-[46ch] text-base text-pretty xl:mt-[22px] xl:text-[17px]">
            {t('login.subtitle')}
          </p>

          <form
            onSubmit={onSubmit}
            noValidate
            className="page-late mt-8 flex max-w-[480px] flex-col gap-5 xl:mt-10"
          >
            <div>
              <label className="label" htmlFor="email">
                {t('common.email')}
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                {t('common.password')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="field pr-24"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-pressed={showPassword}
                  aria-controls="password"
                  className="text-ink-soft hover:text-ink font-display absolute inset-y-0 right-0 px-4 text-sm font-semibold tracking-[0.12em] uppercase transition-colors"
                >
                  {showPassword ? t('login.hide') : t('login.show')}
                </button>
              </div>
            </div>

            {login.error ? (
              <p
                key={attempts}
                role="alert"
                className="shake border-danger text-danger border-l-2 pl-3 text-sm"
              >
                {errorMessage(translator, login.error)}
              </p>
            ) : null}

            <div className="mt-1 flex">
              <ForwardButton disabled={login.isPending || !email.trim() || !password}>
                {login.isPending ? t('login.signingIn') : t('login.signIn')}
              </ForwardButton>
            </div>

            <p className="text-ink-faint text-sm text-pretty">{t('login.forgot')}</p>
          </form>
        </section>

        <aside className="page-late flex min-w-0 flex-col gap-5 lg:self-center">
          <Plate className="bg-surface-raised flex flex-col gap-4 p-6 xl:p-8">
            <svg
              aria-hidden
              className="text-brand h-8 w-8"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4.5" y="2" width="15" height="20" />
              <path d="M8 6.5h8M8 10h8" />
              <path d="m8.4 15.6 1.6 1.6 3.2-3.2" />
            </svg>
            <h2 className="text-ink font-display text-2xl font-semibold tracking-[0.06em] uppercase">
              {t('login.onTheLine')}
            </h2>
            <p className="text-ink-soft text-pretty">{t('login.tabletBody')}</p>
            <Link
              to="/line"
              className="btn-quiet font-display mt-1 flex h-14 items-center justify-between gap-4 px-5 text-lg font-semibold tracking-[0.12em] uppercase"
            >
              <span>{t('login.pinLink')}</span>
              <svg
                aria-hidden
                className="h-5 w-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12h15M13 6l6 6-6 6" />
              </svg>
            </Link>
          </Plate>
          <p className="text-ink-faint flex items-center gap-2.5 font-mono text-xs">
            {t('login.server', { host: window.location.host })}
          </p>
          <AboutLine />
        </aside>
      </main>
    </div>
  );
}
