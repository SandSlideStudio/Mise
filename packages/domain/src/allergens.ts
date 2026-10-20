/**
 * The fourteen allergens that must be declared under EU food information law,
 * which is what a European professional kitchen is inspected against.
 */

export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const;

export type Allergen = (typeof ALLERGENS)[number];

const LABELS: Record<Allergen, string> = {
  gluten: 'Cereals containing gluten',
  crustaceans: 'Crustaceans',
  eggs: 'Eggs',
  fish: 'Fish',
  peanuts: 'Peanuts',
  soybeans: 'Soybeans',
  milk: 'Milk',
  nuts: 'Tree nuts',
  celery: 'Celery',
  mustard: 'Mustard',
  sesame: 'Sesame',
  sulphites: 'Sulphur dioxide and sulphites',
  lupin: 'Lupin',
  molluscs: 'Molluscs',
};

export function allergenLabel(a: Allergen): string {
  return LABELS[a];
}

export function isAllergen(value: string): value is Allergen {
  return (ALLERGENS as readonly string[]).includes(value);
}

/** Union of several allergen lists, in the canonical declaration order. */
export function mergeAllergens(...lists: readonly (readonly Allergen[])[]): Allergen[] {
  const seen = new Set<Allergen>();
  for (const list of lists) {
    for (const a of list) seen.add(a);
  }
  return ALLERGENS.filter((a) => seen.has(a));
}

/**
 * What a dish declares. `contains` is certain, `mayContain` is a cross-contact
 * warning that never gets promoted to `contains` by a roll-up.
 */
export interface AllergenProfile {
  contains: Allergen[];
  mayContain: Allergen[];
}

export function emptyAllergenProfile(): AllergenProfile {
  return { contains: [], mayContain: [] };
}

export function mergeProfiles(...profiles: readonly AllergenProfile[]): AllergenProfile {
  const contains = mergeAllergens(...profiles.map((p) => p.contains));
  // Anything definitely present outranks a "may contain" on the same allergen.
  const mayContain = mergeAllergens(...profiles.map((p) => p.mayContain)).filter(
    (a) => !contains.includes(a),
  );
  return { contains, mayContain };
}
