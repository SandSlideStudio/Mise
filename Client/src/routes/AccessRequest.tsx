import { useEffect, useState, type FormEvent } from 'react';
import { LANGUAGES } from '@mise/contracts';
import { useAccessStatus, useRequestAccess } from '../api/access.js';
import { Logo } from '../components/Logo.js';
import { Plate } from '../components/Plate.js';
import { errorMessage, usePreviewLanguage, useT } from '../i18n/index.js';
import { ForwardButton, LanguageButton } from './SetupFrame.js';

/**
 * What a device outside the kitchen sees before anyone has approved it.
 *
 * It asks with a name, then shows a short code and waits. Whoever approves it
 * in Settings → Devices checks the code with the person asking, so a stranger
 * who happens to ask at the same moment can't be let in by mistake. Once
 * approved the page reloads into the ordinary sign-in.
 */
export function AccessRequest() {
  const translator = useT();
  const { t, language } = translator;
  const preview = usePreviewLanguage();
  const [name, setName] = useState('');
  const ask = useRequestAccess();
  const status = useAccessStatus();
  const state = status.data?.status ?? 'none';

  useEffect(() => {
    // Approved, or now on the kitchen's own network: start the app afresh.
    if (state === 'approved' || state === 'inside') window.location.reload();
  }, [state]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (ask.isPending || !name.trim()) return;
    ask.mutate(name.trim());
  }

  const waiting = state === 'pending' && status.data?.code;

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
            {t('access.eyebrow')}
          </p>
          <h1 className="text-ink mt-3 text-[40px] leading-[1.02] tracking-[-0.01em] text-pretty sm:text-[52px] sm:leading-none xl:mt-4 xl:text-[62px] xl:tracking-[-0.015em]">
            {waiting ? t('access.waitingTitle') : t('access.title')}
          </h1>
          <span aria-hidden className="bg-brand mt-4 block h-0.5 w-14 xl:mt-[22px] xl:w-16" />

          {waiting ? (
            <div className="page-late mt-6 max-w-[520px]">
              <p className="text-ink-soft text-base text-pretty xl:text-[17px]">
                {t('access.waitingBody', { name: status.data!.name ?? '' })}
              </p>
              <p
                className="font-display text-ink mt-8 text-[56px] leading-none font-semibold tracking-[0.12em] sm:text-[72px]"
                aria-label={t('access.codeLabel')}
              >
                {status.data!.code}
              </p>
              <p className="text-ink-faint mt-6 flex items-center gap-2.5 text-sm" role="status">
                <span aria-hidden className="bg-accent inline-block h-2 w-2 animate-pulse" />
                {t('access.checking')}
              </p>
            </div>
          ) : (
            <>
              <p className="text-ink-soft mt-4 max-w-[46ch] text-base text-pretty xl:mt-[22px] xl:text-[17px]">
                {t('access.body')}
              </p>
              <form
                onSubmit={onSubmit}
                noValidate
                className="page-late mt-8 flex max-w-[480px] flex-col gap-5 xl:mt-10"
              >
                <div>
                  <label className="label" htmlFor="deviceName">
                    {t('access.nameLabel')}
                  </label>
                  <input
                    id="deviceName"
                    className="field"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('access.namePlaceholder')}
                    required
                    autoFocus
                  />
                </div>
                {ask.error ? (
                  <p role="alert" className="border-danger text-danger border-l-2 pl-3 text-sm">
                    {errorMessage(translator, ask.error)}
                  </p>
                ) : null}
                <div className="mt-1 flex">
                  <ForwardButton disabled={ask.isPending || !name.trim()}>
                    {ask.isPending ? t('access.asking') : t('access.ask')}
                  </ForwardButton>
                </div>
              </form>
            </>
          )}
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
              <rect x="5" y="10" width="14" height="11" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              <path d="M12 14.5v2.5" />
            </svg>
            <h2 className="text-ink font-display text-2xl font-semibold tracking-[0.06em] uppercase">
              {t('access.whyTitle')}
            </h2>
            <p className="text-ink-soft text-pretty">{t('access.whyBody')}</p>
          </Plate>
          <p className="text-ink-faint flex items-center gap-2.5 font-mono text-xs">
            {t('login.server', { host: window.location.host })}
          </p>
        </aside>
      </main>
    </div>
  );
}
