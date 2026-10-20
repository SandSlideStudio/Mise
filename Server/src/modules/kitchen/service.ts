import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { mayManage } from '@mise/contracts';
import type {
  CreateStation,
  CreateUser,
  Role,
  UpdateKitchen,
  UpdateStation,
  UpdateUser,
} from '@mise/contracts';
import type { Database } from '../../db/client.js';
import { kitchens, sessions, stations, users } from '../../db/schema.js';
import { hashSecret } from '../../lib/crypto.js';

/**
 * Staff, stations and kitchen settings.
 *
 * There's no support desk behind a self-hosted server, so the guards below
 * make sure the last administrator can't lock themselves out.
 */

export type KitchenFailure =
  | { kind: 'not_found' }
  | { kind: 'last_admin' }
  | { kind: 'self_lockout' }
  | { kind: 'no_credential' }
  | { kind: 'password_needs_email' }
  | { kind: 'outranked' }
  | { kind: 'admin_needs_password' }
  | { kind: 'email_taken' };

/** Who is making a change to the staff list. */
export interface Actor {
  id: string;
  role: Role;
}

export function createKitchenService(db: Database) {
  // --- stations -----------------------------------------------------------

  async function listStations() {
    return db.select().from(stations).orderBy(asc(stations.sortOrder), asc(stations.name));
  }

  async function createStation(input: CreateStation) {
    const [station] = await db.insert(stations).values(input).returning();
    return station ?? null;
  }

  async function updateStation(id: string, input: UpdateStation) {
    const [station] = await db.update(stations).set(input).where(eq(stations.id, id)).returning();
    return station ?? null;
  }

  /**
   * Deleting a station is safe by construction: recipes, staff and prep tasks
   * all reference it with "on delete set null", so the work survives and simply
   * stops being grouped.
   */
  async function deleteStation(id: string): Promise<boolean> {
    const deleted = await db
      .delete(stations)
      .where(eq(stations.id, id))
      .returning({ id: stations.id });
    return deleted.length > 0;
  }

  /** Apply a whole new order in one transaction. */
  async function reorderStations(ids: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.update(stations).set({ sortOrder: index }).where(eq(stations.id, id));
      }
    });
  }

  // --- staff --------------------------------------------------------------

  /**
   * Never selects the hash columns. The API only ever reports *whether*
   * someone has a password or a PIN, never anything derived from the secret.
   */
  const userColumns = {
    id: users.id,
    displayName: users.displayName,
    email: users.email,
    role: users.role,
    defaultStationId: users.defaultStationId,
    active: users.active,
    hasPassword: sql<boolean>`${users.passwordHash} is not null`,
    hasPin: sql<boolean>`${users.pinHash} is not null`,
    lockedUntil: users.lockedUntil,
  };

  async function listUsers() {
    return db.select(userColumns).from(users).orderBy(asc(users.displayName));
  }

  async function getUser(id: string) {
    const [user] = await db.select(userColumns).from(users).where(eq(users.id, id)).limit(1);
    return user ?? null;
  }

  async function countOtherActiveAdmins(exceptUserId: string): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptUserId)));
    return row?.count ?? 0;
  }

  /** Sign-in ignores capitals, so "Chef@" and "chef@" are the same address. */
  async function emailTaken(email: string, exceptUserId: string | null): Promise<boolean> {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        exceptUserId
          ? and(sql`lower(${users.email}) = lower(${email})`, ne(users.id, exceptUserId))
          : sql`lower(${users.email}) = lower(${email})`,
      )
      .limit(1);
    return row !== undefined;
  }

  async function createUser(
    input: CreateUser,
    actor: Actor,
  ): Promise<
    | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUser>>> }
    | { ok: false; error: KitchenFailure }
  > {
    if (!mayManage(actor.role, input.role)) return { ok: false, error: { kind: 'outranked' } };
    if (input.role === 'admin' && !input.password) {
      return { ok: false, error: { kind: 'admin_needs_password' } };
    }
    if (input.email && (await emailTaken(input.email, null))) {
      return { ok: false, error: { kind: 'email_taken' } };
    }

    const [user] = await db
      .insert(users)
      .values({
        displayName: input.displayName,
        email: input.email ?? null,
        role: input.role,
        defaultStationId: input.defaultStationId ?? null,
        passwordHash: input.password ? await hashSecret(input.password) : null,
        pinHash: input.pin ? await hashSecret(input.pin) : null,
        pinLength: input.pin ? input.pin.length : null,
      })
      .returning(userColumns);
    if (!user) throw new Error('Insert returned no user');
    return { ok: true, user };
  }

  /**
   * Applies an edit. Refuses changes that would leave the kitchen with no
   * administrator, and ends the person's sessions when their role or sign-in
   * details change.
   */
  async function updateUser(
    id: string,
    input: UpdateUser,
    actor: Actor,
  ): Promise<
    | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUser>>> }
    | { ok: false; error: KitchenFailure }
  > {
    const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
    const current = existing[0];
    if (!current) return { ok: false, error: { kind: 'not_found' } };

    // Editing yourself is fine; editing someone else needs the rank to manage them.
    const changesRole = input.role !== undefined && input.role !== current.role;
    if (id !== actor.id && !mayManage(actor.role, current.role)) {
      return { ok: false, error: { kind: 'outranked' } };
    }
    if (changesRole && !mayManage(actor.role, input.role!)) {
      return { ok: false, error: { kind: 'outranked' } };
    }

    const losingAdmin =
      (input.role !== undefined && input.role !== 'admin' && current.role === 'admin') ||
      (input.active === false && current.role === 'admin');

    if (losingAdmin && (await countOtherActiveAdmins(id)) === 0) {
      return { ok: false, error: { kind: 'last_admin' } };
    }
    if (id === actor.id && input.active === false) {
      return { ok: false, error: { kind: 'self_lockout' } };
    }

    // Work out the resulting credentials before writing, so the database check
    // constraints never have to be the thing that catches a bad edit.
    const nextEmail = input.email !== undefined ? input.email : current.email;
    const nextPasswordHash = input.password
      ? await hashSecret(input.password)
      : current.passwordHash;
    const nextPinHash =
      input.pin === undefined
        ? current.pinHash
        : input.pin === null
          ? null
          : await hashSecret(input.pin);

    if (!nextPasswordHash && !nextPinHash) return { ok: false, error: { kind: 'no_credential' } };
    if (nextPasswordHash && !nextEmail)
      return { ok: false, error: { kind: 'password_needs_email' } };
    if (input.email && (await emailTaken(input.email, id))) {
      return { ok: false, error: { kind: 'email_taken' } };
    }
    // A four-digit PIN is too little to stand between anyone and admin rights.
    if ((input.role ?? current.role) === 'admin' && !nextPasswordHash) {
      return { ok: false, error: { kind: 'admin_needs_password' } };
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.defaultStationId !== undefined
          ? { defaultStationId: input.defaultStationId }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        passwordHash: nextPasswordHash,
        pinHash: nextPinHash,
        ...(input.pin !== undefined ? { pinLength: input.pin?.length ?? null } : {}),
        // Any credential change also clears a standing lockout, which is what
        // an administrator resetting a forgotten PIN actually wants.
        ...(input.password || input.pin !== undefined
          ? { failedAttempts: 0, lockedUntil: null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning(userColumns);

    if (!updated) return { ok: false, error: { kind: 'not_found' } };

    // A new role, a new secret or a deactivation must take effect now rather
    // than whenever a session happens to expire.
    const invalidates =
      input.role !== undefined ||
      input.active === false ||
      input.password !== undefined ||
      input.pin !== undefined;
    if (invalidates) {
      await db.delete(sessions).where(eq(sessions.userId, id));
    }

    return { ok: true, user: updated };
  }

  /**
   * Removing someone deletes them outright. Their sessions go with them, and
   * prep they were on or ticked off stays on the list without a name, because
   * the tasks point at people with "on delete set null".
   */
  async function deleteUser(
    id: string,
    actor: Actor,
  ): Promise<{ ok: true } | { ok: false; error: KitchenFailure }> {
    const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!current) return { ok: false, error: { kind: 'not_found' } };

    if (id !== actor.id && !mayManage(actor.role, current.role)) {
      return { ok: false, error: { kind: 'outranked' } };
    }
    if (current.role === 'admin' && (await countOtherActiveAdmins(id)) === 0) {
      return { ok: false, error: { kind: 'last_admin' } };
    }
    if (id === actor.id) return { ok: false, error: { kind: 'self_lockout' } };

    await db.delete(users).where(eq(users.id, id));
    return { ok: true };
  }

  // --- kitchen settings ---------------------------------------------------

  async function getKitchen() {
    const [row] = await db.select().from(kitchens).limit(1);
    return row ?? null;
  }

  async function updateKitchen(input: UpdateKitchen) {
    const existing = await getKitchen();
    if (!existing) return null;
    const [updated] = await db
      .update(kitchens)
      .set(input)
      .where(eq(kitchens.id, existing.id))
      .returning();
    return updated ?? null;
  }

  return {
    listStations,
    createStation,
    updateStation,
    deleteStation,
    reorderStations,
    listUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    getKitchen,
    updateKitchen,
  };
}

export type KitchenService = ReturnType<typeof createKitchenService>;
