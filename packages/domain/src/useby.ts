/**
 * Until when a batch of prep may be used, for the label on its container.
 *
 * The recipe's own shelf life always wins: a chef who knows their fig gel
 * keeps five days sets it on the recipe. Only without one does Mise fall back
 * on the default of the Hygiënecode voor de horeca (from 1 April 2027) for
 * food a kitchen made itself and keeps chilled:
 *
 * - kept at 7 °C or colder: the day it was made, plus 2 days;
 * - kept at 4 °C or colder: the day it was made, plus 3 days.
 *
 * How we read "plus 2 days": the day it was made is day 0, and the batch may
 * be used until the end of day 2. Made on Monday at any hour, it is good until
 * Wednesday night, and the label says Wednesday without a time. It counts
 * calendar days where the kitchen is (the tablet's own time zone), so a batch
 * made at 23:30 has the same date as one made at 06:00 that day, and a summer
 * time change in between moves nothing.
 *
 * Frozen and dry or ambient stock has no default: there the label leaves the
 * date blank to be written in, rather than print a date nobody decided on. The
 * same for food kept hot, which is limited by hours on the pass rather than by
 * a date, and when Mise can't tell from the recipe how it is kept.
 *
 * How a batch is kept is a choice on the recipe. Recipes from before there was
 * one, and offline copies of them, only have the storage note a chef wrote by
 * hand; for those Mise still reads the note (see keptAs).
 */

/** How a batch is kept, as far as the use-by goes. The order the editor offers them in. */
export const KEPT = ['chilled_7', 'chilled_4', 'frozen', 'ambient', 'hot'] as const;
export type KeptAs = (typeof KEPT)[number];

/** Days after the day it was made, for chilled prep without its own shelf life. */
export const DEFAULT_CHILLED_DAYS: Record<'chilled_7' | 'chilled_4', number> = {
  chilled_7: 2,
  chilled_4: 3,
};

/** Below this, a shelf life in hours is printed with the time it ends, not only the day. */
export const SHOW_TIME_UNDER_HOURS = 48;

/**
 * Reading the note is mirrored in SQL by the migration that added the choice
 * (Server/drizzle/0027_recipe_kept.sql), which filled it in for the recipes a
 * kitchen already had. Server/src/db/kept.test.ts holds the two to the same
 * answers. That migration has run once and for all, so a word added here
 * only changes how recipes still unchosen are read.
 *
 * Words for each way of keeping, in the five languages Mise speaks, without
 * accents (the note is read without them too, so "réfrigéré" and "refrigere"
 * both count). Storage on a recipe is written by hand ("vac-packed in the
 * walk-in", "koelcel"), so this reads it the way a cook would.
 */
const WORDS: Record<'chilled' | 'frozen' | 'ambient', string[]> = {
  chilled: [
    'chill',
    'fridge',
    'walk-in',
    'walk in',
    'cold room',
    'cool room',
    'koel',
    'gekoeld',
    'kuhl',
    'gekuhlt',
    'refrig',
    'frigo',
    'chambre froide',
    'nevera',
    'camara',
    'frigorific',
  ],
  frozen: [
    'freez',
    'frozen',
    'vriez',
    'vries',
    'diepvries',
    'invries',
    'ingevroren',
    'bevroren',
    'tiefkuhl',
    'gefror',
    'gefrier',
    'congel',
    'surgel',
  ],
  ambient: [
    'dry',
    'ambient',
    'room temp',
    'pantry',
    'droog',
    'kamertemperatuur',
    'trocken',
    'raumtemperatur',
    'au sec',
    'ambiante',
    'seco',
    'ambiente',
    'despensa',
  ],
};

/**
 * "4 °C", "4°", "-18C", "3 graden": a temperature written in the storage note.
 * A typed minus can be a hyphen, a real minus sign or a dash: −18 °C is frozen.
 */
