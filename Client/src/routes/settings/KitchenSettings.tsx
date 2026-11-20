import { useEffect, useState, type FormEvent } from 'react';
import {
  CURRENCIES,
  LABEL_SIZES,
  LANGUAGES,
  type Currency,
  type LabelSize,
  type Language,
  type TickedRetention,
} from '@mise/contracts';
import { useKitchen, usePinOnlyStatus, useUpdateKitchen } from '../../api/kitchen.js';
import { useCurrentUser } from '../../api/session.js';
import { errorMessage, LANGUAGE_NAMES, useT } from '../../i18n/index.js';
import { VersionSettings } from './VersionSettings.js';

export const IDLE_CHOICES = [2, 5, 10, 15, 30];
/** How long kept ticked lines stay, in days. Leaving the choice empty keeps them for good. */
const KEEP_CHOICES = [30, 90, 180, 365, 730];

function keepChoices(current: number | null): number[] {
  return current === null || KEEP_CHOICES.includes(current)
    ? KEEP_CHOICES
    : [...KEEP_CHOICES, current].sort((a, b) => a - b);
}

/**
 * The rolls, by size as printed on the box, with the printer they come for.
 * Not translated: millimetres and model numbers read the same everywhere.
 */
export const LABEL_SIZE_NAMES: Record<LabelSize, string> = {
  '62x29': '62 × 29 mm · Brother QL',
  '62x100': '62 × 100 mm · Brother QL',
  '54x25': '54 × 25 mm · Dymo 11352',
  '57x32': '57 × 32 mm',
  '89x36': '89 × 36 mm · Dymo 99012',
  '102x51': '102 × 51 mm',
};

/** "Euro (EUR)", named in the reader's language by the browser itself. */
function currencyName(locale: string, code: Currency): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
    return name ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** The usual choices, plus whatever is set already if it was set some other way. */
function idleChoices(current: number | null): number[] {
  return current === null || IDLE_CHOICES.includes(current)
    ? IDLE_CHOICES
    : [...IDLE_CHOICES, current].sort((a, b) => a - b);
}

/**
 * What this kitchen is called, which units it works in, what it speaks, and
 * what happens to prep lines once they have been ticked off.
 */
