import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useConnection, useUpdateConnection } from '../../api/connection.js';
import { errorMessage, useT } from '../../i18n/index.js';

/**
 * Mise behind the web server that already answers for the kitchen's other
 * sites, such as Apache with a few WordPress sites on the same home IP.
 *
 * That web server owns ports 80 and 443 and its own certificates; it passes
 * the Mise domain on. Mise has to know which machine it is, so it believes
 * that machine (and only that one) about who the visitor really is: someone
 * at home is inside, someone on mobile data is outside.
 */
export function ProxySettings() {
  const translator = useT();
  const { t } = translator;
  const connection = useConnection();
  const update = useUpdateConnection();
  const [address, setAddress] = useState('');

  const data = connection.data;
  if (!data) return null;
  const trusted = data.trustedProxy;
  const seen = data.seenProxy;
  const offer = seen && seen.address !== trusted ? seen : null;

  function trust(value: string | null) {
    update.mutate({ trustedProxy: value }, { onSuccess: () => setAddress('') });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (address.trim()) trust(address.trim());
  }

  return (
    <section className="border-line mt-12 border-t pt-8">
      <h2 className="mb-1.5 text-2xl">{t('proxy.title')}</h2>
      <p className="text-ink-soft mb-5 max-w-[70ch] text-sm">{t('proxy.body')}</p>

      {trusted ? (
        <div className="border-accent mb-5 flex flex-wrap items-center gap-3 border-l-2 pl-3">
          <p className="flex-1 text-sm">{t('proxy.trusted', { address: trusted })}</p>
          <button
            type="button"
            className="btn-small"
            disabled={update.isPending}
            onClick={() => trust(null)}
          >
            {t('proxy.stop')}
          </button>
        </div>
      ) : (
        <p className="border-line text-ink-soft mb-5 border-l-2 pl-3 text-sm">{t('proxy.none')}</p>
      )}

      {offer ? (
        <div className="border-accent bg-surface-raised mb-5 flex flex-wrap items-center gap-4 border-2 p-4">
          <div className="min-w-0 flex-1">
            <p>{t('proxy.seen', { host: offer.host, address: offer.address })}</p>
            {/* Until it's trusted, everyone it passes on looks like one visitor. */}
            <p className="text-ink-soft mt-1 text-sm">{t('proxy.seenShared')}</p>
          </div>
          <button
            type="button"
            className="btn-primary min-h-11"
            disabled={update.isPending}
            onClick={() => trust(offer.address)}
          >
            {t('proxy.trust', { address: offer.address })}
          </button>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <label className="label" htmlFor="trustedProxy">
            {t('proxy.addressLabel')}
          </label>
          <input
            id="trustedProxy"
            className="field font-mono"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="192.168.1.60"
            inputMode="decimal"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="btn-quiet" disabled={update.isPending || !address.trim()}>
          {t('proxy.trustTyped')}
        </button>
      </form>
      {update.error ? (
        <p role="alert" className="text-danger mt-3 text-sm">
          {errorMessage(translator, update.error)}
        </p>
      ) : null}

      <ApacheSteps
        domain={data.outsideDomain}
        miseAddress={
          // The address this page is open on, unless that is this machine
          // itself, which means nothing to Apache on another one.
          data.inside &&
          data.currentHost !== data.outsideDomain &&
          !/^(localhost|127\.|\[?::1)/.test(window.location.hostname)
            ? window.location.host
            : ''
        }
      />
    </section>
  );
}

/** The few lines Apache needs, filled in with this kitchen's own names. */
function ApacheSteps({ domain, miseAddress }: { domain: string | null; miseAddress: string }) {
  const { t } = useT();
  const [site, setSite] = useState(domain ?? '');
  const [mise, setMise] = useState(miseAddress);
  const name = site.trim() || 'mise.example.com';
  const upstream = mise.trim() || '192.168.1.50:3000';

  const config = `<VirtualHost *:80>
    ServerName ${name}
    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
    ProxyPass        / http://${upstream}/ flushpackets=on
    ProxyPassReverse / http://${upstream}/
</VirtualHost>`;
  const enable = `sudo a2enmod proxy proxy_http headers
sudo a2ensite mise
sudo apache2ctl configtest && sudo systemctl reload apache2
sudo certbot --apache -d ${name}`;

  return (
    <details className="border-line bg-surface-raised mt-8 border">
      <summary className="font-display cursor-pointer px-4 py-3 text-lg font-semibold">
        {t('proxy.apacheTitle')}
      </summary>
      <div className="border-line flex flex-col gap-5 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="apacheDomain">
              {t('connection.domainLabel')}
            </label>
            <input
              id="apacheDomain"
              className="field font-mono"
              value={site}
              onChange={(e) => setSite(e.target.value)}
              placeholder="mise.example.com"
              spellCheck={false}
            />
          </div>
          <div>
            <label className="label" htmlFor="apacheUpstream">
              {t('proxy.miseAddress')}
            </label>
            <input
              id="apacheUpstream"
              className="field font-mono"
              value={mise}
              onChange={(e) => setMise(e.target.value)}
              placeholder="192.168.1.50:3000"
              spellCheck={false}
            />
          </div>
        </div>

        <Step n={1} text={t('proxy.step1')}>
          <CopyBlock text={`curl http://${upstream}/api/health`} />
          <p className="text-ink-soft mt-2 text-sm">{t('proxy.step1Bridge')}</p>
        </Step>
        <Step n={2} text={t('proxy.step2')}>
          <CopyBlock text={config} />
        </Step>
        <Step n={3} text={t('proxy.step3')}>
          <CopyBlock text={enable} />
        </Step>
        <Step n={4} text={t('proxy.step4', { domain: name })} />
        <p className="text-ink-faint text-sm">{t('proxy.router')}</p>
      </div>
    </details>
  );
}

function Step({ n, text, children }: { n: number; text: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="font-display text-accent w-5 shrink-0 text-lg font-semibold">{n}</span>
      <div className="min-w-0 flex-1">
        <p className="mb-2">{text}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * A block to paste into a terminal. The clipboard only works over HTTPS, so
 * on the kitchen network's plain HTTP the button selects the text instead.
 */
function CopyBlock({ text }: { text: string }) {
  const { t } = useT();
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const range = document.createRange();
      if (ref.current) range.selectNodeContents(ref.current);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  return (
    <div className="border-line bg-surface-sunk relative border">
      <pre ref={ref} className="overflow-x-auto p-3 pr-20 font-mono text-[13px] leading-relaxed">
        {text}
      </pre>
      <button
        type="button"
        className="btn-small absolute top-2 right-2"
        onClick={() => void copy()}
      >
        {copied ? t('proxy.copied') : t('proxy.copy')}
      </button>
    </div>
  );
}
