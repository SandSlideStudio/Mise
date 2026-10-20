import { BASE_UNIT_FOR, convert, dimensionOf, fromBase, toBase, unit } from './units.js';
import type { Quantity, UnitCode } from './units.js';

/**
 * Rounding for people holding knives.
 *
 * Raw scaling produces numbers like 2.4 eggs and 1483.33 g. Neither is
 * actionable on a Tuesday afternoon. Counts round up, because you cannot prep
 * four fifths of a shallot and running short mid-service is worse than one
 * spare. Weights and volumes round to a precision that a kitchen scale can
 * actually read.
 */

export type RoundingMode = 'nearest' | 'up';

/** Smallest meaningful step for a unit, chosen by how big the number is. */
function stepFor(u: UnitCode, value: number): number {
  switch (u) {
    case 'mg':
      return 1;
    case 'g':
    case 'ml':
      // Spices and cures are weighed to a tenth; bulk prep is not.
      return Math.abs(value) < 10 ? 0.1 : 1;
    case 'cl':
    case 'dl':
      return 0.1;
    case 'kg':
    case 'l':
      return 0.01;
    case 'oz':
    case 'lb':
    case 'floz':
      return 0.01;
    case 'tsp':
    case 'tbsp':
    case 'cup':
    case 'pt':
    case 'qt':
      // Measuring spoons and cups come in quarters.
      return 0.25;
    case 'each':
    case 'dozen':
      return 1;
  }
}

function roundToStep(value: number, step: number, mode: RoundingMode): number {
  const scaled = value / step;
  const rounded = mode === 'up' ? Math.ceil(scaled - 1e-9) : Math.round(scaled);
  // Re-round to kill floating point dust like 0.30000000000000004.
  return Number((rounded * step).toFixed(10));
}

/**
 * Round a quantity to something a cook can execute. Counts default to rounding
 * up; everything else to nearest.
 */
export function roundForKitchen(q: Quantity, mode?: RoundingMode): Quantity {
  const effective = mode ?? (dimensionOf(q.unit) === 'count' ? 'up' : 'nearest');
  const step = stepFor(q.unit, q.value);
  const value = roundToStep(q.value, step, effective);
  // A real amount never rounds away to nothing: a pinch of salt is still salt.
  if (value === 0 && q.value !== 0) return { value: Math.sign(q.value) * step, unit: q.unit };
  return { value, unit: q.unit };
}

/**
 * Pick the unit a chef would actually write, then round to it.
 *
 * 1500 g reads as 1.5 kg, 0.4 l reads as 400 ml. Only ever moves within the
 * quantity's own dimension and its own measurement system, so an imperial
 * kitchen is never handed grams.
 */
export function humanize(q: Quantity, mode?: RoundingMode): Quantity {
  const dimension = dimensionOf(q.unit);
  const system = unit(q.unit).system;
  const base = toBase(q);
  const magnitude = Math.abs(base);

  let target: UnitCode = q.unit;

  if (dimension === 'mass') {
    if (system === 'imperial') {
      target = magnitude >= 453.59237 ? 'lb' : 'oz';
    } else {
      target = magnitude >= 1000 ? 'kg' : magnitude < 1 ? 'mg' : 'g';
    }
  } else if (dimension === 'volume') {
    if (system === 'imperial') {
      // Below a tablespoon, teaspoons: a quarter teaspoon is not 0 tbsp.
      target =
        magnitude >= 946.352946
          ? 'qt'
          : magnitude >= 29.5735295625
            ? 'floz'
            : magnitude >= 14.78676478125
              ? 'tbsp'
              : 'tsp';
    } else {
      target = magnitude >= 1000 ? 'l' : 'ml';
    }
  } else {
    target = q.unit === 'dozen' && magnitude >= 12 ? 'dozen' : 'each';
  }

  return roundForKitchen(fromBase(base, target), mode);
}

/**
 * Format for display. Trims trailing zeros so 1.50 kg prints as 1.5 kg.
 */
export function formatQuantity(q: Quantity, opts: { abbreviate?: boolean } = {}): string {
  const def = unit(q.unit);
  const value = Number(q.value.toFixed(3));
  const label = opts.abbreviate === false ? def.name : def.abbr;

  if (q.unit === 'each') {
    // "12 ea" is noise. A bare count reads better.
    return String(value);
  }
  return `${value} ${label}`;
}

/** Convenience: humanize a base-unit amount and format it in one step. */
export function formatBase(baseValue: number, baseUnit: UnitCode): string {
  return formatQuantity(humanize(fromBase(baseValue, BASE_UNIT_FOR[dimensionOf(baseUnit)])));
}

/**
 * Round a quantity after converting it to a preferred unit, when that
 * conversion is possible without ingredient context.
 */
export function roundInUnit(q: Quantity, target: UnitCode, mode?: RoundingMode): Quantity {
  const converted = convert(q, target);
  return roundForKitchen(converted.ok ? converted.value : q, mode);
}
