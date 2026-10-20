import { err, ok, type Result } from './result.js';

/**
 * Units and conversion.
 *
 * Three dimensions matter in a kitchen: mass, volume and count. Each has one
 * canonical base unit that everything is stored in — grams, millilitres, each.
 * Converting inside a dimension is arithmetic. Converting across dimensions is
 * a property of the *ingredient*, not of the units, so it needs context: water
 * and flour do not weigh the same per litre.
 */

export type Dimension = 'mass' | 'volume' | 'count';

export type MassUnit = 'mg' | 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'cl' | 'dl' | 'l' | 'tsp' | 'tbsp' | 'floz' | 'cup' | 'pt' | 'qt';
export type CountUnit = 'each' | 'dozen';
export type UnitCode = MassUnit | VolumeUnit | CountUnit;

/** The unit every quantity of a given dimension is stored in. */
export type BaseUnit = 'g' | 'ml' | 'each';

export interface UnitDef {
  code: UnitCode;
  /** Singular display name. */
  name: string;
  /** Short label used in dense views like prep lists. */
  abbr: string;
  dimension: Dimension;
  /** How many base units one of this unit equals. */
  toBase: number;
  system: 'metric' | 'imperial' | 'universal';
}

/**
 * Imperial volumes are US customary. A kitchen working in imperial should be
 * told which gallon it is getting, because the UK one differs by a fifth.
 */
const UNIT_LIST: UnitDef[] = [
  { code: 'mg', name: 'milligram', abbr: 'mg', dimension: 'mass', toBase: 0.001, system: 'metric' },
  { code: 'g', name: 'gram', abbr: 'g', dimension: 'mass', toBase: 1, system: 'metric' },
  { code: 'kg', name: 'kilogram', abbr: 'kg', dimension: 'mass', toBase: 1000, system: 'metric' },
  {
    code: 'oz',
    name: 'ounce',
    abbr: 'oz',
    dimension: 'mass',
    toBase: 28.349523125,
    system: 'imperial',
  },
  {
    code: 'lb',
    name: 'pound',
    abbr: 'lb',
    dimension: 'mass',
    toBase: 453.59237,
    system: 'imperial',
  },

  { code: 'ml', name: 'millilitre', abbr: 'ml', dimension: 'volume', toBase: 1, system: 'metric' },
  { code: 'cl', name: 'centilitre', abbr: 'cl', dimension: 'volume', toBase: 10, system: 'metric' },
  { code: 'dl', name: 'decilitre', abbr: 'dl', dimension: 'volume', toBase: 100, system: 'metric' },
  { code: 'l', name: 'litre', abbr: 'l', dimension: 'volume', toBase: 1000, system: 'metric' },
  {
    code: 'tsp',
    name: 'teaspoon',
    abbr: 'tsp',
    dimension: 'volume',
    toBase: 4.92892159375,
    system: 'imperial',
  },
  {
    code: 'tbsp',
    name: 'tablespoon',
    abbr: 'tbsp',
    dimension: 'volume',
    toBase: 14.78676478125,
    system: 'imperial',
  },
  {
    code: 'floz',
    name: 'fluid ounce',
    abbr: 'fl oz',
    dimension: 'volume',
    toBase: 29.5735295625,
    system: 'imperial',
  },
  {
    code: 'cup',
    name: 'cup',
    abbr: 'cup',
    dimension: 'volume',
    toBase: 236.5882365,
    system: 'imperial',
  },
  {
    code: 'pt',
    name: 'pint',
    abbr: 'pt',
    dimension: 'volume',
    toBase: 473.176473,
    system: 'imperial',
  },
  {
    code: 'qt',
    name: 'quart',
    abbr: 'qt',
    dimension: 'volume',
    toBase: 946.352946,
    system: 'imperial',
  },

  { code: 'each', name: 'each', abbr: 'ea', dimension: 'count', toBase: 1, system: 'universal' },
  { code: 'dozen', name: 'dozen', abbr: 'dz', dimension: 'count', toBase: 12, system: 'universal' },
];

const UNITS = new Map<string, UnitDef>(UNIT_LIST.map((u) => [u.code, u]));

export const ALL_UNITS: readonly UnitDef[] = UNIT_LIST;

export const BASE_UNIT_FOR: Record<Dimension, BaseUnit> = {
  mass: 'g',
  volume: 'ml',
  count: 'each',
};

export function isUnitCode(code: string): code is UnitCode {
  return UNITS.has(code);
}

/** Look up a unit, throwing on an unknown code. Codes come from a closed set. */
export function unit(code: UnitCode): UnitDef {
  const def = UNITS.get(code);
  if (!def) throw new Error(`Unknown unit code: ${code}`);
  return def;
}

