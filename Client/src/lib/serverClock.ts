/**
 * The server's time, as seen from this device.
 *
 * A kitchen tablet's clock can be minutes or hours off. Things that depend on
 * the time of day the server keeps (a ticked line dropping off the list two
 * hours after it was ticked) use the server's clock instead: every answer from
 * Mise carries its time in the Date header, and the difference is kept here.
 */

let offsetMs = 0;

/** Note the server's time from an answer that just came in. */
export function noteServerDate(header: string | null, sentAt: number, receivedAt: number): void {
  if (!header) return;
  const stated = Date.parse(header);
  if (Number.isNaN(stated)) return;
  // The header is in whole seconds, rounded down, and was written somewhere
  // between sending and receiving.
  const serverAt = stated + 500;
  const localAt = sentAt + (receivedAt - sentAt) / 2;
  offsetMs = serverAt - localAt;
}

/** Now, by the server's clock. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}

/** For tests. */
export function resetServerClock(): void {
  offsetMs = 0;
}
