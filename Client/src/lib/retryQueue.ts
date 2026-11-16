import type { PrepTaskStatus } from '@mise/contracts';
import { createEntryStore } from './entryStore.js';

/**
 * Ticks waiting to reach the server, kept in localStorage so a reload or a dead
 * wifi spot doesn't lose them.
 *
 * Every tick is written here before it's sent, and removed only when the
 * server has answered: accepted, or refused for a real reason. Each entry
 * belongs to the person who tapped it, so on a shared tablet the next cook
 * never sends someone else's work under their own name.
 *
 * Each tick sits under its own key, so two tabs ticking at the same moment
 * can't overwrite each other (see entryStore.ts).
 */

/** Where versions before 2.3 kept the whole queue under one key. */
const LEGACY_KEY = 'mise.pendingTicks';

export interface TickPatch {
  status: PrepTaskStatus;
  assignedUserId?: string | null;
}

export interface PendingTick {
  /** This entry, so an answer removes only the tick it belongs to. */
  id: string;
  /** Who tapped it. */
  userId: string;
  taskId: string;
  /** The list it's on: a service id, or the running list. Used to refresh it. */
  listKey: string;
  patch: TickPatch;
  queuedAt: number;
}

let counter = 0;
/** Also sent as X-Mise-Write, so a tick resent after a lost answer is made once. */
const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${(counter += 1)}`;

/** Entries being sent right now, so the background sender doesn't send them twice. */
const inFlight = new Set<string>();

const store = createEntryStore<PendingTick>({
  prefix: 'mise.pendingTicks.',
  legacyKey: LEGACY_KEY,
  // Entries from before ticks carried a person can't be sent safely.
  isEntry: (value): value is PendingTick =>
    typeof value === 'object' &&
    value !== null &&
    Boolean((value as PendingTick).id) &&
    Boolean((value as PendingTick).userId) &&
    Boolean((value as PendingTick).patch),
});

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function save(entry: PendingTick): void {
  try {
    store.put(entry);
  } catch {
    // Storage blocked: the tick is still sent, it just won't survive a reload.
  }
}

/**
 * Save a tick before sending it. An older tick on the same line that hasn't
 * gone out yet is replaced, since only the newest one matters.
 */
/** Ticks made within the same millisecond still keep the order they were made in. */
let lastQueuedAt = 0;

export function enqueue(tick: Omit<PendingTick, 'id' | 'queuedAt'>): PendingTick {
  lastQueuedAt = Math.max(Date.now(), lastQueuedAt + 1);
  const entry: PendingTick = { ...tick, id: newId(), queuedAt: lastQueuedAt };
  for (const other of store.all()) {
    if (other.taskId === tick.taskId && other.userId === tick.userId && !inFlight.has(other.id)) {
      store.delete(other.id);
    }
  }
  save(entry);
  changed();
  return entry;
}

export function remove(entryId: string): void {
  store.delete(entryId);
  changed();
}

/**
 * A line added offline got its real id when it was sent: ticks made on it
 * meanwhile go to that line now.
 */
export function retarget(fromTaskId: string, toTaskId: string): void {
  const moving = store.all().filter((entry) => entry.taskId === fromTaskId);
  if (moving.length === 0) return;
  for (const entry of moving) save({ ...entry, taskId: toTaskId });
  changed();
}

/** Forget the ticks on a line, such as one added offline that was never accepted. */
export function removeForTask(taskId: string): void {
  const going = store.all().filter((entry) => entry.taskId === taskId);
  if (going.length === 0) return;
  for (const entry of going) store.delete(entry.id);
  changed();
}

export function pendingFor(userId: string | undefined): PendingTick[] {
  return userId ? store.all().filter((entry) => entry.userId === userId) : [];
}

export function claim(entryId: string): boolean {
  if (inFlight.has(entryId)) return false;
  inFlight.add(entryId);
  return true;
}

export function release(entryId: string): void {
  inFlight.delete(entryId);
}

// --- subscription -------------------------------------------------------

const listeners = new Set<() => void>();
let version = 0;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever the queue does, for React to re-read it. */
export function queueVersion(): number {
  return version;
}

// Another tab on the same tablet changed the queue.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (store.owns(event.key)) changed();
  });
}
