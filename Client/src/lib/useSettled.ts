import { useEffect, useRef, useState } from 'react';

/**
 * Whether a short-lived condition has lasted long enough to say anything
 * about. Every tick is saved on the tablet before it is sent, so "something
 * is waiting" is true for a split second on every tick and a notice for it
 * would only flash. It turns on once `active` has held for `delayMs`, and
 * once on stays on for at least `holdMs` so it doesn't blink away again.
 */
export function useSettled(active: boolean, delayMs = 1000, holdMs = 1500): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active === shown) return;
    const wait = active ? delayMs : Math.max(0, holdMs - (Date.now() - shownAt.current));
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setShown(active);
    }, wait);
    // If it flips back before the timer fires, the change never happened.
    return () => clearTimeout(timer);
  }, [active, shown, delayMs, holdMs]);

  return shown;
}
