import { useEffect, useState, type FormEvent } from 'react';
import {
  bareDomain,
  looksLikeDomain,
  useConnection,
  useUpdateConnection,
} from '../../api/connection.js';
import { LoadError } from '../../components/LoadError.js';
import { clockTime, errorMessage, useT } from '../../i18n/index.js';

/**
 * How this server is reached.
 *
 * The address from outside works like a website's address on a shared
 * server: once it is set, a device outside the kitchen only finds Mise
 * through that name. The bare IP, or another site's name pointed at the same
 * machine, finds nothing. Inside the kitchen, every address keeps working.
 */
export function ConnectionSettings() {
  const translator = useT();
  const { t, locale } = translator;
  const connection = useConnection();
  const update = useUpdateConnection();
  const [domain, setDomain] = useState('');

  const saved = connection.data?.outsideDomain ?? null;
  useEffect(() => {
    setDomain(saved ?? '');
  }, [saved]);

  function save(value: string | null) {
    update.mutate({ outsideDomain: value });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const value = bareDomain(domain);
    setDomain(value);
    save(value || null);
  }

  const current = connection.data?.currentHost ?? '';
  const suggest = !saved && looksLikeDomain(current) && bareDomain(domain) !== current;

  return (
    <section>
      <h2 className="mb-1.5 text-2xl">{t('connection.domainTitle')}</h2>
      <p className="text-ink-soft mb-5 max-w-[70ch] text-sm">{t('connection.domainBody')}</p>

      {connection.isPending ? <p className="text-ink-soft">{t('common.loading')}</p> : null}
      {connection.isError && connection.data === undefined ? (
        <LoadError className="mb-5" onRetry={() => void connection.refetch()} />
      ) : null}

      {connection.data &&
      (connection.data.containerGateway || connection.data.trustContainerGateway) ? (
        <div
          role={connection.data.trustContainerGateway ? 'alert' : 'status'}
          className={`mb-6 max-w-[80ch] border-2 px-4 py-3 ${
            connection.data.trustContainerGateway ? 'border-danger' : 'border-accent'
          }`}
        >
          <p className="font-display text-lg font-semibold">{t('connection.relayedTitle')}</p>
          <p className="mt-1 text-sm">
            {t(
              connection.data.trustContainerGateway
                ? 'connection.relayedTrusted'
                : 'connection.relayedBody',
            )}
          </p>
          {connection.data.containerGateway ? (
            <p className="text-ink-soft mt-1 text-sm">
              {t('connection.relayedSeen', {
                address: connection.data.containerGateway.address,
                // In the reader's own day, not the UTC one.
                when: `${new Date(connection.data.containerGateway.at).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })} ${clockTime(locale, connection.data.containerGateway.at)}`,
              })}
            </p>
          ) : null}
          <p className="text-ink-soft mt-2 text-sm">{t('connection.relayedFix')}</p>
          <label className="mt-3 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="accent-accent mt-1 size-4 shrink-0"
              checked={connection.data.trustContainerGateway}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ trustContainerGateway: e.target.checked })}
            />
            <span>
              <span className="block font-medium">{t('connection.relayedTrust')}</span>
              <span className="text-ink-soft mt-0.5 block text-sm">
                {t('connection.relayedTrustHint')}
              </span>
            </span>
          </label>
        </div>
      ) : null}

      {connection.data ? (
        <>
          <p
            className={`mb-5 border-l-2 pl-3 text-sm ${saved ? 'border-accent' : 'border-line text-ink-soft'}`}
          >
            {saved ? t('connection.domainSet', { domain: saved }) : t('connection.domainUnset')}
          </p>

          <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className="label" htmlFor="outsideDomain">
                {t('connection.domainLabel')}
              </label>
              <input
                id="outsideDomain"
                className="field font-mono"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="mise.example.com"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
              />
            </div>
            <button
              type="submit"
              className="btn-primary"
              disabled={update.isPending || bareDomain(domain) === (saved ?? '')}
            >
              {update.isPending ? t('common.saving') : t('common.save')}
            </button>
            {saved ? (
              <button
                type="button"
                className="btn-quiet"
                disabled={update.isPending}
                onClick={() => save(null)}
              >
                {t('connection.domainClear')}
              </button>
            ) : null}
          </form>

          {suggest ? (
            <button
              type="button"
              className="text-accent mt-3 text-sm underline underline-offset-4"
              onClick={() => setDomain(current)}
            >
              {t('connection.domainUseCurrent', { domain: current })}
            </button>
          ) : null}

          {update.error ? (
            <p role="alert" className="text-danger mt-3 text-sm">
              {errorMessage(translator, update.error)}
            </p>
          ) : null}
          {update.isSuccess ? (
            <p className="text-ink-soft mt-3 text-sm">{t('common.saved')}</p>
          ) : null}

          <p className="text-ink-faint mt-6 max-w-[70ch] text-sm">{t('connection.domainShared')}</p>
        </>
      ) : null}
    </section>
  );
}
