import { useSyncExternalStore } from 'react';

/**
 * Day or night.
 *
 * By default the screen follows the device. On the pass the device setting is
 * often wrong for the room, so anyone can force it, and the choice is kept on
 * that tablet rather than on the person: the pass tablet at eleven wants night
 * whoever is signed in.
 */

export type ThemeChoice = 'day' | 'night' | 'auto';

const STORAGE_KEY = 'mise.theme';
const listeners = new Set<() => void>();

function read(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'day' || stored === 'night' ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

/** Stamp the choice on the document. Called once before the first render. */
export function applyTheme(choice: ThemeChoice = read()): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Private browsing or a locked-down tablet: the choice lasts this visit.
  }
  applyTheme(choice);
  for (const listener of listeners) listener();
}

/** Whether night is what is actually showing, whichever way it got there. */
export function isNight(): boolean {
  const choice = document.documentElement.getAttribute('data-theme');
  if (choice === 'night') return true;
  if (choice === 'day') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', listener);
  };
}

export function useNight(): [boolean, () => void] {
  const night = useSyncExternalStore(subscribe, isNight, () => false);
  return [night, () => setTheme(night ? 'day' : 'night')];
}
