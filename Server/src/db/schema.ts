import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
import type { AllergenDetails } from '@mise/domain';

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
export const prepTaskStatusEnum = pgEnum('prep_task_status', [
  'open',
  'in_progress',
  'done',
  'skipped',
]);
/** Mirrors LANGUAGES in @mise/contracts; the API schemas check every value on the way out. */
export const languageEnum = pgEnum('language', ['en', 'nl', 'fr', 'es', 'de']);
/** What becomes of a line ticked off the running list once it has gone. */
export const tickedRetentionEnum = pgEnum('ticked_retention', ['keep', 'delete']);
/** Mirrors LABEL_SIZES in @mise/contracts: the roll in the kitchen's label printer. */
export const labelSizeEnum = pgEnum('label_size', [
  '62x29',
  '62x100',
  '54x25',
  '57x32',
  '89x36',
  '102x51',
]);
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
/** Whether a menu is being written, on, or in the past. */
export const menuStatusEnum = pgEnum('menu_status', ['draft', 'active', 'archived']);
/** Who may open a dish card. */
export const dishCardAccessEnum = pgEnum('dish_card_access', ['everyone', 'managers']);

// --- identity -------------------------------------------------------------

/** Exactly one row. Holds this instance's own settings. */
export const kitchens = pgTable('kitchen', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // No longer used since 2.2.4: amounts are metric. Kept so older backups restore.
  unitSystem: unitSystemEnum('unit_system').notNull().default('metric'),
  language: languageEnum('language').notNull().default('en'),
  tickedRetention: tickedRetentionEnum('ticked_retention').notNull().default('keep'),
  /**
   * The note above the prep list for the next shift, and who left it when.
   * The name is kept as written, so the note still says who left it after
   * they have left the kitchen.
   */
  handoverNote: text('handover_note'),
  handoverNoteBy: text('handover_note_by'),
  handoverNoteAt: timestamp('handover_note_at', { withTimezone: true }),
  /** Ask GitHub once a day whether a newer Mise is out. An administrator can switch it off. */
  updateCheck: boolean('update_check').notNull().default(true),
  /** The chef's checklist on the prep list, for anyone to tick what's needed. Off unless chosen. */
  prepChecklist: boolean('prep_checklist').notNull().default(false),
  /** When the checklist last changed: the version an edit starts from. */
  prepChecklistUpdatedAt: timestamp('prep_checklist_updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * When an administrator chose sign-in by PIN alone, with no name to pick.
   * It takes effect once everyone with a PIN has been given a new one since.
   * Null: tablets show the names, as before.
   */
  pinOnlySince: timestamp('pin_only_since', { withTimezone: true }),
  /** Sign out of a shared tablet after this many minutes untouched. Null: never. */
  idleSignOutMinutes: integer('idle_sign_out_minutes'),
  /**
   * Kept ticked lines (tickedRetention 'keep') are removed after this many
   * days, so the record doesn't grow forever with who did what. Null: never.
   */
  tickedKeepDays: integer('ticked_keep_days').default(365),
  /** The labels for containers of prep: which roll, and whether ticking a line prints one. */
  labelSize: labelSizeEnum('label_size').notNull().default('62x29'),
  labelOnTick: boolean('label_on_tick').notNull().default(false),
  /** Costing: the one currency prices are in, and the VAT on food sold, in per cent. */
  currency: text('currency').notNull().default('EUR'),
  foodVatPercent: real('food_vat_percent').notNull().default(9),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const stations = pgTable('station', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The chef's checklist for the prep list: what this kitchen makes, by station.
 * Anyone ticks what's needed and it goes on the list; nothing is kept here
 * about what was ticked.
 */
export const prepChecklistItems = pgTable(
  'prep_checklist_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id').references(() => stations.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    /** The recipe the line is made from, if any: the prep line it adds links to it. */
    recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    /**
     * The par: how much the chef wants ready, kept in the unit the chef chose
     * so "2 dozen" stays 2 dozen. Both null: no par.
     */
    parValue: numeric('par_value', { precision: 14, scale: 4, mode: 'number' }),
    parUnit: text('par_unit'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prep_checklist_item_station_idx').on(t.stationId),
    index('prep_checklist_item_recipe_idx').on(t.recipeId),
  ],
);

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
    /** When the PIN was last set: PIN-only sign-in needs one set after it was chosen. */
    pinSetAt: timestamp('pin_set_at', { withTimezone: true }),
    role: roleEnum('role').notNull().default('cook'),
    defaultStationId: uuid('default_station_id').references(() => stations.id, {
      onDelete: 'set null',
    }),
    active: boolean('active').notNull().default(true),
    /** Their own interface language. Null follows the kitchen's. */
    language: languageEnum('language'),
    /** When they were offered the tour of the app. Null until they have been. */
    tourSeenAt: timestamp('tour_seen_at', { withTimezone: true }),
    /** Never counted: failures are kept in memory (lockout.ts). Kept for older backups. */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('app_user_email_key').on(t.email),
    // The app checks emails without caring about capitals; so does the database
    // since 2.3, so two people signing up at once can't both get one.
    uniqueIndex('app_user_email_lower_key').on(sql`lower(${t.email})`),
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
 * A phone or laptop outside the kitchen's network that asked to reach Mise.
 *
 * From outside, nothing but the request page answers until a chef or an
 * administrator approves the device, so a stranger can't even reach the
 * sign-in form. The token lives in the device's cookie; only its hash is here.
 * Approval lasts until it is revoked, or until the device goes 90 days unused.
 * Kept out of backups: approvals belong to this server, like sessions.
 */
export const remoteDevices = pgTable(
  'remote_device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** What the person asking reads out, so the approver knows it is them. */
    code: text('code').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: text('status', { enum: ['pending', 'approved'] })
      .notNull()
      .default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    /** The approving device's name when approved from outside; null from the kitchen. */
    approvedFrom: text('approved_from'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    address: text('address'),
  },
  (t) => [
    uniqueIndex('remote_device_token_key').on(t.tokenHash),
    index('remote_device_status_idx').on(t.status),
    check('remote_device_status_known', sql`${t.status} in ('pending', 'approved')`),
  ],
);

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
    /**
     * Traces the supplier's label warns about ("may contain nuts"): what
     * cross-contact at the supplier means for every dish it goes into.
     */
    mayContain: jsonb('may_contain').$type<string[]>().notNull().default([]),
    /** Grams per millilitre. Needed to convert between weight and volume. */
    // Density, weight per piece and trim yield were not asked for from 2.2.4
    // until costing used them; what was entered before was kept for it.
    densityGPerMl: real('density_g_per_ml'),
    /** Grams for one item. Needed to convert between count and weight. */
    itemWeightG: real('item_weight_g'),
    /** Edible portion as a percentage of what you buy. Onions are about 90. */
    yieldPercent: real('yield_percent').notNull().default(100),
    /** True or false once someone has said. Null means nobody has, which is never vegan. */
    vegan: boolean('vegan'),
    /** Which gluten cereals and which nuts, as the law wants them named. */
    allergenDetails: jsonb('allergen_details')
      .$type<Partial<AllergenDetails>>()
      .notNull()
      .default({}),
    notes: text('notes'),
    /**
     * What it costs, as read off the invoice: the price, and the amount and
     * unit it buys ("12.50 for 5 kg"). The amount stays as entered and is
     * turned into the base unit when a cost is worked out, so changing how
     * the ingredient is measured never leaves a stale conversion behind.
     * Null: nobody has said, which no cost ever counts as free.
     */
    price: numeric('price', { precision: 12, scale: 4, mode: 'number' }),
    purchaseQuantity: numeric('purchase_quantity', { precision: 14, scale: 4, mode: 'number' }),
    purchaseUnit: text('purchase_unit'),
    priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true }),
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
    flavourProfile: jsonb('flavour_profile').$type<string[]>().notNull().default([]),
    servingTemperature: servingTemperatureEnum('serving_temperature'),
    course: courseEnum('course'),
    drinkPairings: jsonb('drink_pairings').$type<string[]>().notNull().default([]),
    cutlery: jsonb('cutlery').$type<string[]>().notNull().default([]),
    /** What a guest pays for a dish, VAT included as on the menu. Null: not sold, or not said. */
    sellPrice: numeric('sell_price', { precision: 12, scale: 4, mode: 'number' }),
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

/**
 * What a dish's allergens were, each time they changed: the written record
 * front of house and an inspector can be shown, and the date the menu's
 * allergen overview is as of. A row is added only when the computed profile
 * differs from the dish's last one.
 */
export const dishAllergenChanges = pgTable(
  'dish_allergen_change',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
    contains: jsonb('contains').$type<string[]>().notNull().default([]),
    mayContain: jsonb('may_contain').$type<string[]>().notNull().default([]),
    /** The ingredient or recipe whose edit made the change; null for the dish itself or the first row. */
    cause: text('cause'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('dish_allergen_change_recipe_idx').on(t.recipeId, t.changedAt),
    index('dish_allergen_change_changed_by_idx').on(t.changedBy),
  ],
);

// --- mise en place --------------------------------------------------------

/**
 * The prep list: one running list for the whole kitchen. Lines go on by hand,
 * get ticked off, and drop out of sight two hours after they were ticked.
 */
export const prepTasks = pgTable(
  'prep_task',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationId: uuid('station_id').references(() => stations.id, { onDelete: 'set null' }),
    /** The spec this line is for, when it was added from a recipe. */
    recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantityBase: numeric('quantity_base', { precision: 14, scale: 4, mode: 'number' }),
    quantityUnit: text('quantity_unit'),
    status: prepTaskStatusEnum('status').notNull().default('open'),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Who put it on the list, and whether it came from the chef's checklist. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    fromChecklist: boolean('from_checklist').notNull().default(false),
    /**
     * For a line made up to a par: the par and what was there, in the same
     * base unit as the quantity, so the line can say why it asks for that much.
     */
    parBase: numeric('par_base', { precision: 14, scale: 4, mode: 'number' }),
    onHandBase: numeric('on_hand_base', { precision: 14, scale: 4, mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('prep_task_station_idx').on(t.stationId),
    index('prep_task_created_by_idx').on(t.createdBy),
    index('prep_task_recipe_idx').on(t.recipeId),
    index('prep_task_assignee_idx').on(t.assignedUserId),
    index('prep_task_completed_by_idx').on(t.completedBy),
    // The list asks for open lines and lines ticked in the last two hours.
    index('prep_task_status_idx').on(t.status, t.completedAt),
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

export const prepTaskRelations = relations(prepTasks, ({ one }) => ({
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
  /** Every backup is kept here; these say where else each one goes too. */
  sendToWebdav: boolean('send_to_webdav').notNull().default(false),
  sendToOnedrive: boolean('send_to_onedrive').notNull().default(false),
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

// --- menus ----------------------------------------------------------------

/** A group of dishes front of house sells together: a season's menu, the lunch card. */
export const menus = pgTable(
  'menu',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    status: menuStatusEnum('status').notNull().default('draft'),
    /** When this menu's dish cards were last downloaded, to say which have changed since. */
    cardsPrintedAt: timestamp('cards_printed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('menu_name_key').on(sql`lower(${t.name})`)],
);

export const menuDishes = pgTable(
  'menu_dish',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    // A dish deleted from the book leaves every menu it was on.
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    uniqueIndex('menu_dish_key').on(t.menuId, t.recipeId),
    index('menu_dish_recipe_idx').on(t.recipeId),
  ],
);

/** One prep line as stored. */
export type PrepTaskRow = typeof prepTasks.$inferSelect;

/**
 * How this server is reached. Exactly one row, created when first looked at.
 * Kept out of backups: it describes this machine and its address, not the
 * kitchen, and a restore onto a new server must not lock out whoever runs it.
 */
export const connectionSettings = pgTable('connection_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * The one address that leads to Mise from outside the kitchen, such as
   * mise.example.com. Null: any address does. Inside the kitchen, any always does.
   */
  outsideDomain: text('outside_domain'),
  /**
   * The web server in front of Mise, such as Apache passing a domain on.
   * Only requests from this address may say who the visitor really is.
   */
  trustedProxy: text('trusted_proxy'),
  /**
   * Whether visitors relayed by the container's own gateway (rootless Docker,
   * Podman, Docker Desktop) count as inside the kitchen. They can't be told
   * apart from the internet, so off unless an administrator says otherwise.
   */
  trustContainerGateway: boolean('trust_container_gateway').notNull().default(false),

  /**
   * The kitchen certificate: Mise's own small certificate authority, which each
   * tablet trusts once, and the certificate it signs for the addresses the
   * tablets use. The authority outlives every certificate it signs, so turning
   * HTTPS off and on again, or renewing, never asks a tablet to trust anew.
   */
  kitchenHttps: boolean('kitchen_https').notNull().default(false),
  kitchenCaCert: text('kitchen_ca_cert'),
  kitchenCaKey: text('kitchen_ca_key'),
  kitchenCert: text('kitchen_cert'),
  kitchenKey: text('kitchen_key'),
  kitchenNames: jsonb('kitchen_names').$type<string[]>(),
  kitchenExpiresAt: timestamp('kitchen_expires_at', { withTimezone: true }),

  /** A free Let's Encrypt certificate for the outside address, renewed by Mise. */
  domainHttps: boolean('domain_https').notNull().default(false),
  domainCert: text('domain_cert'),
  domainKey: text('domain_key'),
  /** The name the certificate above was issued for. */
  domainCertFor: text('domain_cert_for'),
  domainExpiresAt: timestamp('domain_expires_at', { withTimezone: true }),
  /** Why the last attempt to get or renew it failed, in Let's Encrypt's words. */
  domainError: text('domain_error'),
  acmeAccountKey: text('acme_account_key'),

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Answers to changes a device saved while offline and sent later. Each such
 * change carries its own id; if the answer never made it back (the wifi
 * dropped again mid-send), the device sends it once more and gets this same
 * answer, instead of the change being made twice. Kept a week, and out of
 * backups.
 */
export const writeReceipts = pgTable(
  'write_receipt',
  {
    /** The person and the change's own id: one person's ids never answer another's. */
    key: text('key').primaryKey(),
    status: integer('status').notNull(),
    contentType: text('content_type'),
    body: text('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('write_receipt_created_idx').on(t.createdAt)],
);
