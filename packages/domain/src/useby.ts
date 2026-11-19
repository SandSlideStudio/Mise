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
 * same when Mise can't tell from the recipe how it is kept.
 */

/** How a batch is kept, as far as the use-by goes. */
export type KeptAs = 'chilled7' | 'chilled4' | 'frozen' | 'ambient';

/** Days after the day it was made, for chilled prep without its own shelf life. */
export const DEFAULT_CHILLED_DAYS: Record<'chilled7' | 'chilled4', number> = {
  chilled7: 2,
  chilled4: 3,
};

/** Below this, a shelf life in hours is printed with the time it ends, not only the day. */
export const SHOW_TIME_UNDER_HOURS = 48;

/**
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

/** "4 °C", "4°", "-18C", "3 graden": a temperature written in the storage note. */
const TEMPERATURE = /(-?\d+(?:[.,]\d+)?)\s*(?:°\s*c?|c\b|graden|grad\b|degrees|degres|grados)/iu;

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
export function keptAs(storage: string | null | undefined): KeptAs | null {
  const text = storage?.trim();
  if (!text) return null;
  const degrees = TEMPERATURE.exec(plain(text));
  if (degrees) {
    const value = Number(degrees[1]!.replace(',', '.'));
    if (value <= -12) return 'frozen';
    if (value <= 4) return 'chilled4';
    if (value <= 7) return 'chilled7';
    // Warmer than 7 °C is not chilled by the code: no default either way.
    return mentions(text, WORDS.ambient) ? 'ambient' : null;
  }
  if (mentions(text, WORDS.chilled)) return 'chilled7';
  if (mentions(text, WORDS.frozen)) return 'frozen';
  if (mentions(text, WORDS.ambient)) return 'ambient';
  return null;
}

export type UseBy =
  /** From the recipe's own shelf life. */
  | { kind: 'shelfLife'; at: Date; withTime: boolean }
  /** The Hygiënecode default for chilled prep; the chef can override it with a shelf life. */
  | { kind: 'default'; at: Date; withTime: false; days: number }
  /** No date to print: written in by hand. */
  | { kind: 'blank'; reason: 'frozen' | 'ambient' | 'unknown' };

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
export function useBy(input: {
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
  if (kept === 'chilled7' || kept === 'chilled4') {
    const days = DEFAULT_CHILLED_DAYS[kept];
    return { kind: 'default', at: endOfDayAfter(made, days), withTime: false, days };
  }
  return { kind: 'blank', reason: kept ?? 'unknown' };
}
