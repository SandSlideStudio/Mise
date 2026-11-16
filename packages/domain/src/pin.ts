/**
 * PINs too easy to guess.
 *
 * When a tablet signs in by PIN alone, a stranger at it doesn't need to know
 * whose PIN to try: any one that works lets them in. The first ones anybody
 * tries are the ones people pick without thinking, so those are refused.
 *
 * The rules are plain on purpose, so a head chef can say why a PIN was turned
 * down: one digit over and over, a run up or down, a short block repeated,
 * doubled digits, a straight line on the keypad, or one of the PINs that turn
 * up at the top of every list of the most used.
 */

/** Runs count from 0 to 9 and on to 0 again, the way the top row of a keyboard goes. */
const UP = '01234567890';
const DOWN = '09876543210';

/**
 * The straight lines of three on a phone keypad, either way round: rows,
 * columns and both diagonals.
 *
 *   1 2 3
 *   4 5 6
 *   7 8 9
 *     0
 */
const LINES = new Set(
  ['123', '456', '789', '147', '258', '369', '159', '357'].flatMap((line) => [
    line,
    [...line].reverse().join(''),
  ]),
);

/**
 * The ones that top every list of the PINs people choose most, past what the
 * rules above already catch: dates, years and words spelled on the keypad.
 */
const MOST_GUESSED = new Set([
  '0007',
  '0070',
  '0101',
  '0420',
  '0911',
  '1001',
  '1004',
  '1007',
  '1100',
  '1225',
  '1979',
  '1984',
  '1990',
  '1999',
  '2000',
  '2001',
  '2002',
  '2010',
  '2020',
  '2468',
  '1357',
  '1379',
  '1397',
  '4200',
  '5683',
  '7531',
  '8642',
  '9731',
  '102030',
]);

/** One block over and over: 1212, 6969, 123123, and 0000 too. */
function repeatsABlock(pin: string): boolean {
  for (let size = 1; size <= pin.length / 2; size += 1) {
    if (pin.length % size === 0 && pin.slice(0, size).repeat(pin.length / size) === pin) {
      return true;
    }
  }
  return false;
}

/** Each digit twice: 1122, 112233. */
function doublesEachDigit(pin: string): boolean {
  if (pin.length % 2 !== 0) return false;
  for (let i = 0; i < pin.length; i += 2) if (pin[i] !== pin[i + 1]) return false;
  return true;
}

/**
 * Lines on the keypad, with or without the 0 below them: 2580, 0852, 1470,
 * 7530, and two lines after each other, such as 147258 or 159753.
 */
function followsKeypadLines(pin: string): boolean {
  let rest = pin;
  if (rest.length % 3 === 1) {
    if (rest.endsWith('0')) rest = rest.slice(0, -1);
    else if (rest.startsWith('0')) rest = rest.slice(1);
  }
  if (rest.length === 0 || rest.length % 3 !== 0) return false;
  for (let i = 0; i < rest.length; i += 3) if (!LINES.has(rest.slice(i, i + 3))) return false;
  return true;
}

/** Whether a PIN is one of the first anybody would try. */
export function isCommonPin(pin: string): boolean {
  return (
    repeatsABlock(pin) ||
    UP.includes(pin) ||
    DOWN.includes(pin) ||
    doublesEachDigit(pin) ||
    followsKeypadLines(pin) ||
    MOST_GUESSED.has(pin)
  );
}
