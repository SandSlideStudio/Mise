import { and, asc, eq, isNotNull, lt, or, sql } from 'drizzle-orm';
import type { PersonData, PrivacySummary } from '@mise/contracts';
import type { Database } from '../../db/client.js';
import {
  backupSettings,
  connectionSettings,
  devices,
  dishAllergenChanges,
  kitchens,
  prepTasks,
  recipes,
  remoteDevices,
  sessions,
  stations,
  users,
} from '../../db/schema.js';
import { KEEP_DAYS as OFFLINE_ANSWERS_DAYS } from '../../plugins/writes.js';
import { IDLE_DAYS, PENDING_HOURS, type AccessService } from '../access/service.js';
import { PASSWORD_SESSION_DAYS, PIN_SESSION_HOURS } from '../auth/service.js';
import { createPrepService, RUNNING_TICK_LIFETIME_MS } from '../prep/service.js';

/**
 * What Mise keeps about people, for how long, and a copy of it for whoever
 * asks.
 *
 * The kitchen is responsible for its staff's data, not Mise and not whoever
 * wrote it: there is nobody else holding a copy. So this is what the kitchen
 * needs to answer a cook who asks "what do you have on me?", and the limits
 * that make sure the answer never grows into years of who did what.
 */

/** A browser name nobody has used for this long is no longer kept. */
export const BROWSER_KEEP_DAYS = IDLE_DAYS;

const DAY_MS = 86_400_000;
const iso = (date: Date | null) => date?.toISOString() ?? null;

