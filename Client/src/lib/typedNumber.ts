import type { Translator } from '../i18n/index.js';

/**
 * Numbers as a kitchen types them. A browser's own number box reads "9,80"
 * by the browser's language, not the kitchen's: in an English browser it
 * becomes 980, and butter then costs a hundred times what it does. So every
 * amount is typed as text and read here, the same way on every device.
 *
 * One comma or one point is the decimal separator: "9,80" and "9.80" are
 * both nine eighty. Anything with more than one ("1.250,5", "1,250.5") is
 * refused rather than guessed at, since the same text means a different
 * number in Amsterdam and in London.
 */

export interface NumberRules {
  /** Counts and minutes: no decimals. */
  integer?: boolean;
  /** The smallest it may be, itself allowed. */
  min?: number;
  /** The number it must be more than: an amount that has to be there at all. */
  above?: number;
  /** The largest it may be, itself allowed. */
  max?: number;
  /** A percentage may be typed with its sign: "9 %". */
  percent?: boolean;
}

export type NumberProblem =
  | { kind: 'notNumber' }
  | { kind: 'grouped' }
  | { kind: 'ambiguous'; whole: number; decimal: number }
  | { kind: 'whole' }
  | { kind: 'atLeast'; min: number }
  | { kind: 'moreThan'; min: number }
  | { kind: 'atMost'; max: number };

/** Empty is null: whether empty is allowed is the field's `required`, not this. */
export type TypedNumber =
  { value: number | null; problem: null } | { value: null; problem: NumberProblem };

// Digits with at most one separator, either side of it: "9", "9,8", ",5", "9.".
const PLAIN = /^-?(?:\d+[.,]?\d*|[.,]\d+)$/;
// Digits split up by separators or spaces: someone wrote the thousands.
const GROUPED = /^-?\d+(?:[.,\s]\d+)+(?:[.,]\d*)?$/;

export function readNumber(text: string, rules: NumberRules = {}): TypedNumber {
  let cleaned = text.trim();
  // A price copied off an invoice: "€ 9,80" or "9,80 €".
  cleaned = cleaned
    .replace(/^\p{Sc}\s*/u, '')
    .replace(/\s*\p{Sc}$/u, '')
    .trim();
  if (rules.percent) cleaned = cleaned.replace(/\s*%$/, '');
  if (cleaned === '') return { value: null, problem: null };

  if (!PLAIN.test(cleaned)) {
    return {
      value: null,
      problem: { kind: GROUPED.test(cleaned) ? 'grouped' : 'notNumber' },
    };
  }
  // "1.250" or "1,250": a thousand and a quarter where a point groups
  // thousands, one and a quarter where it marks decimals. Guessing either way
  // makes a price or an amount a thousand times off without anyone seeing,
  // so it is asked instead. "0,250" can only mean a quarter.
  const ambiguous = /^-?([1-9]\d{0,2})[.,](\d{3})$/.exec(cleaned);
  if (ambiguous) {
    const [, head, tail] = ambiguous as unknown as [string, string, string];
    return {
      value: null,
      problem: {
        kind: 'ambiguous',
        whole: Number(head + tail),
        decimal: Number(`${head}.${tail}`),
      },
    };
  }
  const value = Number(cleaned.replace(',', '.'));
  if (!Number.isFinite(value)) return { value: null, problem: { kind: 'notNumber' } };
  if (rules.integer && !Number.isInteger(value)) return { value: null, problem: { kind: 'whole' } };
  if (rules.min !== undefined && value < rules.min) {
    return { value: null, problem: { kind: 'atLeast', min: rules.min } };
  }
  if (rules.above !== undefined && value <= rules.above) {
    return { value: null, problem: { kind: 'moreThan', min: rules.above } };
  }
  if (rules.max !== undefined && value > rules.max) {
    return { value: null, problem: { kind: 'atMost', max: rules.max } };
  }
  return { value, problem: null };
}

/**
 * A number written back the way the reader writes it: 9.8 is "9,8" in
 * Dutch. No thousands separator, since that is what reading refuses.
 */
export function numberText(
  value: number | null | undefined,
  locale: string,
  opts: { money?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat(locale, {
    useGrouping: false,
    // A price reads as one: 9,80, not 9,8. Whole euros stay whole.
    minimumFractionDigits: opts.money && !Number.isInteger(value) ? 2 : 0,
    maximumFractionDigits: opts.money ? 4 : 6,
  }).format(value);
}

/** What is wrong, in a sentence the cook can act on. */
export function problemText(translator: Translator, problem: NumberProblem): string {
  const { t, locale } = translator;
  switch (problem.kind) {
    case 'notNumber':
      return t('number.notNumber', { example: numberText(9.8, locale) });
    case 'grouped':
      return t('number.grouped', { example: numberText(1250.5, locale) });
    case 'ambiguous':
      return t('number.ambiguous', {
        whole: numberText(problem.whole, locale),
        decimal: numberText(problem.decimal, locale),
      });
    case 'whole':
      return t('number.whole');
    case 'atLeast':
      return t('number.atLeast', { min: numberText(problem.min, locale) });
    case 'moreThan':
      return t('number.moreThan', { min: numberText(problem.min, locale) });
    case 'atMost':
      return t('number.atMost', { max: numberText(problem.max, locale) });
  }
}
