import { useEffect, useState, type FormEvent } from 'react';
import { LANGUAGES, type Language, type TickedRetention } from '@mise/contracts';
import { useKitchen, usePinOnlyStatus, useUpdateKitchen } from '../../api/kitchen.js';
import { useCurrentUser } from '../../api/session.js';
import { errorMessage, LANGUAGE_NAMES, useT } from '../../i18n/index.js';
import { VersionSettings } from './VersionSettings.js';

/**
 * What this kitchen is called, which units it works in, what it speaks, and
 * what happens to prep lines once they have been ticked off.
 */
export function KitchenSettings() {
  const translator = useT();
  const { t } = translator;
  const kitchen = useKitchen();
  const update = useUpdateKitchen();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [tickedRetention, setTickedRetention] = useState<TickedRetention>('keep');

  // Seed the form once the current settings arrive.
  useEffect(() => {
    if (kitchen.data) {
      setName(kitchen.data.name);
      setLanguage(kitchen.data.language);
      setTickedRetention(kitchen.data.tickedRetention);
    }
  }, [kitchen.data]);

  if (kitchen.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (kitchen.isError && kitchen.data === undefined)
    return <p className="text-danger">{t('kitchen.loadError')}</p>;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name, language, tickedRetention });
  }

  return (
    <section>
      <h2 className="mb-5 text-2xl">{t('kitchen.title')}</h2>

      <form onSubmit={onSubmit} className="card flex max-w-lg flex-col gap-5">
        <div>
          <label className="label" htmlFor="kitchenName">
            {t('common.name')}
          </label>
          <input
            id="kitchenName"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="tickedRetention">
            {t('kitchen.retention')}
          </label>
          <select
            id="tickedRetention"
            className="field"
            value={tickedRetention}
            onChange={(e) => setTickedRetention(e.target.value as TickedRetention)}
          >
            <option value="keep">{t('kitchen.retentionKeep')}</option>
            <option value="delete">{t('kitchen.retentionDelete')}</option>
          </select>
          <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.retentionHint')}</p>
        </div>

        <div>
          <label className="label" htmlFor="kitchenLanguage">
            {t('kitchen.language')}
          </label>
          <select
            id="kitchenLanguage"
            className="field"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_NAMES[code]}
              </option>
            ))}
          </select>
          <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.languageHint')}</p>
        </div>

        {update.error ? (
          <p role="alert" className="text-danger text-sm">
            {errorMessage(translator, update.error)}
          </p>
        ) : null}
        {update.isSuccess ? <p className="text-ink-soft text-sm">{t('common.saved')}</p> : null}

        <div>
          <button type="submit" className="btn-primary" disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
      <PinOnlySettings />
      <VersionSettings />
    </section>
  );
}

/**
 * Sign-in by PIN alone. Choosing it doesn't change the tablets yet: everyone
 * with a PIN first needs a new one, checked to be unique and not obvious, so
 * the list of who is still waiting is the heart of this.
 */
function PinOnlySettings() {
  const translator = useT();
  const { t } = translator;
  const { data: me } = useCurrentUser();
  const kitchen = useKitchen();
  const update = useUpdateKitchen();
  const isAdmin = me?.role === 'admin';
  // Head chefs hand the new PINs out, so they see who is waiting too.
  const status = usePinOnlyStatus(isAdmin || me?.role === 'head_chef');

  const state = status.data?.state ?? kitchen.data?.pinOnly;
  if (!state) return null;
  const waiting = status.data?.waiting ?? [];

  return (
    <section className="border-rule mt-10 border-t pt-8">
      <h2 className="mb-2 text-2xl">{t('pinOnly.title')}</h2>
      <div className="flex max-w-2xl flex-col gap-5">
        <label className={`flex items-start gap-3 ${isAdmin ? 'cursor-pointer' : ''}`}>
          <input
            type="checkbox"
            role="switch"
            className="accent-accent mt-1 h-5 w-5 shrink-0"
            checked={state !== 'off'}
            disabled={!isAdmin || update.isPending}
            onChange={(e) => update.mutate({ pinOnly: e.target.checked })}
          />
          <span>
            <span className="font-medium">{t('pinOnly.label')}</span>
            <span className="text-ink-soft block text-sm">{t('pinOnly.hint')}</span>
          </span>
        </label>
        {update.error ? (
          <p role="alert" className="text-danger text-sm">
            {errorMessage(translator, update.error)}
          </p>
        ) : null}

        {state === 'on' ? (
          <p className="bg-accent-wash border-accent border-l-[6px] px-5 py-4">{t('pinOnly.on')}</p>
        ) : null}

        {state === 'waiting' ? (
          <div className="bg-surface-raised border-line border px-5 py-4">
            <p className="font-medium">{t('pinOnly.waiting')}</p>
            <p className="text-ink-soft mt-1 text-sm">{t('pinOnly.waitingHow')}</p>
            {waiting.length > 0 ? (
              <>
                <h3 className="eyebrow mt-4 mb-2">{t('pinOnly.waitingFor')}</h3>
                <ul className="flex flex-wrap gap-2">
                  {waiting.map((person) => (
                    <li key={person.id} className="tag">
                      {person.displayName}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
