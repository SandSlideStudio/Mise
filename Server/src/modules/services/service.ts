import { and, asc, count, eq, gte, inArray, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type {
  CreatePrepTask,
  CreateService,
  TickedRetention,
  UpdatePrepTask,
  UpdateService,
} from '@mise/contracts';
import { baseUnitOf, toBase, type UnitCode } from '@mise/domain';
import type { Database } from '../../db/client.js';
import { prepTasks, serviceDishes, services, stations, users } from '../../db/schema.js';

/**
 * Services and the prep list.
 *
 * At this stage every task is added by hand, which is enough to replace a
 * whiteboard on its own. Generated tasks land alongside these later, which is
 * why `source` and `generationKey` already exist on the table: a generated
 * list has to merge into a list people have been editing, not replace it.
 *
 * A kitchen can also keep one running list instead. Its lines belong to no
 * service, go on by hand, and are gone two hours after they are ticked, so the
 * list is always the work in front of the brigade and never three years of it.
 */

export type ServiceFailure =
  { kind: 'not_found' } | { kind: 'duplicate_service' } | { kind: 'same_service' };

/** How long a ticked line stays on the running list before it is gone for good. */
export const RUNNING_TICK_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Anything ticked before this moment has dropped off the running list. */
export function runningCutoff(now = Date.now()): Date {
  return new Date(now - RUNNING_TICK_LIFETIME_MS);
}

/**
 * Quantities are stored in the canonical base unit for their dimension, the
 * same as everywhere else, so a task entered as "2 kg" and one generated as
 * 2000 g are the same row shape and sort together.
 */
function toBaseQuantity(quantity: { value: number; unit: string } | null | undefined) {
  if (!quantity) return { quantityBase: null, quantityUnit: null };
  const unit = quantity.unit as UnitCode;
  return {
    quantityBase: toBase({ value: quantity.value, unit }),
    quantityUnit: baseUnitOf(unit) as string,
  };
}

/** A service's tasks, or with null, the running list's. */
/** Station order is how the kitchen is laid out, which is how a prep list should read. */
const TASK_ORDER = [asc(stations.sortOrder), asc(prepTasks.sortOrder), asc(prepTasks.description)];

function belongsTo(serviceId: string | null) {
  return serviceId === null ? isNull(prepTasks.serviceId) : eq(prepTasks.serviceId, serviceId);
}

export function createServicesService(db: Database) {
  // --- services -----------------------------------------------------------

  async function listServices(filters: { from?: string; to?: string; status?: string }) {
    const conditions = [];
    if (filters.from) conditions.push(gte(services.date, filters.from));
    if (filters.to) conditions.push(lte(services.date, filters.to));
    if (filters.status)
      conditions.push(eq(services.status, filters.status as 'planning' | 'active' | 'closed'));

    const rows = await db
      .select({
        id: services.id,
        date: services.date,
        period: services.period,
        covers: services.covers,
        status: services.status,
        generatedAt: services.generatedAt,
      })
      .from(services)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(services.date), asc(services.period));

    // Counted with their own grouped queries rather than correlated
    // subqueries, which keeps the SQL obvious and the counts easy to trust.
    const [taskCounts, dishCounts] = await Promise.all([
      db
        .select({
          serviceId: prepTasks.serviceId,
          taskCount: count(),
          doneCount: sql<number>`(count(*) filter (where ${prepTasks.status} = 'done'))::int`,
        })
        .from(prepTasks)
        .groupBy(prepTasks.serviceId),
      db
        .select({ serviceId: serviceDishes.serviceId, dishCount: count() })
        .from(serviceDishes)
        .groupBy(serviceDishes.serviceId),
    ]);

    const tasksByService = new Map(taskCounts.map((row) => [row.serviceId, row]));
    const dishesByService = new Map(dishCounts.map((row) => [row.serviceId, row.dishCount]));

    return rows.map((row) => ({
      ...row,
      dishCount: dishesByService.get(row.id) ?? 0,
      taskCount: tasksByService.get(row.id)?.taskCount ?? 0,
      doneCount: tasksByService.get(row.id)?.doneCount ?? 0,
    }));
  }

  /** Used to give a duplicate a clear message instead of a database error. */
  async function findByDateAndPeriod(date: string, period: string) {
    const [row] = await db
      .select({ id: services.id })
      .from(services)
      .where(
        and(
          eq(services.date, date),
          eq(services.period, period as 'breakfast' | 'lunch' | 'dinner' | 'prep_day' | 'event'),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** The service alone, for callers that fetch its dishes their own way. */
  async function getServiceRow(id: string) {
    const [row] = await serviceById.execute({ id });
    return row ?? null;
  }

  async function getService(id: string) {
    const [row] = await serviceById.execute({ id });
    if (!row) return null;
    const dishes = await dishesForService.execute({ serviceId: id });
    return { ...row, dishes };
  }

  async function createService(input: CreateService) {
    const [row] = await db
      .insert(services)
      .values({
        date: input.date,
        period: input.period,
        covers: input.covers ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row ?? null;
  }

  async function updateService(id: string, input: UpdateService) {
    const [row] = await db
      .update(services)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(services.id, id))
      .returning();
    return row ?? null;
  }

  async function deleteService(id: string): Promise<boolean> {
    const removed = await db
      .delete(services)
      .where(eq(services.id, id))
      .returning({ id: services.id });
    return removed.length > 0;
  }

  // --- prep tasks ---------------------------------------------------------

  /**
   * Joined against staff twice, so the list can say who it is for and who
   * actually finished it. Those are often not the same person.
   */
  const assignee = db.select().from(users).as('assignee');
  const completer = db.select().from(users).as('completer');

  async function listTasks(
    serviceId: string | null,
    filters: {
      stationId?: string;
      assignedUserId?: string;
      status?: string;
      /** Leave out anything ticked before this moment. */
      tickedSince?: Date;
    } = {},
  ) {
    const conditions = [belongsTo(serviceId)];
    if (filters.stationId) conditions.push(eq(prepTasks.stationId, filters.stationId));
    if (filters.assignedUserId)
      conditions.push(eq(prepTasks.assignedUserId, filters.assignedUserId));
    if (filters.status)
      conditions.push(
        eq(prepTasks.status, filters.status as 'open' | 'in_progress' | 'done' | 'skipped'),
      );
    if (filters.tickedSince) {
      conditions.push(
        or(
          ne(prepTasks.status, 'done'),
          isNull(prepTasks.completedAt),
          gte(prepTasks.completedAt, filters.tickedSince),
        )!,
      );
    }

    const filtered =
      filters.stationId || filters.assignedUserId || filters.status || filters.tickedSince;
    if (serviceId !== null && !filtered) return tasksForService.execute({ serviceId });

    return selectTasks()
      .where(and(...conditions))
      .orderBy(...TASK_ORDER);
  }

  function selectTasks() {
    return db
      .select({
        id: prepTasks.id,
        serviceId: prepTasks.serviceId,
        stationId: prepTasks.stationId,
        kind: prepTasks.kind,
        sourceRecipeId: prepTasks.sourceRecipeId,
        sourceIngredientId: prepTasks.sourceIngredientId,
        description: prepTasks.description,
        quantityBase: prepTasks.quantityBase,
        quantityUnit: prepTasks.quantityUnit,
        source: prepTasks.source,
        status: prepTasks.status,
        assignedUserId: prepTasks.assignedUserId,
        assignedUserName: assignee.displayName,
        completedByName: completer.displayName,
        completedAt: prepTasks.completedAt,
        notes: prepTasks.notes,
        usedBy: prepTasks.usedBy,
        sortOrder: prepTasks.sortOrder,
        stationSortOrder: stations.sortOrder,
      })
      .from(prepTasks)
      .leftJoin(assignee, eq(assignee.id, prepTasks.assignedUserId))
      .leftJoin(completer, eq(completer.id, prepTasks.completedBy))
      .leftJoin(stations, eq(stations.id, prepTasks.stationId));
  }

  // Every tablet asks for these after every tick. Prepared once, so the SQL
  // isn't rebuilt on each request, which is a third of the work on a Pi.
  const tasksForService = selectTasks()
    .where(eq(prepTasks.serviceId, sql.placeholder('serviceId')))
    .orderBy(...TASK_ORDER)
    .prepare('tasks_for_service');
  const taskById = selectTasks()
    .where(eq(prepTasks.id, sql.placeholder('id')))
    .limit(1)
    .prepare('task_by_id');
  const serviceById = db
    .select()
    .from(services)
    .where(eq(services.id, sql.placeholder('id')))
    .limit(1)
    .prepare('service_by_id');
  const dishesForService = db
    .select({
      id: serviceDishes.id,
      recipeId: serviceDishes.recipeId,
      plannedPortions: serviceDishes.plannedPortions,
    })
    .from(serviceDishes)
    .where(eq(serviceDishes.serviceId, sql.placeholder('serviceId')))
    .prepare('dishes_for_service');

  async function getTask(id: string) {
    const [row] = await db.select().from(prepTasks).where(eq(prepTasks.id, id)).limit(1);
    return row ?? null;
  }

  /** Find one task by id, in the joined shape the API returns. */
  async function getTaskForApi(id: string) {
    const [row] = await taskById.execute({ id });
    return row ?? null;
  }

  async function nextSortOrder(serviceId: string | null): Promise<number> {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(${prepTasks.sortOrder}), -1)::int` })
      .from(prepTasks)
      .where(belongsTo(serviceId));
    return (row?.value ?? -1) + 1;
  }

  async function createTask(serviceId: string | null, input: CreatePrepTask) {
    const [row] = await db
      .insert(prepTasks)
      .values({
        serviceId,
        stationId: input.stationId ?? null,
        kind: 'other',
        description: input.description,
        ...toBaseQuantity(input.quantity),
        source: 'manual',
        status: 'open',
        assignedUserId: input.assignedUserId ?? null,
        sortOrder: await nextSortOrder(serviceId),
      })
      .returning({ id: prepTasks.id });
    if (!row) return null;
    return getTaskForApi(row.id);
  }

  /**
   * Completing a task records who did it and when; reopening one clears both,
   * so the record never claims somebody finished something that is open again.
   */
  async function updateTask(id: string, input: UpdatePrepTask, actingUserId: string) {
    const existing = await getTask(id);
    if (!existing) return null;

    const completion =
      input.status === undefined || input.status === existing.status
        ? {}
        : input.status === 'done'
          ? { completedBy: actingUserId, completedAt: new Date() }
          : { completedBy: null, completedAt: null };

    await db
      .update(prepTasks)
      .set({
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
        ...(input.quantity !== undefined ? toBaseQuantity(input.quantity) : {}),
        ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        // Generating the list again leaves a line alone once a chef has changed it.
        ...(input.description !== undefined ||
        input.stationId !== undefined ||
        input.quantity !== undefined
          ? { editedAt: new Date() }
          : {}),
        ...completion,
        updatedAt: new Date(),
      })
      .where(eq(prepTasks.id, id));

    return getTaskForApi(id);
  }

  async function deleteTask(id: string): Promise<boolean> {
    const removed = await db
      .delete(prepTasks)
      .where(eq(prepTasks.id, id))
      .returning({ id: prepTasks.id });
    return removed.length > 0;
  }

  // --- the running list ---------------------------------------------------

  /**
   * A running-list line ticked more than two hours ago. It cannot be seen and
   * cannot be unticked; if the job needs doing again, it goes back on by hand.
   */
  function isGone(task: { serviceId: string | null; status: string; completedAt: Date | null }) {
    return (
      task.serviceId === null &&
      task.status === 'done' &&
      task.completedAt !== null &&
      task.completedAt < runningCutoff()
    );
  }

  /**
   * Apply the kitchen's choice for lines that have dropped off: kept out of
   * sight for the record, or deleted so they cost no space. Returns how many
   * were deleted.
   */
  async function expireRunning(retention: TickedRetention): Promise<number> {
    if (retention !== 'delete') return 0;
    const removed = await db
      .delete(prepTasks)
      .where(
        and(
          isNull(prepTasks.serviceId),
          eq(prepTasks.status, 'done'),
          lt(prepTasks.completedAt, runningCutoff()),
        ),
      )
      .returning({ id: prepTasks.id });
    return removed.length;
  }

  /** What is on the running list right now. */
  async function listRunning() {
    return listTasks(null, { tickedSince: runningCutoff() });
  }

  /**
   * Put a line on the running list. When the same thing is already waiting on
   * the same station, in a unit that adds up, the amount goes onto that line:
   * "2 kg onions" and later "500 g onions" become one line for 2.5 kg.
   */
  async function addToRunning(input: CreatePrepTask) {
    const added = toBaseQuantity(input.quantity);

    const candidates = await db
      .select()
      .from(prepTasks)
      .where(
        and(
          isNull(prepTasks.serviceId),
          inArray(prepTasks.status, ['open', 'in_progress']),
          sql`lower(trim(${prepTasks.description})) = lower(trim(${input.description}))`,
          input.stationId ? eq(prepTasks.stationId, input.stationId) : isNull(prepTasks.stationId),
        ),
      )
      .orderBy(asc(prepTasks.sortOrder));

    const match = candidates.find(
      (task) =>
        added.quantityUnit === null ||
        task.quantityUnit === null ||
        task.quantityUnit === added.quantityUnit,
    );

    if (!match) {
      return { task: await createTask(null, input), merged: false };
    }

    if (added.quantityBase !== null) {
      await db
        .update(prepTasks)
        .set({
          quantityBase: (match.quantityBase ?? 0) + added.quantityBase,
          quantityUnit: match.quantityUnit ?? added.quantityUnit,
          updatedAt: new Date(),
        })
        .where(eq(prepTasks.id, match.id));
    }

    return { task: await getTaskForApi(match.id), merged: true };
  }

  /**
   * Move unfinished work from an earlier service onto this one, which is what
   * a chef does with the bottom half of yesterday's whiteboard.
   *
   * Carried tasks arrive as manual ones with no generation key, so a later
   * regenerate treats them as somebody's own additions and leaves them be.
   */
  async function carryOver(targetServiceId: string, fromServiceId: string) {
    const source = await db
      .select()
      .from(prepTasks)
      .where(
        and(
          eq(prepTasks.serviceId, fromServiceId),
          inArray(prepTasks.status, ['open', 'in_progress']),
        ),
      )
      .orderBy(asc(prepTasks.sortOrder));

    const existing = await db
      .select({ description: prepTasks.description })
      .from(prepTasks)
      .where(eq(prepTasks.serviceId, targetServiceId));
    const alreadyThere = new Set(existing.map((t) => t.description.trim().toLowerCase()));

    const wanted = source.filter((t) => !alreadyThere.has(t.description.trim().toLowerCase()));
    const skipped = source.length - wanted.length;

    if (wanted.length > 0) {
      let sortOrder = await nextSortOrder(targetServiceId);
      await db.insert(prepTasks).values(
        wanted.map((task) => ({
          serviceId: targetServiceId,
          stationId: task.stationId,
          kind: task.kind,
          sourceRecipeId: task.sourceRecipeId,
          sourceIngredientId: task.sourceIngredientId,
          // Deliberately no generation key: this is now somebody's own entry.
          generationKey: null,
          description: task.description,
          quantityBase: task.quantityBase,
          quantityUnit: task.quantityUnit,
          source: 'manual' as const,
          status: 'open' as const,
          assignedUserId: task.assignedUserId,
          notes: task.notes,
          usedBy: task.usedBy,
          sortOrder: sortOrder++,
        })),
      );
    }

    return { created: wanted.length, skipped, tasks: await listTasks(targetServiceId) };
  }

  async function countTasks(serviceId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(prepTasks)
      .where(eq(prepTasks.serviceId, serviceId));
    return row?.value ?? 0;
  }

  return {
    getServiceRow,
    listServices,
    findByDateAndPeriod,
    getService,
    createService,
    updateService,
    deleteService,
    listTasks,
    getTask,
    getTaskForApi,
    createTask,
    updateTask,
    deleteTask,
    isGone,
    expireRunning,
    listRunning,
    addToRunning,
    carryOver,
    countTasks,
  };
}

export type ServicesService = ReturnType<typeof createServicesService>;
