import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AllergenDetails, Season, UnitCode } from '@mise/domain';

/**
 * One server instance is one kitchen, so nothing here is scoped to a tenant.
 * That is the point of the self-hosted model: the isolation boundary is the
 * deployment, not a column.
 *
 * Quantities are stored twice. The base column is grams, millilitres or each,
 * which is what every calculation uses. The entered value and unit preserve
 * what the chef actually typed, so a recipe written in tablespoons still reads
 * in tablespoons.
 */

export const roleEnum = pgEnum('role', ['admin', 'head_chef', 'sous_chef', 'cook']);
export const unitSystemEnum = pgEnum('unit_system', ['metric', 'imperial']);
export const baseUnitEnum = pgEnum('base_unit', ['g', 'ml', 'each']);
export const recipeTypeEnum = pgEnum('recipe_type', ['dish', 'prep', 'component']);
export const recipeStatusEnum = pgEnum('recipe_status', ['draft', 'published', 'archived']);
export const servicePeriodEnum = pgEnum('service_period', [
  'breakfast',
  'lunch',
  'dinner',
  'prep_day',
  'event',
]);
export const serviceStatusEnum = pgEnum('service_status', ['planning', 'active', 'closed']);
export const prepTaskStatusEnum = pgEnum('prep_task_status', [
  'open',
  'in_progress',
  'done',
  'skipped',
]);
export const prepTaskSourceEnum = pgEnum('prep_task_source', ['generated', 'manual']);
export const prepTaskKindEnum = pgEnum('prep_task_kind', ['recipe', 'ingredient', 'other']);
/** Mirrors LANGUAGES in @mise/contracts; the API schemas check every value on the way out. */
export const languageEnum = pgEnum('language', ['en', 'nl', 'fr', 'es', 'de']);
/** One prep list per service, or one list the kitchen keeps adding to. */
export const prepModeEnum = pgEnum('prep_mode', ['per_service', 'running']);
/** What becomes of a line ticked off the running list once it has gone. */
export const tickedRetentionEnum = pgEnum('ticked_retention', ['keep', 'delete']);
/** Mirror SERVING_TEMPERATURES and COURSES in @mise/domain. */
export const servingTemperatureEnum = pgEnum('serving_temperature', [
  'cold',
  'room',
  'warm',
  'hot',
  'hot_and_cold',
]);
export const courseEnum = pgEnum('course', [
  'amuse',
  'starter',
  'middle',
  'main',
  'pre_dessert',
  'dessert',
  'mignardise',
  'side',
]);
/** How a dish card is printed: on white, or dark like the night screen. */
export const dishCardThemeEnum = pgEnum('dish_card_theme', ['day', 'night']);
/** Who may open a dish card. */
export const dishCardAccessEnum = pgEnum('dish_card_access', ['everyone', 'managers']);

// --- identity -------------------------------------------------------------