export function dimensionOf(code: UnitCode): Dimension {
  return unit(code).dimension;
}

export function baseUnitOf(code: UnitCode): BaseUnit {
  return BASE_UNIT_FOR[dimensionOf(code)];
}

export function unitsForDimension(dimension: Dimension): UnitDef[] {
  return UNIT_LIST.filter((u) => u.dimension === dimension);
}

// --- quantities -----------------------------------------------------------

export interface Quantity {
  value: number;
  unit: UnitCode;
}

export function qty(value: number, u: UnitCode): Quantity {
  return { value, unit: u };
}

/** Convert to the canonical base unit of the quantity's own dimension. */
export function toBase(q: Quantity): number {
  return q.value * unit(q.unit).toBase;
}

/** Build a quantity from a base-unit amount. */
export function fromBase(value: number, u: UnitCode): Quantity {
  return { value: value / unit(u).toBase, unit: u };
}

// --- conversion -----------------------------------------------------------

/**
 * What we know about an ingredient that lets us cross dimensions.
 * All optional, because most ingredients only ever need one dimension.
 */
export interface ConversionContext {
  /** Grams per millilitre. Water is 1, oil about 0.92, flour about 0.53 packed loose. */
  densityGPerMl?: number | null;
  /** Grams for one item. One large egg is about 50 g out of the shell. */
  itemWeightG?: number | null;
  /** Millilitres for one item, when an item is measured by volume. */
  itemVolumeMl?: number | null;
}

export type ConversionError =
  | { kind: 'missing_density'; from: Dimension; to: Dimension }
  | { kind: 'missing_item_weight'; from: Dimension; to: Dimension }
  | { kind: 'missing_item_volume'; from: Dimension; to: Dimension };

/**
 * Convert a quantity to another unit.
 *
 * Within a dimension this always succeeds. Across dimensions it needs the
 * ingredient context and returns a typed failure when that context is absent,
 * rather than silently assuming water.
 */
export function convert(
  q: Quantity,
  to: UnitCode,
  context: ConversionContext = {},
): Result<Quantity, ConversionError> {
  const from = dimensionOf(q.unit);
  const target = dimensionOf(to);

  if (from === target) {
    return ok(fromBase(toBase(q), to));
  }

  const baseResult = convertBase(toBase(q), from, target, context);
  if (!baseResult.ok) return baseResult;
  return ok(fromBase(baseResult.value, to));
}

/** Cross-dimension conversion in base units: g <-> ml <-> each. */
function convertBase(
  value: number,
  from: Dimension,
  to: Dimension,
  ctx: ConversionContext,
): Result<number, ConversionError> {
  const density = ctx.densityGPerMl ?? null;
  const itemWeight = ctx.itemWeightG ?? null;
  // An item's volume can be derived when we know both its weight and density.
  const itemVolume =
    ctx.itemVolumeMl ?? (itemWeight !== null && density ? itemWeight / density : null);

  if (from === 'mass' && to === 'volume') {
    if (!density) return err({ kind: 'missing_density', from, to });
    return ok(value / density);
  }
  if (from === 'volume' && to === 'mass') {
    if (!density) return err({ kind: 'missing_density', from, to });
    return ok(value * density);
  }
  if (from === 'count' && to === 'mass') {
    if (!itemWeight) return err({ kind: 'missing_item_weight', from, to });
    return ok(value * itemWeight);
  }
  if (from === 'mass' && to === 'count') {
    if (!itemWeight) return err({ kind: 'missing_item_weight', from, to });
    return ok(value / itemWeight);
  }
  if (from === 'count' && to === 'volume') {
    if (!itemVolume) return err({ kind: 'missing_item_volume', from, to });
    return ok(value * itemVolume);
  }
  if (from === 'volume' && to === 'count') {
    if (!itemVolume) return err({ kind: 'missing_item_volume', from, to });
    return ok(value / itemVolume);
  }

  // Same dimension is handled by the caller; nothing else exists.
  return ok(value);
}

/** True when the two units convert without any ingredient context. */
export function sameDimension(a: UnitCode, b: UnitCode): boolean {
  return dimensionOf(a) === dimensionOf(b);
}

/** Human wording for a conversion failure, suitable for showing a chef. */
export function describeConversionError(e: ConversionError, ingredientName?: string): string {
  const who = ingredientName ? `"${ingredientName}"` : 'this ingredient';
  switch (e.kind) {
    case 'missing_density':
      return `Cannot convert between weight and volume for ${who} without a density. Set grams per millilitre on the ingredient.`;
    case 'missing_item_weight':
      return `Cannot convert between count and weight for ${who} without an item weight. Set the weight of one on the ingredient.`;
    case 'missing_item_volume':
      return `Cannot convert between count and volume for ${who} without an item volume.`;
  }
}