export function KitchenSettings() {
  const translator = useT();
  const { t, plural } = translator;
  const kitchen = useKitchen();
  const update = useUpdateKitchen();
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<Language>('en');
  const [tickedRetention, setTickedRetention] = useState<TickedRetention>('keep');
  const [idleMinutes, setIdleMinutes] = useState<number | null>(null);
  const [keepDays, setKeepDays] = useState<number | null>(365);
  const [prepChecklist, setPrepChecklist] = useState(false);
  const [labelSize, setLabelSize] = useState<LabelSize>('62x29');
  const [labelOnTick, setLabelOnTick] = useState(false);
  const [currency, setCurrency] = useState<Currency>('EUR');
  const [foodVat, setFoodVat] = useState('9');

  // Seed the form once the current settings arrive.
  useEffect(() => {
    if (kitchen.data) {
      setName(kitchen.data.name);
      setLanguage(kitchen.data.language);
      setTickedRetention(kitchen.data.tickedRetention);
      setIdleMinutes(kitchen.data.idleSignOutMinutes);
      setKeepDays(kitchen.data.tickedKeepDays);
      setPrepChecklist(kitchen.data.prepChecklist);
      setLabelSize(kitchen.data.labelSize);
      setLabelOnTick(kitchen.data.labelOnTick);
      setCurrency(kitchen.data.currency);
      setFoodVat(String(kitchen.data.foodVatPercent));
    }
  }, [kitchen.data]);

  if (kitchen.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (kitchen.isError && kitchen.data === undefined)
    return <p className="text-danger">{t('kitchen.loadError')}</p>;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    // A shorter time takes effect within the hour and can't be undone: years
    // of ticked lines can go at once, so the chef says so first.
    const before = kitchen.data?.tickedKeepDays ?? null;
    const shorter =
      tickedRetention === 'keep' && keepDays !== null && (before === null || keepDays < before);
    if (shorter && !window.confirm(plural('kitchen.keepShorterConfirm', keepDays))) return;
    update.mutate({
      name,
      language,
      tickedRetention,
      tickedKeepDays: keepDays,
      idleSignOutMinutes: idleMinutes,
      prepChecklist,
      labelSize,
      labelOnTick,
      currency,
      foodVatPercent: foodVat === '' ? 0 : Number(foodVat),
    });
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

        {tickedRetention === 'keep' ? (
          <div>
            <label className="label" htmlFor="tickedKeepDays">
              {t('kitchen.keepFor')}
            </label>
            <select
              id="tickedKeepDays"
              className="field"
              value={keepDays ?? ''}
              onChange={(e) => setKeepDays(e.target.value === '' ? null : Number(e.target.value))}
            >
              {keepChoices(keepDays).map((days) => (
                <option key={days} value={days}>
                  {days === 365
                    ? t('kitchen.keepYear')
                    : days === 730
                      ? t('kitchen.keepTwoYears')
                      : plural('kitchen.keepDays', days)}
                </option>
              ))}
              <option value="">{t('kitchen.keepForGood')}</option>
            </select>
            <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.keepForHint')}</p>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            className="accent-accent mt-1 h-5 w-5 shrink-0"
            checked={prepChecklist}
            onChange={(e) => setPrepChecklist(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('kitchen.prepChecklist')}</span>
            <span className="text-ink-soft block text-sm">{t('kitchen.prepChecklistHint')}</span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="labelSize">
            {t('kitchen.labelSize')}
          </label>
          <select
            id="labelSize"
            className="field"
            value={labelSize}
            onChange={(e) => setLabelSize(e.target.value as LabelSize)}
          >
            {LABEL_SIZES.map((size) => (
              <option key={size} value={size}>
                {LABEL_SIZE_NAMES[size]}
              </option>
            ))}
          </select>
          <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.labelSizeHint')}</p>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            role="switch"
            className="accent-accent mt-1 h-5 w-5 shrink-0"
            checked={labelOnTick}
            onChange={(e) => setLabelOnTick(e.target.checked)}
          />
          <span>
            <span className="font-medium">{t('kitchen.labelOnTick')}</span>
            <span className="text-ink-soft block text-sm">{t('kitchen.labelOnTickHint')}</span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="currency">
              {t('kitchen.currency')}
            </label>
            <select
              id="currency"
              className="field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              aria-describedby="currencyHint"
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {currencyName(translator.locale, code)}
                </option>
              ))}
            </select>
            <p id="currencyHint" className="text-ink-soft mt-1.5 text-sm">
              {t('kitchen.currencyHint')}
            </p>
          </div>
          <div>
            <label className="label" htmlFor="foodVat">
              {t('kitchen.vat')}
            </label>
            <input
              id="foodVat"
              type="number"
              inputMode="decimal"
              step="any"
              min={0}
              max={50}
              className="field"
              value={foodVat}
              onChange={(e) => setFoodVat(e.target.value)}
              aria-describedby="foodVatHint"
            />
            <p id="foodVatHint" className="text-ink-soft mt-1.5 text-sm">
              {t('kitchen.vatHint')}
            </p>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="idleSignOut">
            {t('kitchen.idle')}
          </label>
          <select
            id="idleSignOut"
            className="field"
            value={idleMinutes ?? ''}
            onChange={(e) => setIdleMinutes(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">{t('kitchen.idleNever')}</option>
            {idleChoices(idleMinutes).map((minutes) => (
              <option key={minutes} value={minutes}>
                {t('kitchen.idleMinutes', { minutes: String(minutes) })}
              </option>
            ))}
          </select>
          <p className="text-ink-soft mt-1.5 text-sm">{t('kitchen.idleHint')}</p>
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
