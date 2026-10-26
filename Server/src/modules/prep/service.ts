import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { CreatePrepTask, TickedRetention, UpdatePrepTask } from '@mise/contracts';
import { baseUnitOf, toBase, type UnitCode } from '@mise/domain';
import type { Database } from '../../db/client.js';
import { prepTasks, stations, users } from '../../db/schema.js';

/**
 * The prep list.
 *
 * One running list for the whole kitchen. Lines go on by hand, get ticked off,
 * and are gone two hours after they are ticked, so the list is always the work
 * in front of the brigade and never three years of it.
 */

/** How long a ticked line stays on the list before it is gone for good. */
export const RUNNING_TICK_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** Anything ticked before this moment has dropped off the list. */
export function runningCutoff(now = Date.now()): Date {
  return new Date(now - RUNNING_TICK_LIFETIME_MS);
}

/**
 * Quantities are stored in the canonical base unit for their dimension, the
 * same as everywhere else, so "2 kg" and "500 g" of the same thing add up.
 */
function toBaseQuantity(quantity: { value: number; unit: string } | null | undefined) {
  if (!quantity) return { quantityBase: null, quantityUnit: null };
  const unit = quantity.unit as UnitCode;
  return {
    quantityBase: toBase({ value: quantity.value, unit }),
    quantityUnit: baseUnitOf(unit) as string,
  };
}

/** Station order is how the kitchen is laid out, which is how a prep list should read. */
const TASK_ORDER = [asc(stations.sortOrder), asc(prepTasks.sortOrder), asc(prepTasks.description)];

export function createPrepService(db: Database) {
  /**
   * Joined against staff twice, so the list can say who it is for and who
   * actually finished it. Those are often not the same person.
   */
  const assignee = db.select().from(users).as('assignee');
  const completer = db.select().from(users).as('completer');

  function selectTasks() {
    return db
      .select({
        id: prepTasks.id,
        stationId: prepTasks.stationId,
        recipeId: prepTasks.recipeId,
        description: prepTasks.description,
        quantityBase: prepTasks.quantityBase,
        quantityUnit: prepTasks.quantityUnit,
        status: prepTasks.status,
        assignedUserId: prepTasks.assignedUserId,
        assignedUserName: assignee.displayName,
        completedByName: completer.displayName,
        completedAt: prepTasks.completedAt,
        sortOrder: prepTasks.sortOrder,
      })
      .from(prepTasks)
      .leftJoin(assignee, eq(assignee.id, prepTasks.assignedUserId))
      .leftJoin(completer, eq(completer.id, prepTasks.completedBy))
      .leftJoin(stations, eq(stations.id, prepTasks.stationId));
  }

  // Every tablet asks for these after every tick. Prepared once, so the SQL
  // isn't rebuilt on each request, which is a third of the work on a Pi.
  const visibleTasks = selectTasks()
    .where(
      or(
        ne(prepTasks.status, 'done'),
        isNull(prepTasks.completedAt),
        gte(prepTasks.completedAt, sql.placeholder('cutoff')),
      ),
    )
    .orderBy(...TASK_ORDER)
    .prepare('visible_tasks');
  const taskById = selectTasks()
    .where(eq(prepTasks.id, sql.placeholder('id')))
    .limit(1)
    .prepare('task_by_id');

  async function getTask(id: string) {
    const [row] = await db.select().from(prepTasks).where(eq(prepTasks.id, id)).limit(1);
    return row ?? null;
  }

  /** Find one task by id, in the joined shape the API returns. */
  async function getTaskForApi(id: string) {
    const [row] = await taskById.execute({ id });
    return row ?? null;
  }

  async function nextSortOrder(): Promise<number> {
    const [row] = await db
      .select({ value: sql<number>`coalesce(max(${prepTasks.sortOrder}), -1)::int` })
      .from(prepTasks);
    return (row?.value ?? -1) + 1;
  }

  async function createTask(input: CreatePrepTask) {
    const [row] = await db
      .insert(prepTasks)
      .values({
        stationId: input.stationId ?? null,
        recipeId: input.recipeId ?? null,
        description: input.description,
        ...toBaseQuantity(input.quantity),
        status: 'open',
        assignedUserId: input.assignedUserId ?? null,
        sortOrder: await nextSortOrder(),
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

  /**
   * A line ticked more than two hours ago. It cannot be seen and cannot be
   * unticked; if the job needs doing again, it goes back on by hand.
   */
  function isGone(task: { status: string; completedAt: Date | null }) {
    return (
      task.status === 'done' && task.completedAt !== null && task.completedAt < runningCutoff()
    );
  }

  /**
   * Apply the kitchen's choice for lines that have dropped off: kept out of
   * sight for the record, or deleted so they cost no space. Returns how many
   * were deleted.
   */
  async function expire(retention: TickedRetention): Promise<number> {
    if (retention !== 'delete') return 0;
    const removed = await db
      .delete(prepTasks)
      .where(and(eq(prepTasks.status, 'done'), lt(prepTasks.completedAt, runningCutoff())))
      .returning({ id: prepTasks.id });
    return removed.length;
  }

  /** What is on the list right now. */
  async function listTasks() {
    // As text: the Postgres driver won't take a Date as a prepared parameter.
    return visibleTasks.execute({ cutoff: runningCutoff().toISOString() });
  }

  /**
   * Put a line on the list. When the same thing is already waiting on the
   * same station, in a unit that adds up, the amount goes onto that line:
   * "2 kg onions" and later "500 g onions" become one line for 2.5 kg.
   */
  async function addTask(input: CreatePrepTask) {
    const added = toBaseQuantity(input.quantity);

    const candidates = await db
      .select()
      .from(prepTasks)
      .where(
        and(
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

    if (!match) return { task: await createTask(input), merged: false };

    const linksRecipe = !match.recipeId && input.recipeId;
    if (added.quantityBase !== null || linksRecipe) {
      await db
        .update(prepTasks)
        .set({
          ...(added.quantityBase !== null
            ? {
                quantityBase: (match.quantityBase ?? 0) + added.quantityBase,
                quantityUnit: match.quantityUnit ?? added.quantityUnit,
              }
            : {}),
          // Typed by hand first and picked from the book later: keep the link.
          ...(linksRecipe ? { recipeId: input.recipeId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(prepTasks.id, match.id));
    }

    return { task: await getTaskForApi(match.id), merged: true };
  }

  return {
    listTasks,
    getTask,
    getTaskForApi,
    addTask,
    updateTask,
    deleteTask,
    isGone,
    expire,
  };
}

export type PrepService = ReturnType<typeof createPrepService>;
