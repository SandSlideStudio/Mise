import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  DISH_CARD_PARTS,
  LANGUAGES,
  type DishCardAccess,
  type DishCardPart,
  type DishCardSettings as Settings,
  type DishCardTheme,
  type Language,
} from '@mise/contracts';
import {
  useDishCardSettings,
  useRemoveLogo,
  useUpdateDishCardSettings,
  useUploadLogo,
} from '../../api/dishcards.js';
import { useKitchen } from '../../api/kitchen.js';
import { useRecipes } from '../../api/recipes.js';
import { useCurrentUser } from '../../api/session.js';
import { errorMessage, LANGUAGE_NAMES, useT, type MessageKey } from '../../i18n/index.js';

// The preview pulls in the card's fonts and layout, so only when this tab is open.
const Preview = lazy(() =>
  import('./DishCardPreview.js').then((module) => ({ default: module.DishCardPreview })),
);

/**
 * How every dish card in the kitchen looks: the heading, the logo, the
 * kitchen's own warning in each language, which parts show, and who may open
 * one. A card from one of the kitchen's own dishes shows the result as it is
 * typed.
 */
export function DishCardSettings() {
  const { t } = useT();
  const settings = useDishCardSettings();

  if (settings.isPending) return <p className="text-ink-soft">{t('common.loading')}</p>;
  if (settings.isError) return <p className="text-danger">{t('common.loadFailed')}</p>;
  return <SettingsForm settings={settings.data} />;
}

