import type { QueryClient } from '@tanstack/react-query';
import type { Station } from '@mise/contracts';
import { formatQuantity, humanize, isUnitCode } from '@mise/domain';
import {
  allergenName,
  courseName,
  recipeStatusName,
  recipeTypeName,
  temperatureName,
  type MessageKey,
  type Translator,
} from '../i18n/index.js';
import { knownNames, menuDishAsSent } from '../api/offlineEdits.js';

/**
 * Both sides of a conflict, the way a chef reads them: field names in their
 * own language, stations and dishes by name, amounts as amounts, steps as
 * steps. Never an id or a code.
 */

/** What is around to name things with: stations, ingredients, recipes and dishes. */
export interface Naming {
  stations: Map<string, string>;
  names: Map<string, string>;
  dishName: (recipeId: string) => string | null;
}

export function namingFrom(queryClient: QueryClient): Naming {
  const stations = new Map(
    (queryClient.getQueryData<Station[]>(['stations']) ?? []).map((s) => [s.id, s.name]),
  );
  const names = knownNames(queryClient);
  return {
    stations,
    names,
    dishName: (recipeId) =>
      menuDishAsSent(queryClient, recipeId)?.name ?? names.get(recipeId) ?? null,
  };
}

const FIELD_NAMES: Record<string, MessageKey> = {
  name: 'common.name',
  text: 'offline.field.note',
  notes: 'offline.field.notes',
  method: 'offline.field.method',
  description: 'offline.field.description',
  tags: 'offline.field.tags',
  components: 'offline.field.components',
  dishes: 'offline.field.dishes',
  type: 'offline.field.type',
  status: 'editor.status',
  stationId: 'common.station',
  yield: 'offline.field.yield',
  portions: 'offline.field.portions',
  prepMinutes: 'offline.field.prepMinutes',
  cookMinutes: 'offline.field.cookMinutes',
  shelfLifeHours: 'offline.field.keeps',
  storage: 'recipe.storage',
  declaredAllergens: 'offline.field.allergens',
  allergens: 'offline.field.allergens',
  allergenDetails: 'offline.field.allergens',
  mayContain: 'offline.field.mayContain',
  flavourProfile: 'editor.flavour',
  servingTemperature: 'editor.temperature',
  course: 'editor.course',
  drinkPairings: 'editor.drinks',
  cutlery: 'editor.cutlery',
};

export function fieldName(translator: Translator, key: string): string {
  const known = FIELD_NAMES[key];
  if (known) return translator.t(known);
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const NOTHING = '—';

function amount(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { value: n, unit } = value as { value?: unknown; unit?: unknown };
  if (typeof n !== 'number' || typeof unit !== 'string') return null;
  return isUnitCode(unit) ? formatQuantity(humanize({ value: n, unit })) : `${n} ${unit}`;
}

function refName(ref: unknown, naming: Naming): string | null {
  if (!ref || typeof ref !== 'object') return null;
  const { ingredientId, recipeId } = ref as { ingredientId?: string; recipeId?: string };
  const id = ingredientId ?? recipeId;
  return id ? (naming.names.get(id) ?? null) : null;
}

/**
 * One side of one field as text. `kind` is what was changed ("recipes",
 * "menus"), for the fields both have but name differently, like status.
 */
export function showValue(
  translator: Translator,
  kind: string,
  key: string,
  value: unknown,
  naming: Naming,
): string {
  const { t, plural } = translator;
  if (value === null || value === undefined || value === '') return NOTHING;
  if (Array.isArray(value) && value.length === 0) return NOTHING;

  switch (key) {
    case 'type':
      return recipeTypeName(t, String(value));
    case 'status':
      return kind === 'menus'
        ? t(`menuStatus.${String(value)}` as MessageKey)
        : recipeStatusName(t, String(value));
    case 'stationId':
      return naming.stations.get(String(value)) ?? t('offline.unknownStation');
    case 'yield':
      return amount(value) ?? NOTHING;
    case 'prepMinutes':
    case 'cookMinutes':
      return t('recipe.minutes', { count: Number(value) });
    case 'shelfLifeHours': {
      const hours = Number(value);
      return hours % 24 === 0
        ? plural('recipeCard.days', hours / 24)
        : plural('recipeCard.hours', hours);
    }
    case 'servingTemperature':
      return temperatureName(t, String(value));
    case 'course':
      return courseName(t, String(value));
    case 'allergenDetails': {
      // Which cereals and nuts, as typed.
      const details = value as { gluten?: string[]; nuts?: string[] };
      const names = [...(details.gluten ?? []), ...(details.nuts ?? [])];
      return names.length > 0 ? names.join(', ') : NOTHING;
    }
    case 'allergens':
    case 'declaredAllergens':
    case 'mayContain':
      return (value as string[]).map((a) => allergenName(t, a)).join(', ');
    case 'method':
      return (value as { text?: string }[])
        .map((step, index) => `${index + 1}. ${step.text ?? ''}`)
        .join('\n');
    case 'components':
      return (value as Record<string, unknown>[])
        .map((part) => {
          const name =
            (typeof part.displayName === 'string' ? part.displayName : null) ??
            refName(part.ref, naming) ??
            '…';
          const much = amount(part.quantity);
          return much ? `${much} ${name}` : name;
        })
        .join('\n');
    case 'dishes':
      return (value as unknown[])
        .map((dish) =>
          typeof dish === 'string'
            ? (naming.dishName(dish) ?? '…')
            : String((dish as { name?: unknown }).name ?? '…'),
        )
        .join('\n');
  }

  if (typeof value === 'boolean') return value ? t('offline.yes') : t('offline.no');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const names = value.map((item) =>
      item && typeof item === 'object'
        ? String((item as Record<string, unknown>).name ?? '…')
        : String(item),
    );
    return names.every((name) => name === '…')
      ? plural('offline.items', value.length)
      : names.join(', ');
  }
  const much = amount(value);
  if (much) return much;
  if (typeof value === 'object' && 'name' in value) return String(value.name);
  return NOTHING;
}
