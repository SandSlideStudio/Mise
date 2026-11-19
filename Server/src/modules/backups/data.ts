import { sql } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { Database, Transaction } from '../../db/client.js';
import * as schema from '../../db/schema.js';

/**
 * Which tables a backup holds, in the order they can be put back: anything a
 * row points at comes before it.
 */
export const BACKED_UP: PgTable[] = [
  schema.kitchens,
  schema.stations,
  schema.users,
  schema.devices,
  schema.ingredients,
  // After ingredients and staff: each check is an ingredient's, and says who read the label.
  schema.ingredientLabelChecks,
  schema.recipes,
  schema.recipeComponents,
  schema.recipePhotos,
  // After recipes and staff: each entry is a dish's, and says who changed it.
  schema.dishAllergenChanges,
  // After recipes: a checklist line can point at one.
  schema.prepChecklistItems,
  schema.prepTasks,
  schema.dishCardSettings,
  schema.menus,
  schema.menuDishes,
];

/**
 * Left out on purpose. Everyone signs in again after a restore, the backup
 * settings hold the key that opens the backups, and outside devices are
 * approved for this server, not for whichever one a backup lands on; the
 * same goes for how the server is reached.
 */
export const NOT_BACKED_UP: PgTable[] = [
  schema.sessions,
  schema.backupSettings,
  schema.remoteDevices,
  schema.connectionSettings,
  schema.writeReceipts,
];

/**
 * Rows from older backups that this version no longer has a place for. Before
 * 2.0, a prep line could belong to a service; services are gone, and a
 * restore shouldn't tip years of finished service lists onto the one list.
 */
const LEFT_BEHIND: Record<string, (row: Record<string, unknown>) => boolean> = {
  prep_task: (row) => row.service_id != null,
};

/** Rows go back in batches, so no single statement gets large. */
const BATCH = 500;

export interface TableDump {
  name: string;
  json: string;
  rows: number;
  /**
   * What the table holds, for telling whether anything changed since the last
   * backup: every row in a fixed order, without when a tablet was last seen,
   * which changes all day without anything worth a new backup.
   */
  fingerprint: string;
}

/**
 * Each table as one JSON array, written by Postgres itself so every type
 * (dates, numbers, JSON columns) comes out in a form it reads back exactly.
 */
export async function exportTables(db: Database): Promise<TableDump[]> {
  const dumps: TableDump[] = [];
  for (const table of BACKED_UP) {
    const [row] = await db
      .select({
        json: sql<string>`coalesce(json_agg(${table}), '[]'::json)::text`,
        rows: sql<number>`count(*)::int`,
        fingerprint: sql<string>`coalesce(md5(string_agg((to_jsonb(${table}) - 'last_seen_at')::text, ',' order by (to_jsonb(${table}) - 'last_seen_at')::text)), '')`,
      })
      .from(table);
    dumps.push({
      name: getTableConfig(table).name,
      json: row?.json ?? '[]',
      rows: row?.rows ?? 0,
      fingerprint: row?.fingerprint ?? '',
    });
  }
  return dumps;
}

/**
 * Columns whose default is for new kitchens, not for data from before they
 * existed: a 2.3 kitchen kept its ticked lines for good, and restoring its
 * backup must not turn that into a year.
 */
const AS_IN_OLDER_BACKUPS: Record<string, Record<string, unknown>> = {
  kitchen: { ticked_keep_days: null },
};

/**
 * Put the tables back, replacing whatever is there. Columns are matched by
 * name: a column this version no longer has is skipped, and one it added since
 * the backup gets its default. Run inside a transaction.
 */
export async function restoreTables(
  tx: Transaction,
  dumps: Map<string, string>,
): Promise<Map<string, number>> {
  for (const table of [...BACKED_UP].reverse()) await tx.delete(table);

  const counts = new Map<string, number>();
  for (const table of BACKED_UP) {
    const { name, columns } = getTableConfig(table);
    const leftBehind = LEFT_BEHIND[name];
    const rows = (JSON.parse(dumps.get(name) ?? '[]') as Record<string, unknown>[]).filter(
      (row) => !leftBehind?.(row),
    );
    counts.set(name, rows.length);
    if (rows.length === 0) continue;

    // A column added since, whose default is wrong for older data, gets the
    // value the older version behaved as.
    const older = AS_IN_OLDER_BACKUPS[name] ?? {};
    for (const row of rows) {
      for (const [column, value] of Object.entries(older))
        if (!(column in row)) row[column] = value;
    }
    const inBackup = new Set(Object.keys(rows[0]!));
    const shared = columns.map((column) => column.name).filter((column) => inBackup.has(column));
    const list = sql.join(
      shared.map((column) => sql.identifier(column)),
      sql`, `,
    );
    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = JSON.stringify(rows.slice(start, start + BATCH));
      await tx.execute(
        sql`insert into ${table} (${list}) select ${list} from json_populate_recordset(null::${table}, ${batch}::json)`,
      );
    }
  }
  return counts;
}