/** Exactly one row. Holds this instance's own settings. */
export const kitchens = pgTable('kitchen', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  unitSystem: unitSystemEnum('unit_system').notNull().default('metric'),
  language: languageEnum('language').notNull().default('en'),
  prepMode: prepModeEnum('prep_mode').notNull().default('per_service'),
  tickedRetention: tickedRetentionEnum('ticked_retention').notNull().default('keep'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stations = pgTable('station', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    /** Null for cooks who only ever sign in by PIN on a shared tablet. */
    email: text('email'),
    passwordHash: text('password_hash'),
    pinHash: text('pin_hash'),
    /** Digits in their PIN, so the tablet's pad can sign in the moment it is complete. */
    pinLength: integer('pin_length'),
    role: roleEnum('role').notNull().default('cook'),
    defaultStationId: uuid('default_station_id').references(() => stations.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    /** Their own interface language. Null follows the kitchen's. */
    language: languageEnum('language'),
    /** When they were offered the tour of the app. Null until they have been. */
    tourSeenAt: timestamp('tour_seen_at', { withTimezone: true }),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('app_user_email_key').on(t.email),
    // Someone with no way to sign in is a data-entry mistake, not a staff member.
    check(
      'app_user_has_a_credential',
      sql`${t.passwordHash} is not null or ${t.pinHash} is not null`,
    ),
    check(
      'app_user_password_needs_email',
      sql`${t.passwordHash} is null or ${t.email} is not null`,
    ),
  ],
);

/** A kitchen tablet an admin has enrolled. PIN sign-in only works on one. */
export const devices = pgTable('device', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/**
 * Sessions live in the database rather than in a signed token, so letting
 * someone go ends their access on the next request instead of whenever a token
 * happens to expire.
 */
export const sessions = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('session_user_idx').on(t.userId),
    index('session_expires_idx').on(t.expiresAt),
    index('session_device_idx').on(t.deviceId),
  ],
);

// --- recipes --------------------------------------------------------------

export const ingredients = pgTable(
  'ingredient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    category: text('category'),
    baseUnit: baseUnitEnum('base_unit').notNull().default('g'),
    allergens: jsonb('allergens').$type<string[]>().notNull().default([]),
    /** Grams per millilitre. Needed to convert between weight and volume. */
    densityGPerMl: real('density_g_per_ml'),
    /** Grams for one item. Needed to convert between count and weight. */
    itemWeightG: real('item_weight_g'),
    /** Edible portion as a percentage of what you buy. Onions are about 90. */
    yieldPercent: real('yield_percent').notNull().default(100),
    requiresPrep: boolean('requires_prep').notNull().default(false),
    /** True or false once someone has said. Null means nobody has, which is never vegan. */
    vegan: boolean('vegan'),
    /** Which gluten cereals and which nuts, as the law wants them named. */
    allergenDetails: jsonb('allergen_details')
      .$type<Partial<AllergenDetails>>()
      .notNull()
      .default({}),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ingredient_name_key').on(sql`lower(${t.name})`),
    check('ingredient_yield_range', sql`${t.yieldPercent} > 0 and ${t.yieldPercent} <= 100`),
  ],
);

export const recipes = pgTable(
  'recipe',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    type: recipeTypeEnum('type').notNull().default('prep'),
    status: recipeStatusEnum('status').notNull().default('draft'),
    stationId: uuid('station_id').references(() => stations.id, { onDelete: 'set null' }),
    /** One batch, in the canonical base unit of its dimension. */
    yieldBase: numeric('yield_base', { precision: 14, scale: 4, mode: 'number' }).notNull(),
    yieldEntered: numeric('yield_entered', { precision: 14, scale: 4, mode: 'number' }).notNull(),
    yieldUnit: text('yield_unit').notNull(),
    /** Plates one batch covers. Required for dishes, meaningless for a stock. */
    portions: real('portions'),
    prepMinutes: integer('prep_minutes'),
    cookMinutes: integer('cook_minutes'),
    shelfLifeHours: integer('shelf_life_hours'),
    storage: text('storage'),
    method: jsonb('method')
      .$type<{ text: string; minutes?: number | null }[]>()
      .notNull()
      .default([]),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    declaredAllergens: jsonb('declared_allergens').$type<string[]>().notNull().default([]),
    mayContain: jsonb('may_contain').$type<string[]>().notNull().default([]),
    // Front of house: what a dish card says about a dish beyond its spec.
    seasons: jsonb('seasons').$type<Season[]>().notNull().default([]),
    flavourProfile: jsonb('flavour_profile').$type<string[]>().notNull().default([]),
    servingTemperature: servingTemperatureEnum('serving_temperature'),
    course: courseEnum('course'),
    drinkPairings: jsonb('drink_pairings').$type<string[]>().notNull().default([]),
    cutlery: jsonb('cutlery').$type<string[]>().notNull().default([]),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('recipe_name_key').on(sql`lower(${t.name})`),
    index('recipe_station_idx').on(t.stationId),
    index('recipe_status_idx').on(t.status),
    check('recipe_yield_positive', sql`${t.yieldBase} > 0`),
  ],
);

/**
 * One line of a recipe. It points at an ingredient or at another recipe, never
 * both and never neither. That constraint is the recipe tree.
 */
