import { PGlite } from '@electric-sql/pglite';
import { keptAs } from '@mise/domain';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Filling in how each recipe is kept, on the way to the version that asks.
 *
 * The migration reads the storage notes in SQL, while labels on tablets with
 * older copies still read them with keptAs(). The two must give the same
 * answer for any note, or a recipe's label would change at the update.
 */

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
const files = readdirSync(folder)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const statements = (file: string) =>
  readFileSync(path.join(folder, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((sql) => sql.trim())
    .filter(Boolean);

const NOTES = [
  // Chilled, in every language.
  'Vac-packed in the walk-in',
  'In the fridge',
  'Koelcel',
  'gekoeld bewaren',
  'Kühlschrank',
  'gekühlt',
  'GEKÜHLT LAGERN',
  'Chambre froide',
  'au réfrigérateur',
  'En la nevera',
  'cámara frigorífica',
  // Frozen and dry.
  'Freezer',
  'frozen in portions',
  'Diepvries',
  'Tiefkühler',
  'Congélateur',
  'congelado',
  'Surgelé',
  'Dry store',
  'Ambient',
  'Droog en donker',
  'trocken lagern',
  'En despensa',
  'Raumtemperatur',
  // A temperature decides.
  'Koelcel, 4 °C',
  'Koelcel, 3 °C',
  'fridge at 4°C',
  'Walk-in, 6 °C',
  'Walk-in, 6,5 °C',
  'Walk-in, 7.5 °C',
  '-18 °C',
  '-18C',
  '\u221218 °C',
  'Vriezer \u201320°C',
  'kept at 12 graden',
  '20 grados, en despensa',
  '3 Grad',
  '2 degrees',
  // A range, by its warmest end: not a temperature below zero.
  '2-7 °C',
  'Koelcel 0–4°C',
  'fridge 2-8°C',
  '0 - 7 °C',
  'Vriezer -22 - -18 °C',
  // Both said: the shorter date.
  'Frozen, thaw in the fridge',
  // Nothing to place.
  'Gastro 1/1, cling film',
  'Sundry tub',
  '4 cups',
  '   ',
  'Labelled tubs',
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  const kept = files.find((name) => name.includes('_recipe_kept'))!;
  for (const file of files.filter((name) => name < kept)) {
    for (const sql of statements(file)) await db.exec(sql);
  }
  for (const [index, note] of NOTES.entries()) {
    await db.query(
      `insert into recipe (name, yield_base, yield_entered, yield_unit, storage)
       values ($1, 1000, 1, 'l', $2)`,
      [`Recipe ${index}`, note],
    );
  }
  await db.query(`insert into recipe (name, yield_base, yield_entered, yield_unit, storage)
                  values ('No note', 1000, 1, 'l', null)`);
  for (const sql of statements(kept)) await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe('filling in how recipes are kept', () => {
  it('reads every note the way the labels did', async () => {
    const { rows } = await db.query<{ storage: string; kept: string | null }>(
      `select storage, kept from recipe where storage is not null order by name`,
    );
    expect(rows).toHaveLength(NOTES.length);
    for (const row of rows) expect(row.kept, row.storage).toBe(keptAs(row.storage));
  });

  it('chooses where the note is clear and leaves the rest unchosen', async () => {
    const { rows } = await db.query<{ storage: string | null; kept: string | null }>(
      `select storage, kept from recipe`,
    );
    const of = (storage: string | null) => rows.find((row) => row.storage === storage)?.kept;
    expect(of('Koelcel, 4 °C')).toBe('chilled_4');
    expect(of('Koelcel')).toBe('chilled_7');
    expect(of('-18C')).toBe('frozen');
    expect(of('\u221218 °C')).toBe('frozen');
    expect(of('Droog en donker')).toBe('ambient');
    expect(of('2-7 °C')).toBe('chilled_7');
    expect(of('fridge 2-8°C')).toBeNull();
    expect(of('Labelled tubs')).toBeNull();
    expect(of(null)).toBeNull();
  });
});
