import { and, asc, eq, gte, isNotNull, isNull, like, lt, ne, or, sql } from 'drizzle-orm';
import { mayManage } from '@mise/contracts';
import { isCommonPin } from '@mise/domain';
import type {
  CreateStation,
  CreateUser,
  PinOnlyState,
  Role,
  UpdateKitchen,
  UpdateStation,
  UpdateUser,
} from '@mise/contracts';
import type { Database, Executor, Transaction } from '../../db/client.js';
import { kitchens, sessions, stations, users, writeReceipts } from '../../db/schema.js';
import { hashSecret, verifySecret } from '../../lib/crypto.js';

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
  | { kind: 'email_taken' }
  | { kind: 'pin_taken' }
  | { kind: 'pin_too_common' };

/** Who is making a change to the staff list. */
export interface Actor {
  id: string;
  role: Role;
}

/**
 * PINs are set one at a time while PIN-only sign-in is chosen. Checking that
 * nobody else has a PIN and then saving it are two steps; two head chefs
 * giving two cooks the same PIN at the same moment would otherwise both pass
 * the check. One Mise is one process, so waiting in line here is enough.
 */
let pinChanges: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const result = pinChanges.then(task, task);
  pinChanges = result.catch(() => undefined);
  return result;
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

  async function countOtherActiveAdmins(
    exceptUserId: string,
    exec: Executor = db,
  ): Promise<number> {
    const [row] = await exec
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, exceptUserId)));
    return row?.count ?? 0;
  }

  /**
   * One change to the set of administrators at a time. Taken inside the
   * transaction that writes the change, before counting who else is left, so
   * two people stepping down at once can't both find the other still there.
   */
  async function lockAdmins(tx: Transaction): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('mise-last-admin'))`);
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
    return input.pin ? oneAtATime(() => insertUser(input, actor)) : insertUser(input, actor);
  }

  async function insertUser(
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
    const refused = input.pin ? await refusePin(input.pin, null) : null;
    if (refused) return { ok: false, error: refused };

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
        pinSetAt: input.pin ? new Date() : null,
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
  /**
   * Lift a lockout someone ran into, or that a colleague caused on purpose by
   * trying wrong PINs for them. Same rights as editing them; their PIN and
   * password stay as they are.
   */
  async function unlockUser(
    id: string,
    actor: Actor,
  ): Promise<
    | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUser>>> }
    | { ok: false; error: KitchenFailure }
  > {
    const [current] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!current) return { ok: false, error: { kind: 'not_found' } };
    if (id !== actor.id && !mayManage(actor.role, current.role)) {
      return { ok: false, error: { kind: 'outranked' } };
    }
    await db.update(users).set({ lockedUntil: null }).where(eq(users.id, id));
    const user = await getUser(id);
    return user ? { ok: true, user } : { ok: false, error: { kind: 'not_found' } };
  }

  async function updateUser(
    id: string,
    input: UpdateUser,
    actor: Actor,
  ): Promise<
    | { ok: true; user: NonNullable<Awaited<ReturnType<typeof getUser>>> }
    | { ok: false; error: KitchenFailure }
  > {
    // Coming back counts too: their PIN could be someone else's by now.
    const touchesPins = Boolean(input.pin) || input.active === true;
    return touchesPins
      ? oneAtATime(() => applyUserEdit(id, input, actor))
      : applyUserEdit(id, input, actor);
  }

  async function applyUserEdit(
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
    const refused = input.pin ? await refusePin(input.pin, id) : null;
    if (refused) return { ok: false, error: refused };

    // Someone switched back on while PIN-only sign-in is chosen may have the
    // same PIN as somebody given one while they were away, and the PIN itself
    // can't be read back to check. So theirs counts as old: they need a new
    // one, and tablets show the names until they have it.
    const kitchen = input.active === true && !current.active ? await getKitchen() : null;
    const pinNowOld =
      input.pin === undefined &&
      current.pinHash !== null &&
      kitchen?.pinOnlySince != null &&
      current.pinSetAt !== null &&
      current.pinSetAt >= kitchen.pinOnlySince;

    const written = await db.transaction(async (tx) => {
      // The check further up is the quick answer; this one counts. With the
      // lock held the person is read again, since they may have changed while
      // the password was being hashed.
      if (current.role === 'admin') {
        await lockAdmins(tx);
        const [fresh] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        if (!fresh) return null;
        const stepsDown =
          fresh.role === 'admin' &&
          ((input.role !== undefined && input.role !== 'admin') || input.active === false);
        if (stepsDown && (await countOtherActiveAdmins(id, tx)) === 0) {
          return { lastAdmin: true as const };
        }
      }

      const [row] = await tx
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
          ...(input.pin !== undefined
            ? { pinLength: input.pin?.length ?? null, pinSetAt: input.pin ? new Date() : null }
            : {}),
          ...(pinNowOld ? { pinSetAt: null } : {}),
          // Any credential change also clears a standing lockout, which is what
          // an administrator resetting a forgotten PIN actually wants.
          ...(input.password || input.pin !== undefined ? { lockedUntil: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning(userColumns);
      if (!row) return null;

      // A new role, a new secret or a deactivation must take effect now rather
      // than whenever a session happens to expire.
      const invalidates =
        input.role !== undefined ||
        input.active === false ||
        input.password !== undefined ||
        input.pin !== undefined;
      if (invalidates) {
        await tx.delete(sessions).where(eq(sessions.userId, id));
      }
      return { user: row };
    });

    if (!written) return { ok: false, error: { kind: 'not_found' } };
    if ('lastAdmin' in written) return { ok: false, error: { kind: 'last_admin' } };
    const updated = written.user;
    return { ok: true, user: updated };
  }

  /**
   * Removing someone is for good. Their account and sessions go, and prep
   * they added, were on or ticked off stays on the list without a name,
   * because everything points at people with "on delete set null" (outside
   * devices they approved too). What holds their name as text is cleared as
   * well: the handover note keeps its words but loses the signature, and the
   * answers kept for their offline changes, which can repeat their own
   * details, are dropped. Backups made before keep them until they rotate out.
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

    const removed = await db.transaction(async (tx) => {
      // The check above is the quick answer; this one counts, with the lock held.
      if (current.role === 'admin') {
        await lockAdmins(tx);
        const [fresh] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
        if (!fresh) return 'not_found' as const;
        if (fresh.role === 'admin' && (await countOtherActiveAdmins(id, tx)) === 0) {
          return 'last_admin' as const;
        }
      }
      // The note keeps the name as written, so a namesake's note loses its
      // signature too; better that than keeping a name that should be gone.
      await tx
        .update(kitchens)
        .set({ handoverNoteBy: null })
        .where(eq(kitchens.handoverNoteBy, current.displayName));
      // Their own writes' answers, and others' answers that name them (the
      // one that created them, say): kept a week to answer a retry, but not
      // for someone who is gone.
      await tx
        .delete(writeReceipts)
        .where(
          or(
            like(writeReceipts.key, `${id}:%`),
            sql`strpos(${writeReceipts.body}, ${id}) > 0`,
            ...(current.email
              ? [sql`strpos(lower(${writeReceipts.body}), ${current.email.toLowerCase()}) > 0`]
              : []),
          ),
        );
      await tx.delete(users).where(eq(users.id, id));
      return 'removed' as const;
    });
    if (removed === 'not_found') return { ok: false, error: { kind: 'not_found' } };
    if (removed === 'last_admin') return { ok: false, error: { kind: 'last_admin' } };
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
    // Nothing to change, such as a setting from an older app that is gone now.
    if (Object.values(input).every((value) => value === undefined)) return existing;
    const { pinOnly, ...rest } = input;
    const [updated] = await db
      .update(kitchens)
      .set({
        ...rest,
        // Chosen now, or kept from when it was first chosen, so the new PINs
        // already given still count.
        ...(pinOnly !== undefined
          ? { pinOnlySince: pinOnly ? (existing.pinOnlySince ?? new Date()) : null }
          : {}),
      })
      .where(eq(kitchens.id, existing.id))
      .returning();
    return updated ?? null;
  }

  /** People with a PIN who haven't been given a new one since PIN-only sign-in was chosen. */
  async function waitingForNewPin(since: Date) {
    return db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(
        and(
          eq(users.active, true),
          isNotNull(users.pinHash),
          or(isNull(users.pinSetAt), lt(users.pinSetAt, since)),
        ),
      )
      .orderBy(asc(users.displayName));
  }

  /**
   * The PINs PIN-only sign-in goes by: everyone active whose PIN was set
   * since it was chosen. Only hashes; nothing here can tell what a PIN is.
   */
  async function pinsSetSince(since: Date) {
    return db
      .select({ id: users.id, pinHash: users.pinHash, pinLength: users.pinLength })
      .from(users)
      .where(and(eq(users.active, true), isNotNull(users.pinHash), gte(users.pinSetAt, since)));
  }

  /**
   * While PIN-only sign-in is chosen, a PIN has to find exactly one person, and
   * must not be one a stranger at the tablet would try first. A PIN that is
   * taken is refused without saying whose it is.
   */
  async function refusePin(pin: string, userId: string | null): Promise<KitchenFailure | null> {
    const kitchen = await getKitchen();
    if (!kitchen?.pinOnlySince) return null;
    if (isCommonPin(pin)) return { kind: 'pin_too_common' };
    const others = (await pinsSetSince(kitchen.pinOnlySince)).filter((p) => p.id !== userId);
    // Each check is slow on purpose, so they run side by side, not one by one.
    const matches = await Promise.all(others.map((other) => verifySecret(other.pinHash, pin)));
    return matches.some(Boolean) ? { kind: 'pin_taken' } : null;
  }

  /** Off, chosen but waiting for new PINs, or on. */
  async function pinOnlyState(kitchen: { pinOnlySince: Date | null }): Promise<PinOnlyState> {
    if (!kitchen.pinOnlySince) return 'off';
    return (await waitingForNewPin(kitchen.pinOnlySince)).length > 0 ? 'waiting' : 'on';
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
    unlockUser,
    deleteUser,
    getKitchen,
    updateKitchen,
    waitingForNewPin,
    pinsSetSince,
    pinOnlyState,
  };
}

export type KitchenService = ReturnType<typeof createKitchenService>;
