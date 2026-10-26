import { useEffect, useState, type FormEvent } from 'react';
import { LANGUAGES, type Language, type TickedRetention } from '@mise/contracts';
import { useKitchen, useUpdateKitchen } from '../../api/kitchen.js';
import { errorMessage, LANGUAGE_NAMES, useT } from '../../i18n/index.js';

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
  const [unitSystem, setUnitSystem] = useState<'metric' | 'imperial'>('metric');
  const [language, setLanguage] = useState<Language>('en');
  const [tickedRetention, setTickedRetention] = useState<TickedRetention>('keep');

  // Seed the form once the current settings arrive.
  useEffect(() => {
    if (kitchen.data) {
      setName(kitchen.data.name);
      setUnitSystem(kitchen.data.unitSystem);
      setLanguage(kitchen.data.language);
      setTickedRetention(kitchen.data.tickedRetention);
    }
  }, [kitchen.data]);

  if (kitchen.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (kitchen.isError) return <p className="text-danger">{t('kitchen.loadError')}</p>;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name, unitSystem, language, tickedRetention });
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

        <div>
          <label className="label" htmlFor="unitSystem">
            {t('kitchen.units')}
          </label>
          <select
            id="unitSystem"
            className="field"
            value={unitSystem}
            onChange={(e) => setUnitSystem(e.target.value as 'metric' | 'imperial')}
          >
            <option value="metric">{t('kitchen.metric')}</option>
            <option value="imperial">{t('kitchen.imperial')}</option>
          </select>
          <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.unitsHint')}</p>
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
    </section>
  );
}
