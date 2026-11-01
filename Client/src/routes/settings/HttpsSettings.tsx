import { useEffect, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import type { Connection } from '@mise/contracts';
import {
  httpsAddress,
  useConnection,
  useDisableDomainHttps,
  useDisableKitchenHttps,
  useEnableDomainHttps,
  useEnableKitchenHttps,
} from '../../api/connection.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * HTTPS, set up from here: a certificate of Mise's own for the kitchen
 * network, and a free one from Let's Encrypt for the kitchen's domain. Either,
 * both, or neither; plain HTTP keeps working throughout, so a tablet that
 * hasn't trusted the kitchen certificate yet is never shut out.
 */
export function HttpsSettings() {
  const { t } = useT();
  const connection = useConnection();
  if (!connection.data) return null;

  return (
    <section className="border-line mt-12 border-t pt-8">
      <h2 className="mb-1.5 text-2xl">{t('https.title')}</h2>
      <p className="text-ink-soft mb-6 max-w-[70ch] text-sm">{t('https.body')}</p>
      <div className="flex flex-col gap-6">
        <KitchenCertificate connection={connection.data} />
        <DomainCertificate connection={connection.data} />
      </div>
    </section>
  );
}

/** Names worth suggesting: the address this page is open on, if it's on the kitchen network. */
function suggestedNames(connection: Connection): string {
  const host = window.location.hostname.toLowerCase();
  const local = /^(\d+\.){3}\d+$/.test(host) || host.endsWith('.local') || !host.includes('.');
  return connection.inside && local && host !== 'localhost' && host !== connection.outsideDomain
    ? host
    : '';
}

function namesFrom(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
}

function KitchenCertificate({ connection }: { connection: Connection }) {
  const translator = useT();
  const { t, locale } = translator;
  const kitchen = connection.https.kitchen;
  const enable = useEnableKitchenHttps();
  const disable = useDisableKitchenHttps();
  const [names, setNames] = useState('');

  useEffect(() => {
    setNames(kitchen.names.length ? kitchen.names.join(', ') : suggestedNames(connection));
    // Only when what is saved changes, not on every keystroke.
  }, [kitchen.names.join(',')]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const list = namesFrom(names);
    if (list.length) enable.mutate({ names: list });
  }

  const changed = namesFrom(names).join(',') !== kitchen.names.join(',');
  const error = enable.error ?? disable.error;

  return (
    <div className="border-line bg-surface-raised border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-semibold tracking-[0.06em] uppercase">
            {t('https.kitchenTitle')}
          </h3>
          <p className="text-ink-soft mt-1 max-w-[65ch] text-sm">{t('https.kitchenBody')}</p>
        </div>
        <span className={`tag ${kitchen.enabled ? 'tag-accent' : ''} px-2 py-0.5 text-xs`}>
          {kitchen.enabled ? t('https.on') : t('https.off')}
        </span>
      </div>

      {kitchen.enabled ? (
        <div className="mt-4 flex flex-col gap-2">
          {kitchen.names.map((name) => {
            const address = httpsAddress([name], connection.https.port);
            return (
              <a
                key={name}
                href={address}
                className="text-accent font-mono text-sm underline underline-offset-4"
              >
                {address}
              </a>
            );
          })}
          {kitchen.expiresAt ? (
            <p className="text-ink-faint text-sm">
              {t('https.renews', { date: new Date(kitchen.expiresAt).toLocaleDateString(locale) })}
            </p>
          ) : null}
          <div className="border-accent mt-2 border-l-2 pl-3">
            <p className="text-sm">{t('https.trustEachTablet')}</p>
            <Link
              to="/trust"
              className="text-accent font-mono text-sm underline underline-offset-4"
            >
              {`${window.location.host}/trust`}
            </Link>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-5 flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label" htmlFor="kitchenNames">
            {t('https.namesLabel')}
          </label>
          <input
            id="kitchenNames"
            className="field font-mono"
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder="192.168.1.50, mise.local"
            autoCapitalize="none"
            spellCheck={false}
          />
          <p className="text-ink-faint mt-1.5 text-xs">{t('https.namesHint')}</p>
        </div>
        <button
          type="submit"
          className={kitchen.enabled ? 'btn-quiet' : 'btn-primary'}
          disabled={enable.isPending || !namesFrom(names).length || (kitchen.enabled && !changed)}
        >
          {enable.isPending
            ? t('https.making')
            : kitchen.enabled
              ? t('https.updateNames')
              : t('https.turnOn')}
        </button>
        {kitchen.enabled ? (
          <button
            type="button"
            className="btn-quiet"
            disabled={disable.isPending}
            onClick={() => disable.mutate(undefined)}
          >
            {t('https.turnOff')}
          </button>
        ) : null}
      </form>
      <p className="text-ink-faint mt-3 text-xs">
        {t('https.portNote', { port: connection.https.port })}
      </p>
      {error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, error)}
        </p>
      ) : null}
    </div>
  );
}