export const recipeComponents = pgTable(
  'recipe_component',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    section: text('section'),
    note: text('note'),
    quantityBase: numeric('quantity_base', { precision: 14, scale: 4, mode: 'number' }).notNull(),
    quantityEntered: numeric('quantity_entered', {
      precision: 14,
      scale: 4,
      mode: 'number',
    }).notNull(),
    unitEntered: text('unit_entered').notNull(),
    ingredientId: uuid('ingredient_id').references(() => ingredients.id, { onDelete: 'restrict' }),
    childRecipeId: uuid('child_recipe_id').references(() => recipes.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('recipe_component_recipe_idx').on(t.recipeId),
    index('recipe_component_child_idx').on(t.childRecipeId),
    index('recipe_component_ingredient_idx').on(t.ingredientId),
    check(
      'recipe_component_one_target',
      sql`(${t.ingredientId} is not null)::int + (${t.childRecipeId} is not null)::int = 1`,
    ),
    check(
      'recipe_component_not_self',
      sql`${t.childRecipeId} is null or ${t.childRecipeId} <> ${t.recipeId}`,
    ),
  ],
);

export const recipePhotos = pgTable(
  'recipe_photo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    /** Path inside the uploads volume, never an absolute host path. */
    path: text('path').notNull(),
    caption: text('caption'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('recipe_photo_recipe_idx').on(t.recipeId)],
);

// --- mise en place --------------------------------------------------------

export const services = pgTable(
  'service',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    date: date('date').notNull(),
    period: servicePeriodEnum('period').notNull(),
    covers: integer('covers'),
    notes: text('notes'),
    status: serviceStatusEnum('status').notNull().default('planning'),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('service_date_period_key').on(t.date, t.period)],
);

export const serviceDishes = pgTable(
  'service_dish',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'restrict' }),
    plannedPortions: real('planned_portions').notNull(),
  },
  (t) => [
    uniqueIndex('service_dish_key').on(t.serviceId, t.recipeId),
    index('service_dish_recipe_idx').on(t.recipeId),
    check('service_dish_portions_positive', sql`${t.plannedPortions} > 0`),
  ],
);

/**
 * Prep tasks are real rows, not something recomputed on every page load,
 * because people edit them: they add jobs, reassign them, and tick them off.
 *
 * The generation key is what makes regeneration safe. It is stable for a given
 * source, so a second generate updates the quantity on an untouched task
 * instead of creating a duplicate, and leaves finished work alone.
 */
export const prepTasks = pgTable(
  'prep_task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for a line on the running list, which belongs to no service. */
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    stationId: uuid('station_id').references(() => stations.id, { onDelete: 'set null' }),
    kind: prepTaskKindEnum('kind').notNull().default('other'),
    sourceRecipeId: uuid('source_recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    sourceIngredientId: uuid('source_ingredient_id').references(() => ingredients.id, {
      onDelete: 'set null',
    }),
    generationKey: text('generation_key'),
    description: text('description').notNull(),
    quantityBase: numeric('quantity_base', { precision: 14, scale: 4, mode: 'number' }),
    quantityUnit: text('quantity_unit'),
    source: prepTaskSourceEnum('source').notNull().default('manual'),
    status: prepTaskStatusEnum('status').notNull().default('open'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: jsonb('notes').$type<string[]>().notNull().default([]),
    usedBy: jsonb('used_by')
      .$type<
        { recipeId: string; recipeName: string; quantity: { value: number; unit: UnitCode } }[]
      >()
      .notNull()
      .default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set when a chef changes what the line says, its amount or its station. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prep_task_service_idx').on(t.serviceId),
    index('prep_task_station_idx').on(t.stationId),
    index('prep_task_assignee_idx').on(t.assignedUserId),
    index('prep_task_source_recipe_idx').on(t.sourceRecipeId),
    index('prep_task_source_ingredient_idx').on(t.sourceIngredientId),
    index('prep_task_completed_by_idx').on(t.completedBy),
    // The running list asks for open lines and lines ticked in the last two hours.
    index('prep_task_list_idx').on(t.serviceId, t.status, t.completedAt),
    uniqueIndex('prep_task_generation_key').on(t.serviceId, t.generationKey),
  ],
);