export function createPrivacyService(db: Database, access: AccessService) {
  const prep = createPrepService(db);

  /**
   * Clear out what has been kept long enough. Run at start and once an hour:
   * the running list's own clean-up only happens when someone looks at it.
   */
  async function forgetOld(): Promise<void> {
    const [kitchen] = await db.select().from(kitchens).limit(1);
    if (kitchen) {
      await prep.expire(kitchen.tickedRetention);
      if (kitchen.tickedRetention === 'keep') await prep.expireKept(kitchen.tickedKeepDays);
    }
    // Sessions end within a fortnight anyway; this is for any that somehow
    // didn't, so a browser's name is never kept past the same 90 days.
    await db
      .update(sessions)
      .set({ userAgent: null })
      .where(
        and(
          isNotNull(sessions.userAgent),
          lt(sessions.lastSeenAt, new Date(Date.now() - BROWSER_KEEP_DAYS * DAY_MS)),
        ),
      );
    // An outside device unused for 90 days is forgotten, address, browser and all.
    await access.sweep();
  }

  /** The numbers the privacy page quotes, as this server has them. */
  async function summary(): Promise<PrivacySummary> {
    const [kitchen] = await db.select().from(kitchens).limit(1);
    const [backup] = await db.select().from(backupSettings).limit(1);
    const [connection] = await db
      .select({ domainHttps: connectionSettings.domainHttps })
      .from(connectionSettings)
      .limit(1);
    return {
      tickedRetention: kitchen?.tickedRetention ?? 'keep',
      tickedKeepDays: kitchen ? kitchen.tickedKeepDays : 365,
      runningListHours: RUNNING_TICK_LIFETIME_MS / 3_600_000,
      passwordSessionDays: PASSWORD_SESSION_DAYS,
      pinSessionHours: PIN_SESSION_HOURS,
      outsideDeviceIdleDays: IDLE_DAYS,
      outsideRequestHours: PENDING_HOURS,
      offlineAnswersDays: OFFLINE_ANSWERS_DAYS,
      updateCheck: kitchen?.updateCheck ?? true,
      domainHttps: connection?.domainHttps ?? false,
      backups: {
        // Until backups are first looked at, these are what they'll start with.
        keepLocal: backup?.keepLocal ?? 7,
        keepRemote: backup?.keepRemote ?? 30,
        webdav: Boolean(backup?.sendToWebdav && backup.webdavUrl),
        onedrive: Boolean(backup?.sendToOnedrive && backup.onedriveRefreshToken),
      },
    };
  }

  /**
   * Everything about one person, for them to read. Nothing made from their
   * PIN or password, and no token: a copy of this must not let anyone in.
   */
  async function personData(id: string): Promise<PersonData | null> {
    const [person] = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        station: stations.name,
        active: users.active,
        language: users.language,
        hasPassword: sql<boolean>`${users.passwordHash} is not null`,
        hasPin: sql<boolean>`${users.pinHash} is not null`,
        pinSetAt: users.pinSetAt,
        tourSeenAt: users.tourSeenAt,
        lockedUntil: users.lockedUntil,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .leftJoin(stations, eq(stations.id, users.defaultStationId))
      .where(eq(users.id, id))
      .limit(1);
    if (!person) return null;

    const [kitchen] = await db.select().from(kitchens).limit(1);

    const lines = await db
      .select({
        id: prepTasks.id,
        description: prepTasks.description,
        station: stations.name,
        status: prepTasks.status,
        createdAt: prepTasks.createdAt,
        completedAt: prepTasks.completedAt,
        fromChecklist: prepTasks.fromChecklist,
        createdBy: prepTasks.createdBy,
        assignedUserId: prepTasks.assignedUserId,
        completedBy: prepTasks.completedBy,
      })
      .from(prepTasks)
      .leftJoin(stations, eq(stations.id, prepTasks.stationId))
      .where(
        or(
          eq(prepTasks.createdBy, id),
          eq(prepTasks.assignedUserId, id),
          eq(prepTasks.completedBy, id),
        ),
      )
      .orderBy(asc(prepTasks.createdAt));

    const written = await db
      .select({ id: recipes.id, name: recipes.name, createdAt: recipes.createdAt })
      .from(recipes)
      .where(eq(recipes.createdBy, id))
      .orderBy(asc(recipes.name));

    const allergenChanges = await db
      .select({
        dish: recipes.name,
        changedAt: dishAllergenChanges.changedAt,
        cause: dishAllergenChanges.cause,
      })
      .from(dishAllergenChanges)
      .innerJoin(recipes, eq(recipes.id, dishAllergenChanges.recipeId))
      .where(eq(dishAllergenChanges.changedBy, id))
      .orderBy(asc(dishAllergenChanges.changedAt), asc(recipes.name));

    const signedIn = await db
      .select({
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
        userAgent: sessions.userAgent,
        tablet: devices.name,
      })
      .from(sessions)
      .leftJoin(devices, eq(devices.id, sessions.deviceId))
      .where(eq(sessions.userId, id))
      .orderBy(asc(sessions.createdAt));

    const approved = await db
      .select({
        name: remoteDevices.name,
        approvedAt: remoteDevices.approvedAt,
        lastSeenAt: remoteDevices.lastSeenAt,
      })
      .from(remoteDevices)
      .where(eq(remoteDevices.approvedBy, id))
      .orderBy(asc(remoteDevices.approvedAt));

    // The note keeps the name as written rather than a link to the person.
    const signedNote = kitchen?.handoverNoteBy === person.displayName;

    return {
      exportedAt: new Date().toISOString(),
      kitchen: kitchen?.name ?? '',
      person: {
        ...person,
        pinSetAt: iso(person.pinSetAt),
        tourSeenAt: iso(person.tourSeenAt),
        lockedUntil: iso(person.lockedUntil),
        createdAt: person.createdAt.toISOString(),
        updatedAt: person.updatedAt.toISOString(),
      },
      prepLines: lines.map((line) => ({
        id: line.id,
        description: line.description,
        station: line.station,
        status: line.status,
        addedAt: line.createdAt.toISOString(),
        completedAt: iso(line.completedAt),
        fromChecklist: line.fromChecklist,
        added: line.createdBy === id,
        onIt: line.assignedUserId === id,
        ticked: line.completedBy === id,
      })),
      recipes: written.map((recipe) => ({ ...recipe, createdAt: recipe.createdAt.toISOString() })),
      allergenChanges: allergenChanges.map((change) => ({
        ...change,
        changedAt: change.changedAt.toISOString(),
      })),
      handoverNote: signedNote
        ? { text: kitchen.handoverNote, at: iso(kitchen.handoverNoteAt) }
        : null,
      sessions: signedIn.map((session) => ({
        startedAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        endsAt: session.expiresAt.toISOString(),
        browser: session.userAgent,
        tablet: session.tablet,
      })),
      approvedDevices: approved.map((device) => ({
        name: device.name,
        approvedAt: iso(device.approvedAt),
        lastSeenAt: iso(device.lastSeenAt),
      })),
    };
  }

  return { forgetOld, summary, personData };
}

export type PrivacyService = ReturnType<typeof createPrivacyService>;
