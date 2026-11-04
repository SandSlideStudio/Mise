import { useSyncExternalStore } from 'react';

/**
 * Changes made while Mise couldn't be reached, waiting to be sent.
 *
 * Kept in localStorage so a reload, or a tablet put away for the night, loses
 * nothing. Sent in the order they were made, each with its own id, which the
 * server uses to make each change exactly once however often it is sent.
 * Every entry belongs to the person who made it: on a shared tablet, the next
 * cook never sends someone else's changes under their own name.
 *
 * Ticks have their own, older queue (retryQueue.ts); this is everything else.
 */

const STORAGE_KEY = 'mise.outbox';

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

function read(): OutboxEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]).filter((e) => e.id && e.userId) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage blocked or full: the change can't wait here, and the caller says so.
    throw new Error('outbox_unavailable');
  }
  version += 1;
  for (const listener of listeners) listener();
}

export function add(entry: Omit<OutboxEntry, 'queuedAt'>): OutboxEntry {
  const full: OutboxEntry = { ...entry, queuedAt: Date.now() };
  write([...read(), full]);
  return full;
}

export function entriesFor(userId: string): OutboxEntry[] {
  return read().filter((entry) => entry.userId === userId);
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
  write(read().filter((entry) => entry.id !== id));
}

export function update(id: string, change: Partial<OutboxEntry>): void {
  write(read().map((entry) => (entry.id === id ? { ...entry, ...change } : entry)));
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
