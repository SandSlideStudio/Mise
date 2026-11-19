import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeUseBy, keptAs, keptFor } from './useby.js';

/**
 * The use-by on a prep label. Counted in the kitchen's own days, so these run
 * in Amsterdam time, where summer time starts on the last Sunday of March and
 * ends on the last Sunday of October.
 */

beforeAll(() => {
  vi.stubEnv('TZ', 'Europe/Amsterdam');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

/** A local date and time, as the tablet's clock shows it. */
function local(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(y, m - 1, d, h, min);
}

/** The local day and time of a date, to compare without thinking in UTC. */
function shown(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

describe('the default use-by for chilled prep', () => {
  it('runs this time zone', () => {
    // Winter: an hour ahead of UTC.
    expect(local(2027, 1, 15).getTimezoneOffset()).toBe(-60);
  });

  it('is the end of the second day after the day it was made, at 7 °C', () => {
    const result = computeUseBy({
      made: local(2027, 4, 5, 14, 30),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    expect(result.kind).toBe('default');
    if (result.kind !== 'default') return;
    // Made Monday: good until Wednesday night, whatever the hour it was made.
    expect(shown(result.at)).toBe('2027-04-07 23:59');
    expect(result.withTime).toBe(false);
    expect(result.days).toBe(2);
  });

  it('is the same day whether made early or late', () => {
    const early = computeUseBy({
      made: local(2027, 4, 5, 6, 0),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    const late = computeUseBy({
      made: local(2027, 4, 5, 23, 45),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    expect(early.kind === 'default' && shown(early.at)).toBe('2027-04-07 23:59');
    expect(late.kind === 'default' && shown(late.at)).toBe('2027-04-07 23:59');
  });

  it('gives a day more at 4 °C', () => {
    const result = computeUseBy({
      made: local(2027, 4, 5, 9),
      shelfLifeHours: null,
      kept: 'chilled_4',
    });
    expect(result.kind === 'default' && shown(result.at)).toBe('2027-04-08 23:59');
  });

  it('carries over the end of a month and a year', () => {
    const april = computeUseBy({
      made: local(2027, 4, 29, 12),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    expect(april.kind === 'default' && shown(april.at)).toBe('2027-05-01 23:59');
    const february = computeUseBy({
      made: local(2028, 2, 28, 12),
      shelfLifeHours: null,
      kept: 'chilled_4',
    });
    // 2028 is a leap year.
    expect(february.kind === 'default' && shown(february.at)).toBe('2028-03-02 23:59');
    const december = computeUseBy({
      made: local(2027, 12, 30, 20),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    expect(december.kind === 'default' && shown(december.at)).toBe('2028-01-01 23:59');
  });

  it('counts days, not hours, across a change of the clocks', () => {
    // Summer time starts on Sunday 28 March 2027: that day has 23 hours.
    const spring = computeUseBy({
      made: local(2027, 3, 27, 22),
      shelfLifeHours: null,
      kept: 'chilled_7',
    });
    expect(spring.kind === 'default' && shown(spring.at)).toBe('2027-03-29 23:59');
    // And ends on Sunday 31 October 2027: that day has 25 hours.
    const autumn = computeUseBy({
      made: local(2027, 10, 30, 1),
      shelfLifeHours: null,
      kept: 'chilled_4',
    });
    expect(autumn.kind === 'default' && shown(autumn.at)).toBe('2027-11-02 23:59');
  });
});

describe("the recipe's own shelf life", () => {
  it('wins over the default', () => {
    const result = computeUseBy({
      made: local(2027, 4, 5, 10),
      shelfLifeHours: 120,
      kept: 'chilled_7',
    });
    expect(result.kind).toBe('shelfLife');
    expect(shown(result.kind === 'shelfLife' ? result.at : new Date(0))).toBe('2027-04-10 10:00');
  });

  it('prints the time it ends, however long it keeps', () => {
    const short = computeUseBy({ made: local(2027, 4, 5, 10), shelfLifeHours: 12, kept: null });
    expect(short.kind === 'shelfLife' && short.withTime).toBe(true);
    expect(short.kind === 'shelfLife' && shown(short.at)).toBe('2027-04-05 22:00');
    // Made Monday 20:00, 48 hours: Wednesday 20:00, not Wednesday night.
    const two = computeUseBy({ made: local(2027, 4, 5, 20), shelfLifeHours: 48, kept: null });
    expect(two.kind === 'shelfLife' && two.withTime).toBe(true);
    expect(two.kind === 'shelfLife' && shown(two.at)).toBe('2027-04-07 20:00');
    const week = computeUseBy({ made: local(2027, 4, 5, 10), shelfLifeHours: 168, kept: null });
    expect(week.kind === 'shelfLife' && week.withTime).toBe(true);
  });

  it('counts real hours across a change of the clocks', () => {
    // 24 hours from Saturday 22:00 before summer time is Sunday 23:00 on the new clock.
    const result = computeUseBy({ made: local(2027, 3, 27, 22), shelfLifeHours: 24, kept: null });
    expect(result.kind === 'shelfLife' && shown(result.at)).toBe('2027-03-28 23:00');
  });

  it('applies to frozen and dry stock too', () => {
    const frozen = computeUseBy({
      made: local(2027, 4, 5),
      shelfLifeHours: 24 * 90,
      kept: 'frozen',
    });
    expect(frozen.kind).toBe('shelfLife');
  });
});

describe('without a date', () => {
  it('leaves frozen, dry, hot-held and unknown stock blank', () => {
    const made = local(2027, 4, 5);
    expect(computeUseBy({ made, shelfLifeHours: null, kept: 'frozen' })).toEqual({
      kind: 'blank',
      reason: 'frozen',
    });
    expect(computeUseBy({ made, shelfLifeHours: null, kept: 'ambient' })).toEqual({
      kind: 'blank',
      reason: 'ambient',
    });
    // Hot holding is limited by hours on the pass, not by a date.
    expect(computeUseBy({ made, shelfLifeHours: null, kept: 'hot' })).toEqual({
      kind: 'blank',
      reason: 'hot',
    });
    expect(computeUseBy({ made, shelfLifeHours: null, kept: null })).toEqual({
      kind: 'blank',
      reason: 'unknown',
    });
  });
});

describe('the choice on the recipe', () => {
  it('wins over what the storage note says', () => {
    expect(keptFor({ kept: 'chilled_4', storage: 'Freezer' })).toBe('chilled_4');
    expect(keptFor({ kept: 'hot', storage: 'Koelcel' })).toBe('hot');
  });

  it('falls back on the note when nobody has chosen yet', () => {
    expect(keptFor({ kept: null, storage: 'Koelcel, 4 °C' })).toBe('chilled_4');
    // An offline copy from before the choice existed has no field at all.
    expect(keptFor({ storage: 'Diepvries' })).toBe('frozen');
    expect(keptFor({ kept: null, storage: null })).toBe(null);
  });
});

describe('reading how a recipe is kept', () => {
  it('reads chilled in every language', () => {
    for (const note of [
      'Vac-packed in the walk-in',
      'In the fridge',
      'Koelcel',
      'gekoeld bewaren',
      'Kühlschrank',
      'gekühlt',
      'Chambre froide',
      'au réfrigérateur',
      'En la nevera',
      'cámara frigorífica',
    ]) {
      expect(keptAs(note), note).toBe('chilled_7');
    }
  });

  it('reads frozen and dry', () => {
    for (const note of [
      'Freezer',
      'frozen in portions',
      'Diepvries',
      'Tiefkühler',
      'Congélateur',
      'congelado',
    ]) {
      expect(keptAs(note), note).toBe('frozen');
    }
    for (const note of [
      'Dry store',
      'Ambient',
      'Droog en donker',
      'trocken lagern',
      'En despensa',
    ]) {
      expect(keptAs(note), note).toBe('ambient');
    }
  });

  it('goes by a temperature when there is one', () => {
    expect(keptAs('Koelcel, 3 °C')).toBe('chilled_4');
    expect(keptAs('fridge at 4°C')).toBe('chilled_4');
    expect(keptAs('Walk-in, 6 °C')).toBe('chilled_7');
    expect(keptAs('-18 °C')).toBe('frozen');
    // A real minus sign, or a dash, as a phone or a word processor types it.
    expect(keptAs('\u221218 °C')).toBe('frozen');
    expect(keptAs('Vriezer \u201320°C')).toBe('frozen');
    expect(keptAs('kept at 12 graden')).toBe(null);
  });

  it('reads a range by its warmest end, not as a temperature below zero', () => {
    expect(keptAs('2-7 °C')).toBe('chilled_7');
    expect(keptAs('Koelcel 0–4°C')).toBe('chilled_4');
    // Warmer than 7 °C at its warmest: not chilled by the code.
    expect(keptAs('fridge 2-8°C')).toBe(null);
    expect(keptAs('0 - 7 °C')).toBe('chilled_7');
    expect(keptAs('Vriezer -22 - -18 °C')).toBe('frozen');
  });

  it('takes chilled when both are said, which gives the shorter date', () => {
    expect(keptAs('Frozen, thaw in the fridge')).toBe('chilled_7');
  });

  it("says nothing it can't place", () => {
    expect(keptAs(null)).toBe(null);
    expect(keptAs('')).toBe(null);
    expect(keptAs('Gastro 1/1, cling film')).toBe(null);
    // Not "dry" inside another word.
    expect(keptAs('Sundry tub')).toBe(null);
  });
});