function DomainCertificate({ connection }: { connection: Connection }) {
  const translator = useT();
  const { t, locale } = translator;
  const domain = connection.https.domain;
  const enable = useEnableDomainHttps();
  const disable = useDisableDomainHttps();
  const target = connection.outsideDomain;

  return (
    <div className="border-line bg-surface-raised border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl font-semibold tracking-[0.06em] uppercase">
            {target ? t('https.domainTitleFor', { domain: target }) : t('https.domainTitle')}
          </h3>
          <p className="text-ink-soft mt-1 max-w-[65ch] text-sm">{t('https.domainBody')}</p>
        </div>
        <span className={`tag ${domain.enabled ? 'tag-accent' : ''} px-2 py-0.5 text-xs`}>
          {domain.enabled ? t('https.on') : t('https.off')}
        </span>
      </div>

      {!target ? (
        <p className="border-line text-ink-soft mt-4 border-l-2 pl-3 text-sm">
          {t('https.domainNeedsAddress')}
        </p>
      ) : domain.enabled && domain.domain ? (
        <div className="mt-4 flex flex-col gap-2">
          <a
            href={`https://${domain.domain}`}
            className="text-accent font-mono text-sm underline underline-offset-4"
          >
            {`https://${domain.domain}`}
          </a>
          {domain.expiresAt ? (
            <p className="text-ink-faint text-sm">
              {t('https.renews', { date: new Date(domain.expiresAt).toLocaleDateString(locale) })}
            </p>
          ) : null}
          {domain.error ? (
            <p className="text-danger text-sm">
              {t('https.renewFailed', { reason: domain.error })}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              className="btn-quiet mt-2"
              disabled={disable.isPending}
              onClick={() => disable.mutate(undefined)}
            >
              {t('https.turnOff')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {connection.trustedProxy ? (
            <p className="border-accent border-l-2 pl-3 text-sm">{t('https.domainBehindProxy')}</p>
          ) : null}
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
            <li>{t('https.domainStep1', { domain: target })}</li>
            <li>
              {t('https.domainStep2', {
                http: connection.https.httpPort,
                https: connection.https.port,
              })}
            </li>
            <li>{t('https.domainStep3')}</li>
          </ol>
          <div>
            <button
              type="button"
              className="btn-primary"
              disabled={enable.isPending}
              onClick={() => enable.mutate(undefined)}
            >
              {enable.isPending ? t('https.asking') : t('https.getCertificate')}
            </button>
          </div>
          {enable.isPending ? (
            <p className="text-ink-soft text-sm" role="status">
              {t('https.askingNote')}
            </p>
          ) : null}
          {enable.error || domain.error ? (
            <div role="alert" className="border-danger border-l-2 pl-3 text-sm">
              <p className="text-danger">
                {enable.error ? errorMessage(translator, enable.error) : domain.error}
              </p>
              <p className="text-ink-soft mt-1">{t('https.failedHint')}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
