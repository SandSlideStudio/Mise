/**
 * A list of entries in localStorage, one key per entry.
 *
 * Several tabs (or the installed app next to a browser tab) share one
 * localStorage. When the whole list lived under a single key, every change
 * read it, edited it and wrote it all back, so two tabs changing it at the
 * same instant could each overwrite the other's entry. Here each change
 * touches only the key of the entry it is about, so nothing a tab wrote can
 * be undone by another.
 *
 * Lists written by older versions sat under one key as a JSON array. They are
 * moved over, entry by entry and without overwriting anything already there,
 * the first time they are read.
 */

export interface EntryStoreOptions<T> {
  /** Each entry is kept under `${prefix}${id}`. Must not equal the old key. */
  prefix: string;
  /** Where older versions kept the whole list. */
  legacyKey: string;
  /** Whether a stored value is a whole, usable entry. */
  isEntry: (value: unknown) => value is T;
}

export interface EntryStore<T extends { id: string; queuedAt: number }> {
  /** Every entry, in the order they were made (queuedAt, then id). */
  all(): T[];
  /** One entry, or undefined if it is gone. */
  get(id: string): T | undefined;
  /** Save an entry under its own key. Throws if the browser won't store it. */
  put(entry: T): void;
  /** Forget an entry. */
  delete(id: string): void;
  /** Whether a storage event's key belongs to this list. */
  owns(key: string | null): boolean;
}

export function createEntryStore<T extends { id: string; queuedAt: number }>({
  prefix,
  legacyKey,
  isEntry,
}: EntryStoreOptions<T>): EntryStore<T> {
  function parse(raw: string | null): T | undefined {
    if (raw === null) return undefined;
    try {
      const value: unknown = JSON.parse(raw);
      return isEntry(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  function migrate(): void {
    let raw: string | null;
    try {
      raw = localStorage.getItem(legacyKey);
    } catch {
      return;
    }
    if (raw === null) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const value of parsed) {
          // An entry already under its own key is newer than the old copy
          // (it may have been changed or sent since): the old one never wins.
          if (isEntry(value) && localStorage.getItem(prefix + value.id) === null) {
            localStorage.setItem(prefix + value.id, JSON.stringify(value));
          }
        }
      }
      // Only once every entry is safely over. If storing failed, the old key
      // stays and the next read tries again.
      localStorage.removeItem(legacyKey);
    } catch {
      // Unreadable or storage blocked: leave it where it is.
    }
  }

  return {
    all() {
      try {
        migrate();
        const found: T[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key?.startsWith(prefix)) {
            const entry = parse(localStorage.getItem(key));
            if (entry) found.push(entry);
          }
        }
        return found.sort(
          (a, b) => a.queuedAt - b.queuedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
        );
      } catch {
        return [];
      }
    },
    get(id) {
      try {
        migrate();
        return parse(localStorage.getItem(prefix + id));
      } catch {
        return undefined;
      }
    },
    put(entry) {
      localStorage.setItem(prefix + entry.id, JSON.stringify(entry));
    },
    delete(id) {
      try {
        localStorage.removeItem(prefix + id);
      } catch {
        // Storage blocked: nothing to forget.
      }
    },
    owns(key) {
      // null: the whole storage was cleared.
      return key === null || key === legacyKey || key.startsWith(prefix);
    },
  };
}
