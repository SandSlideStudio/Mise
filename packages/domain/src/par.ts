import { humanize } from './rounding.js';
import { convert, fromBase, qty, toBase, type Quantity } from './units.js';

/**
 * Par levels: how much of something the chef wants ready at the start of the
 * day. A cook says how much is already there, and the prep list only asks for
 * the rest.
 */

export type ParOutcome =
  /** Make this much: the par less what is there, rounded so a cook can weigh it. */
  | { kind: 'make'; make: Quantity; par: Quantity; onHand: Quantity }
  /** What is there already reaches the par: nothing to make. */
  | { kind: 'enough'; par: Quantity; onHand: Quantity }
  /**
   * What is there was counted in a unit the par can't be compared with, such
   * as grams against a par in litres after a chef changed the par. Nothing is
   * guessed: the line goes on without an amount, as before pars existed.
   */
  | { kind: 'unknown'; par: Quantity };

/**
 * What to make to bring something up to its par.
 *
 * `onHand` null means nobody said, which is the same as nothing there: an
 * empty box on a tablet, or a tablet from before pars, asks for the whole par.
 * The shortfall rounds up, never down, because finding out mid-service that
 * there is 40 ml too little is worse than 40 ml spare.
 */
export function toMakeForPar(par: Quantity, onHand: Quantity | null): ParOutcome {
  const there = onHand ?? qty(0, par.unit);
  const inParUnit = convert(there, par.unit);
  if (!inParUnit.ok) return { kind: 'unknown', par };

  const shortBase = toBase(par) - toBase(inParUnit.value);
  // Float dust from the conversion is not something to make.
  if (shortBase <= toBase(par) * 1e-9) return { kind: 'enough', par, onHand: there };

  // A par in dozens that is a few short asks for those few, not another dozen.
  const unit = par.unit === 'dozen' && Math.abs(shortBase % 12) > 1e-9 ? 'each' : par.unit;
  return { kind: 'make', make: humanize(fromBase(shortBase, unit), 'up'), par, onHand: there };
}
