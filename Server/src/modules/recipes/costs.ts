import {
  CURRENCIES,
  recipeCostAt,
  type CostSettings,
  type Currency,
  type Role,
} from '@mise/contracts';
import type { Executor } from '../../db/client.js';
import { kitchens } from '../../db/schema.js';
import { MANAGERS } from '../../plugins/auth.js';

/**
 * Food cost over the API.
 *
 * Costs are management information: chefs and administrators see them, cooks
 * never do. Every answer leaves the cost fields out for a cook rather than
 * sending them for the app to hide, and the bundle for offline use is built
 * the same way, so a price can't be read off a tablet's storage either.
 */

export function seesCosts(user: { role: Role } | null | undefined): boolean {
  return user ? MANAGERS.includes(user.role) : false;
}

export type { CostSettings };

export function currencyOf(value: string): Currency {
  return (CURRENCIES as readonly string[]).includes(value) ? (value as Currency) : 'EUR';
}

export async function loadCostSettings(db: Executor): Promise<CostSettings> {
  const [row] = await db
    .select({ currency: kitchens.currency, foodVatPercent: kitchens.foodVatPercent })
    .from(kitchens)
    .limit(1);
  return { currency: currencyOf(row?.currency ?? 'EUR'), foodVatPercent: row?.foodVatPercent ?? 9 };
}

/** What a recipe costs at a multiplier of its batch; shared with the tablets' offline copy. */
export const costAgainst = recipeCostAt;