const TEMPERATURE =
  /([-\u2212\u2013]?\d+(?:[.,]\d+)?)\s*(?:°\s*c?|c\b|graden|grad\b|degrees|degres|grados)/iu;

/** Lower case and without accents: "Kühlraum" reads as "kuhlraum". */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function mentions(note: string, words: string[]): boolean {
  const text = plain(note);
  // A word on its own or at the start of one: "dry" but not "sundry".
  return words.some((word) =>
    new RegExp(`(?<![\\p{L}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text),
  );
}

/**
 * How a recipe's storage note says it is kept. Null when it doesn't say, or
 * says something Mise can't place.
 *
 * A temperature, when there is one, decides. Otherwise chilled wins over
 * frozen when both are mentioned ("frozen, thaw in the fridge"): it gives the
 * shorter date, so a doubt never makes a batch last longer.
 */
export function keptAs(storage: string | null | undefined): Exclude<KeptAs, 'hot'> | null {
  const text = storage?.trim();
  if (!text) return null;
  const degrees = TEMPERATURE.exec(plain(text));
  if (degrees) {
    const value = Number(degrees[1]!.replace(',', '.').replace(/[\u2212\u2013]/u, '-'));
    if (value <= -12) return 'frozen';
    if (value <= 4) return 'chilled_4';
    if (value <= 7) return 'chilled_7';
    // Warmer than 7 °C is not chilled by the code: no default either way.
    return mentions(text, WORDS.ambient) ? 'ambient' : null;
  }
  if (mentions(text, WORDS.chilled)) return 'chilled_7';
  if (mentions(text, WORDS.frozen)) return 'frozen';
  if (mentions(text, WORDS.ambient)) return 'ambient';
  return null;
}

/**
 * How a recipe's batches are kept: the chef's choice, or else what its storage
 * note says. `kept` is undefined on a copy saved offline before the choice
 * existed, and null on a recipe nobody has chosen for yet.
 */
export function keptFor(recipe: { kept?: KeptAs | null; storage?: string | null }): KeptAs | null {
  return recipe.kept ?? keptAs(recipe.storage);
}

export type UseBy =
  /** From the recipe's own shelf life. */
  | { kind: 'shelfLife'; at: Date; withTime: boolean }
  /** The Hygiënecode default for chilled prep; the chef can override it with a shelf life. */
  | { kind: 'default'; at: Date; withTime: false; days: number }
  /** No date to print: written in by hand. */
  | { kind: 'blank'; reason: 'frozen' | 'ambient' | 'hot' | 'unknown' };

/** The last minute of the day `days` calendar days after `made`, in local time. */
function endOfDayAfter(made: Date, days: number): Date {
  // The date parts carry over by themselves: 30 January plus 2 is 1 February.
  // 23:59 rather than midnight, so it is still that day on any clock.
  return new Date(made.getFullYear(), made.getMonth(), made.getDate() + days, 23, 59, 0, 0);
}

/**
 * Until when a batch made at `made` may be used.
 *
 * A shelf life in hours is counted in real hours from when it was made, so
 * 24 hours across a clock change is still 24 hours. Of 48 hours and more only
 * the day is printed, the way kitchens count days.
 */
export function computeUseBy(input: {
  made: Date;
  shelfLifeHours: number | null | undefined;
  kept: KeptAs | null;
}): UseBy {
  const { made, shelfLifeHours, kept } = input;
  if (shelfLifeHours && shelfLifeHours > 0) {
    return {
      kind: 'shelfLife',
      at: new Date(made.getTime() + shelfLifeHours * 60 * 60 * 1000),
      withTime: shelfLifeHours < SHOW_TIME_UNDER_HOURS,
    };
  }
  if (kept === 'chilled_7' || kept === 'chilled_4') {
    const days = DEFAULT_CHILLED_DAYS[kept];
    return { kind: 'default', at: endOfDayAfter(made, days), withTime: false, days };
  }
  return { kind: 'blank', reason: kept ?? 'unknown' };
}