function SettingsForm({ settings }: { settings: Settings }) {
  const translator = useT();
  const { t } = translator;
  const { data: user } = useCurrentUser();
  const kitchen = useKitchen();
  const update = useUpdateDishCardSettings();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const dishes = useRecipes({ type: 'dish' });
  const fileInput = useRef<HTMLInputElement>(null);

  const kitchenLanguage = user?.kitchenLanguage ?? 'en';
  const [title, setTitle] = useState(settings.title ?? '');
  const [locationName, setLocationName] = useState(settings.locationName ?? '');
  const [address, setAddress] = useState(settings.address ?? '');
  const [warnings, setWarnings] = useState<Partial<Record<Language, string>>>(settings.warnings);
  const [warningLanguage, setWarningLanguage] = useState<Language>(kitchenLanguage);
  const [hidden, setHidden] = useState<DishCardPart[]>(settings.hidden);
  const [theme, setTheme] = useState<DishCardTheme>(settings.theme);
  const [access, setAccess] = useState<DishCardAccess>(settings.access);

  // Saved elsewhere, such as on another screen: start again from what is stored.
  useEffect(() => {
    setTitle(settings.title ?? '');
    setLocationName(settings.locationName ?? '');
    setAddress(settings.address ?? '');
    setWarnings(settings.warnings);
    setHidden(settings.hidden);
    setTheme(settings.theme);
    setAccess(settings.access);
  }, [settings]);

  const draft: Settings = {
    title: title.trim() || null,
    locationName: locationName.trim() || null,
    address: address.trim() || null,
    logoUrl: settings.logoUrl,
    warnings,
    hidden,
    theme,
    access,
  };

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      title: draft.title,
      locationName: draft.locationName,
      address: draft.address,
      warnings,
      hidden,
      theme,
      access,
    });
  }

  const defaultHeading = `${t('card.title')} · ${kitchen.data?.name ?? ''}`;
  const previewDish = dishes.data?.find((dish) => dish.status === 'published') ?? dishes.data?.[0];
  const error = update.error ?? upload.error ?? removeLogo.error;

  return (
    <section className="grid gap-8 xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
      <div>
        <h2 className="mb-1 text-2xl">{t('settings.tabDishCards')}</h2>
        <p className="text-ink-soft mb-5">{t('dishCards.intro')}</p>

        <form onSubmit={onSubmit} className="card flex flex-col gap-5">
          <div>
            <label className="label" htmlFor="cardTitle">
              {t('dishCards.titleLabel')}
            </label>
            <input
              id="cardTitle"
              className="field"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultHeading}
            />
            <p className="text-ink-soft mt-1.5 text-sm">
              {t('dishCards.titleHint', { default: defaultHeading })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cardLocation">
                {t('dishCards.locationName')}
              </label>
              <input
                id="cardLocation"
                className="field"
                value={locationName}
                maxLength={120}
                onChange={(e) => setLocationName(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="cardAddress">
                {t('dishCards.address')}
              </label>
              <input
                id="cardAddress"
                className="field"
                value={address}
                maxLength={240}
                onChange={(e) => setAddress(e.target.value)}
              />
            </div>
          </div>

          <div>
            <span className="label">{t('dishCards.logo')}</span>
            <div className="flex flex-wrap items-center gap-3">
              {settings.logoUrl ? (
                <img
                  src={settings.logoUrl}
                  alt=""
                  className="border-line h-16 w-16 border object-contain"
                />
              ) : (
                <span className="text-ink-soft text-sm">{t('dishCards.logoNone')}</span>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn-quiet"
                disabled={upload.isPending}
                onClick={() => fileInput.current?.click()}
              >
                {settings.logoUrl ? t('dishCards.logoReplace') : t('dishCards.logoUpload')}
              </button>
              {settings.logoUrl ? (
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={removeLogo.isPending}
                  onClick={() => removeLogo.mutate()}
                >
                  {t('dishCards.logoRemove')}
                </button>
              ) : null}
            </div>
            <p className="text-ink-soft mt-1.5 text-sm">{t('dishCards.logoHint')}</p>
          </div>

          <div>
            <label className="label" htmlFor="cardWarning">
              {t('dishCards.warning')}
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5" role="tablist">
              {LANGUAGES.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="tab"
                  aria-selected={warningLanguage === code}
                  aria-pressed={warningLanguage === code}
                  onClick={() => setWarningLanguage(code)}
                  className="toggle px-2.5 py-1 text-[13px]"
                >
                  {LANGUAGE_NAMES[code]}
                  {warnings[code]?.trim() ? ' ●' : ''}
                </button>
              ))}
            </div>
            <textarea
              id="cardWarning"
              className="field min-h-28 py-2.5"
              lang={warningLanguage}
              value={warnings[warningLanguage] ?? ''}
              maxLength={2000}
              onChange={(e) => setWarnings({ ...warnings, [warningLanguage]: e.target.value })}
              placeholder={t('dishCards.warningPlaceholder')}
            />
            <p className="text-ink-soft mt-1.5 text-sm">{t('dishCards.warningHint')}</p>
          </div>

          <fieldset>
            <legend className="label">{t('dishCards.show')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {DISH_CARD_PARTS.map((part) => (
                <label key={part} className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="accent-accent h-5 w-5"
                    checked={!hidden.includes(part)}
                    onChange={(e) =>
                      setHidden((current) =>
                        e.target.checked ? current.filter((p) => p !== part) : [...current, part],
                      )
                    }
                  />
                  <span>{t(`dishCards.part.${part}` as MessageKey)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">{t('dishCards.theme')}</legend>
            <div className="flex flex-col gap-2">
              {(['day', 'night'] as const).map((value) => (
                <label key={value} className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="cardTheme"
                    className="accent-accent mt-0.5 h-5 w-5"
                    checked={theme === value}
                    onChange={() => setTheme(value)}
                  />
                  <span>
                    {value === 'day' ? t('card.themeDay') : t('card.themeNight')}
                    <span className="text-ink-soft block text-sm">
                      {value === 'day'
                        ? t('dishCards.themeDayHint')
                        : t('dishCards.themeNightHint')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label className="label" htmlFor="cardAccess">
              {t('dishCards.access')}
            </label>
            <select
              id="cardAccess"
              className="field"
              value={access}
              onChange={(e) => setAccess(e.target.value as DishCardAccess)}
            >
              <option value="everyone">{t('dishCards.accessEveryone')}</option>
              <option value="managers">{t('dishCards.accessManagers')}</option>
            </select>
          </div>

          <p className="text-ink-soft text-sm">{t('dishCards.miseLine')}</p>

          {error ? (
            <p role="alert" className="text-danger text-sm">
              {errorMessage(translator, error)}
            </p>
          ) : null}
          {update.isSuccess ? <p className="text-ink-soft text-sm">{t('common.saved')}</p> : null}

          <div>
            <button type="submit" className="btn-primary" disabled={update.isPending}>
              {update.isPending ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>

      {previewDish ? (
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Suspense fallback={<p className="text-ink-soft">{t('common.loading')}</p>}>
            <Preview recipeId={previewDish.id} settings={draft} kitchenLanguage={kitchenLanguage} />
          </Suspense>
        </div>
      ) : null}
    </section>
  );
}
