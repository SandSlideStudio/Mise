import { useSyncExternalStore } from 'react';
import { createEntryStore } from './entryStore.js';

/**
 * Changes made while Mise couldn't be reached, waiting to be sent.
 *
 * Kept in localStorage so a reload, or a tablet put away for the night, loses
 * nothing. Sent in the order they were made, each with its own id, which the
 * server uses to make each change exactly once however often it is sent.
 * Every entry belongs to the person who made it: on a shared tablet, the next
 * cook never sends someone else's changes under their own name.
 *
 * Each change sits under its own key, so two tabs adding at the same moment
 * can't overwrite each other (see entryStore.ts).
 *
 * Ticks have their own, older queue (retryQueue.ts); this is everything else.
 */

/** Where versions before 2.3 kept the whole list under one key. */
const LEGACY_KEY = 'mise.outbox';

/** A line added while Mise couldn't be reached carries this in front of its id until it's sent. */
export const WAITING = 'waiting:';
export const isWaiting = (id: string) => id.startsWith(WAITING);

export interface OutboxEntry {
  /** Sent as X-Mise-Write. */
  id: string;
  userId: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  /** The version the edit started from, sent as X-Mise-Base until a conflict is settled. */
  base?: string;
  /** What to call it on screen: a message key and its values. */
  label: { key: string; vars?: Record<string, string> };
  queuedAt: number;
  /** Set when the server says someone changed it meanwhile: what is there now. */
  conflict?: { current: unknown };
  /** Server errors in a row, and when to try again. */
  failures?: number;
  retryAt?: number;
  /**
   * Set aside after failing again and again: it no longer holds up changes to
   * other things, and waits for the person to try again or let it go.
   */
  setAside?: { status: number };
}

/** 128 random bits. crypto.randomUUID only exists over HTTPS; this works over plain HTTP too. */
export function newWriteId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let version = 0;
const listeners = new Set<() => void>();

const store = createEntryStore<OutboxEntry>({
  prefix: 'mise.outbox.',
  legacyKey: LEGACY_KEY,
  isEntry: (value): value is OutboxEntry =>
    typeof value === 'object' &&
    value !== null &&
    Boolean((value as OutboxEntry).id) &&
    Boolean((value as OutboxEntry).userId),
});

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function save(entry: OutboxEntry): void {
  try {
    store.put(entry);
  } catch {
    // Storage blocked or full: the change can't wait here, and the caller says so.
    throw new Error('outbox_unavailable');
  }
  changed();
}

/**
 * Changes made within the same millisecond still go out in the order they
 * were made: the ids are random, so the time has to tell them apart.
 */
let lastQueuedAt = 0;

export function add(entry: Omit<OutboxEntry, 'queuedAt'>): OutboxEntry {
  lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1);
  const full: OutboxEntry = { ...entry, queuedAt: lastQueuedAt };
  save(full);
  return full;
}

export function entriesFor(userId: string): OutboxEntry[] {
  return store.all().filter((entry) => entry.userId === userId);
}

/**
 * Changes that are going out, as opposed to waiting on the person: not set
 * aside, and not behind one that is.
 */
export function goingOut(entries: OutboxEntry[]): OutboxEntry[] {
  const stuck = new Set(entries.filter((entry) => entry.setAside).map((entry) => entry.path));
  return entries.filter((entry) => !stuck.has(entry.path));
}

export function remove(id: string): void {
  store.delete(id);
  changed();
}

export function update(id: string, change: Partial<OutboxEntry>): void {
  // Read it afresh: if another tab sent it meanwhile, it stays gone.
  const current = store.get(id);
  if (current) save({ ...current, ...change });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** This person's waiting changes, kept up to date. */
export function useOutbox(userId: string | null | undefined): OutboxEntry[] {
  useSyncExternalStore(subscribe, () => version);
  return userId ? entriesFor(userId) : [];
}

// Another tab on the same tablet changed the list.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (store.owns(event.key)) changed();
  });
}
