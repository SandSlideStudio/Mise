import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, type Language } from '@mise/contracts';
import type { Allergen } from '@mise/domain';
import { RequestFailed } from '../api/client.js';
import { useCurrentUser, useSetupStatus } from '../api/session.js';
import { de } from './de.js';
import { en, type MessageKey } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { nl } from './nl.js';

/**
 * The interface in five languages.
 *
 * Who decides: a person's own choice, then the kitchen's default, then — on an
 * empty server before anyone exists — the browser. Only the interface is
 * translated. Recipe names, methods and ingredients stay exactly as the chef
 * typed them, because a spec translated by software is a spec nobody trusts.
 *
 * English is the source. Every other dictionary is typed against it, so a key
 * added in English and forgotten elsewhere fails the build rather than showing
 * a blank on the pass.
 */

export type { MessageKey } from './en.js';
export type Messages = Record<MessageKey, string>;

const DICTIONARIES: Record<Language, Messages> = { en, nl, fr, es, de };

/** Each language named in itself, so someone lost in the wrong one can find theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  nl: 'Nederlands',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
};

const LOCALES: Record<Language, string> = {
  en: 'en-GB',
  nl: 'nl-NL',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
};

const STORAGE_KEY = 'mise.language';

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function browserLanguage(): Language {
  const tags =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of tags) {
    const base = tag.slice(0, 2).toLowerCase();
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** The last language this device showed, so a reload does not flash English first. */
function rememberedLanguage(): Language | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

type Vars = Record<string, string | number>;

/** Keys that come as a pair, `something_one` and `something_other`. */
type PluralBase = MessageKey extends infer K
  ? K extends `${infer Base}_one`
    ? Base
    : never
  : never;

export interface Translator {
  language: Language;
  /** A BCP 47 tag for dates and numbers. */
  locale: string;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Picks the singular or plural form by count; `{count}` is filled in. */
  plural: (base: PluralBase, count: number, vars?: Vars) => string;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function createTranslator(language: Language): Translator {
  const messages = DICTIONARIES[language];
  const locale = LOCALES[language];
  const rules = new Intl.PluralRules(locale);

  const t = (key: MessageKey, vars?: Vars) => interpolate(messages[key] ?? en[key], vars);
  const plural = (base: PluralBase, count: number, vars?: Vars) => {
    const form = rules.select(count) === 'one' ? 'one' : 'other';
    return t(`${base}_${form}` as MessageKey, { count, ...vars });
  };

  return { language, locale, t, plural };
}

interface I18nValue {
  translator: Translator;
  /** Try a language before there is anyone to save it against. */
  preview: (language: Language | null) => void;
}

const I18nContext = createContext<I18nValue>({
  translator: createTranslator('en'),
  preview: () => undefined,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  const status = useSetupStatus();
  const [previewing, preview] = useState<Language | null>(null);

  // Once someone signs in their own choice applies; a language tried on the
  // sign-in page shouldn't come back when they sign out.
  const signedInId = user.data?.id;
  useEffect(() => {
    if (signedInId) preview(null);
  }, [signedInId]);

  // Before anyone has signed in, whoever is at the screen can try a language.
  // During setup it becomes the kitchen's; on the sign-in page it is just for now.
  const beforeSignIn = status.data?.needsSetup
    ? (previewing ?? browserLanguage())
    : user.data == null
      ? previewing
      : null;

  const language: Language =
    user.data?.language ??
    user.data?.kitchenLanguage ??
    beforeSignIn ??
    status.data?.language ??
    rememberedLanguage() ??
    browserLanguage();

  const value = useMemo(() => ({ translator: createTranslator(language), preview }), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A locked-down tablet simply asks the server again next time.
    }
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  return useContext(I18nContext).translator;
}

export function usePreviewLanguage(): (language: Language | null) => void {
  return useContext(I18nContext).preview;
}

// --- names for things the domain only knows by code -------------------------

export function allergenName(t: Translator['t'], allergen: Allergen | string): string {
  return t(`allergen.${allergen}` as MessageKey);
}

export function periodName(t: Translator['t'], period: string): string {
  return t(`period.${period}` as MessageKey);
}

export function roleName(t: Translator['t'], role: string): string {
  return t(`role.${role}` as MessageKey);
}

export function recipeTypeName(t: Translator['t'], type: string): string {
  return t(`recipeType.${type}` as MessageKey);
}

export function recipeStatusName(t: Translator['t'], status: string): string {
  return t(`recipeStatus.${status}` as MessageKey);
}

export function seasonName(t: Translator['t'], season: string): string {
  return t(`season.${season}` as MessageKey);
}

export function temperatureName(t: Translator['t'], temperature: string): string {
  return t(`temperature.${temperature}` as MessageKey);
}

export function courseName(t: Translator['t'], course: string): string {
  return t(`course.${course}` as MessageKey);
}

/** The short name a dish card prints over its column: "Sulphites", not the legal name. */
export function cardAllergenName(t: Translator['t'], allergen: Allergen | string): string {
  return t(`cardAllergen.${allergen}` as MessageKey);
}

/**
 * A name as it sits mid-sentence: "free from celery". German keeps its
 * capital, because every German noun has one.
 */
export function inSentence(translator: Translator, name: string): string {
  if (translator.language === 'de' || !name) return name;
  return name.charAt(0).toLocaleLowerCase(translator.locale) + name.slice(1);
}

/** "Friday 13 September", in the reader's language. */
export function friendlyDate(locale: string, iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** A time of day, "14:02", in the reader's convention. */
export function clockTime(locale: string, value: string | Date): string {
  return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * What went wrong, in the reader's language where the server's answer is one
 * of the fixed ones. Messages that name something specific — which recipe
 * would loop, what still uses an ingredient — come from the server as written.
 */
const TRANSLATED_ERRORS: Partial<Record<string, MessageKey>> = {
  invalid_credentials: 'error.invalidCredentials',
  account_inactive: 'error.accountInactive',
  device_not_enrolled: 'error.deviceNotEnrolled',
  not_authenticated: 'error.notAuthenticated',
  forbidden: 'error.forbidden',
  setup_token: 'error.setupToken',
  internal_error: 'error.generic',
  backup_bad_key: 'backups.reason.bad_key',
  backup_wrong_key: 'backups.reason.wrong_key',
  backup_not_a_backup: 'backups.reason.not_a_backup',
  backup_too_new: 'backups.reason.too_new',
  backup_local: 'backups.reason.local',
  backup_unreachable: 'backups.reason.unreachable',
  backup_auth: 'backups.reason.auth',
  backup_folder: 'backups.reason.folder',
  backup_remote: 'backups.reason.remote',
  backup_unknown: 'backups.reason.unknown',
  backup_onedrive_auth: 'backups.reason.onedrive_auth',
  backup_onedrive_full: 'backups.reason.onedrive_full',
  backup_onedrive_unreachable: 'backups.reason.onedrive_unreachable',
  backup_onedrive_failed: 'backups.reason.onedrive_failed',
};

export function errorMessage(translator: Translator, error: unknown): string {
  if (!(error instanceof RequestFailed)) return translator.t('error.generic');

  if (error.code === 'account_locked') {
    const until = (error.details as { until?: string } | undefined)?.until;
    return until
      ? translator.t('error.accountLockedUntil', { time: clockTime(translator.locale, until) })
      : translator.t('error.accountLocked');
  }

  const key = TRANSLATED_ERRORS[error.code];
  return key ? translator.t(key) : error.message;
}
