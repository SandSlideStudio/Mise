import type { PrepTaskStatus } from '@mise/contracts';

/**
 * Ticks waiting to reach the server, kept in localStorage so a reload or a dead
 * wifi spot doesn't lose them.
 *
 * Every tick is written here before it's sent, and removed only when the
 * server has answered: accepted, or refused for a real reason. Each entry
 * belongs to the person who tapped it, so on a shared tablet the next cook
 * never sends someone else's work under their own name.
 */

const STORAGE_KEY = 'mise.pendingTicks';

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
const newId = () => `${Date.now().toString(36)}-${(counter += 1)}`;

/** Entries being sent right now, so the background sender doesn't send them twice. */
const inFlight = new Set<string>();

function read(): PendingTick[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // Entries from before ticks carried a person can't be sent safely.
    return Array.isArray(parsed)
      ? (parsed as PendingTick[]).filter((entry) => entry.id && entry.userId && entry.patch)
      : [];
  } catch {
    return [];
  }
}

function write(queue: PendingTick[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Storage blocked: the tick is still sent, it just won't survive a reload.
  }
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Save a tick before sending it. An older tick on the same line that hasn't
 * gone out yet is replaced, since only the newest one matters.
 */
export function enqueue(tick: Omit<PendingTick, 'id' | 'queuedAt'>): PendingTick {
  const entry: PendingTick = { ...tick, id: newId(), queuedAt: Date.now() };
  const queue = read().filter(
    (other) =>
      !(other.taskId === tick.taskId && other.userId === tick.userId && !inFlight.has(other.id)),
  );
  queue.push(entry);
  write(queue);
  return entry;
}

export function remove(entryId: string): void {
  write(read().filter((entry) => entry.id !== entryId));
}

export function pendingFor(userId: string | undefined): PendingTick[] {
  return userId ? read().filter((entry) => entry.userId === userId) : [];
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
    if (event.key !== STORAGE_KEY) return;
    version += 1;
    for (const listener of listeners) listener();
  });
}