// --- relations ------------------------------------------------------------

export const recipeRelations = relations(recipes, ({ many, one }) => ({
  components: many(recipeComponents, { relationName: 'recipeComponents' }),
  photos: many(recipePhotos),
  station: one(stations, { fields: [recipes.stationId], references: [stations.id] }),
}));

export const recipeComponentRelations = relations(recipeComponents, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeComponents.recipeId],
    references: [recipes.id],
    relationName: 'recipeComponents',
  }),
  ingredient: one(ingredients, {
    fields: [recipeComponents.ingredientId],
    references: [ingredients.id],
  }),
  childRecipe: one(recipes, {
    fields: [recipeComponents.childRecipeId],
    references: [recipes.id],
    relationName: 'childRecipe',
  }),
}));

export const serviceRelations = relations(services, ({ many }) => ({
  dishes: many(serviceDishes),
  tasks: many(prepTasks),
}));

export const serviceDishRelations = relations(serviceDishes, ({ one }) => ({
  service: one(services, { fields: [serviceDishes.serviceId], references: [services.id] }),
  recipe: one(recipes, { fields: [serviceDishes.recipeId], references: [recipes.id] }),
}));

export const prepTaskRelations = relations(prepTasks, ({ one }) => ({
  service: one(services, { fields: [prepTasks.serviceId], references: [services.id] }),
  station: one(stations, { fields: [prepTasks.stationId], references: [stations.id] }),
  assignee: one(users, { fields: [prepTasks.assignedUserId], references: [users.id] }),
}));

export const userRelations = relations(users, ({ one, many }) => ({
  defaultStation: one(stations, { fields: [users.defaultStationId], references: [stations.id] }),
  sessions: many(sessions),
}));

// --- backups --------------------------------------------------------------

/**
 * Exactly one row, created the first time backups are looked at. Never part of
 * a backup itself: it holds the key that opens them.
 */
export const backupSettings = pgTable('backup_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Opens every backup this server makes. Printed by an administrator. */
  recoveryKey: text('recovery_key').notNull(),
  keyConfirmedAt: timestamp('key_confirmed_at', { withTimezone: true }),
  /** 'local', 'webdav' for a NAS or Nextcloud, or 'onedrive'. */
  destination: text('destination').notNull().default('local'),
  webdavUrl: text('webdav_url'),
  webdavUsername: text('webdav_username'),
  webdavPassword: text('webdav_password'),
  /** Lets Mise into the app folder of someone's OneDrive. Replaced as Microsoft rotates it. */
  onedriveRefreshToken: text('onedrive_refresh_token'),
  /** Whose OneDrive, as shown on the settings page. */
  onedriveAccount: text('onedrive_account'),
  /** Hour of the day, in timeZone, when the nightly backup runs. */
  hour: integer('hour').notNull().default(4),
  timeZone: text('time_zone').notNull().default('UTC'),
  keepLocal: integer('keep_local').notNull().default(7),
  keepRemote: integer('keep_remote').notNull().default(30),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  /** What the last backup contained, so an unchanged kitchen isn't written again. */
  lastFingerprint: text('last_fingerprint'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- dish cards -----------------------------------------------------------

/**
 * Exactly one row: how this kitchen's dish cards look. Part of every backup,
 * along with the logo it points at.
 */
export const dishCardSettings = pgTable('dish_card_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Replaces "Dish card · kitchen name" at the top. Null keeps that. */
  title: text('title'),
  locationName: text('location_name'),
  address: text('address'),
  /** A file in the uploads volume, like a plating photo. */
  logoPath: text('logo_path'),
  /** The kitchen's own warning, one per language it has written one in. */
  warnings: jsonb('warnings').$type<Partial<Record<string, string>>>().notNull().default({}),
  /** Parts of the card switched off. Anything not listed is shown. */
  hidden: jsonb('hidden').$type<string[]>().notNull().default([]),
  theme: dishCardThemeEnum('theme').notNull().default('day'),
  access: dishCardAccessEnum('access').notNull().default('everyone'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One prep line as stored. */
export type PrepTaskRow = typeof prepTasks.$inferSelect;
