CREATE TYPE "public"."base_unit" AS ENUM('g', 'ml', 'each');--> statement-breakpoint
CREATE TYPE "public"."prep_task_kind" AS ENUM('recipe', 'ingredient', 'other');--> statement-breakpoint
CREATE TYPE "public"."prep_task_source" AS ENUM('generated', 'manual');--> statement-breakpoint
CREATE TYPE "public"."prep_task_status" AS ENUM('open', 'in_progress', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recipe_type" AS ENUM('dish', 'prep', 'component');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('admin', 'head_chef', 'sous_chef', 'cook');--> statement-breakpoint
CREATE TYPE "public"."service_period" AS ENUM('breakfast', 'lunch', 'dinner', 'prep_day', 'event');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('planning', 'active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."unit_system" AS ENUM('metric', 'imperial');--> statement-breakpoint
CREATE TABLE "device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"base_unit" "base_unit" DEFAULT 'g' NOT NULL,
	"allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"density_g_per_ml" real,
	"item_weight_g" real,
	"yield_percent" real DEFAULT 100 NOT NULL,
	"requires_prep" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingredient_yield_range" CHECK ("ingredient"."yield_percent" > 0 and "ingredient"."yield_percent" <= 100)
);
--> statement-breakpoint
CREATE TABLE "kitchen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"unit_system" "unit_system" DEFAULT 'metric' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prep_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"station_id" uuid,
	"kind" "prep_task_kind" DEFAULT 'other' NOT NULL,
	"source_recipe_id" uuid,
	"source_ingredient_id" uuid,
	"generation_key" text,
	"description" text NOT NULL,
	"quantity_base" numeric(14, 4),
	"quantity_unit" text,
	"source" "prep_task_source" DEFAULT 'manual' NOT NULL,
	"status" "prep_task_status" DEFAULT 'open' NOT NULL,
	"assigned_user_id" uuid,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"used_by" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"section" text,
	"note" text,
	"quantity_base" numeric(14, 4) NOT NULL,
	"quantity_entered" numeric(14, 4) NOT NULL,
	"unit_entered" text NOT NULL,
	"ingredient_id" uuid,
	"child_recipe_id" uuid,
	CONSTRAINT "recipe_component_one_target" CHECK (("recipe_component"."ingredient_id" is not null)::int + ("recipe_component"."child_recipe_id" is not null)::int = 1),
	CONSTRAINT "recipe_component_not_self" CHECK ("recipe_component"."child_recipe_id" is null or "recipe_component"."child_recipe_id" <> "recipe_component"."recipe_id")
);
--> statement-breakpoint
CREATE TABLE "recipe_photo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"path" text NOT NULL,
	"caption" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "recipe_type" DEFAULT 'prep' NOT NULL,
	"status" "recipe_status" DEFAULT 'draft' NOT NULL,
	"station_id" uuid,
	"yield_base" numeric(14, 4) NOT NULL,
	"yield_entered" numeric(14, 4) NOT NULL,
	"yield_unit" text NOT NULL,
	"portions" real,
	"prep_minutes" integer,
	"cook_minutes" integer,
	"shelf_life_hours" integer,
	"storage" text,
	"method" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"declared_allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_yield_positive" CHECK ("recipe"."yield_base" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_dish" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"planned_portions" real NOT NULL,
	CONSTRAINT "service_dish_portions_positive" CHECK ("service_dish"."planned_portions" > 0)
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"period" "service_period" NOT NULL,
	"covers" integer,
	"notes" text,
	"status" "service_status" DEFAULT 'planning' NOT NULL,
	"generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_agent" text,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "station" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"password_hash" text,
	"pin_hash" text,
	"role" "role" DEFAULT 'cook' NOT NULL,
	"default_station_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_has_a_credential" CHECK ("app_user"."password_hash" is not null or "app_user"."pin_hash" is not null),
	CONSTRAINT "app_user_password_needs_email" CHECK ("app_user"."password_hash" is null or "app_user"."email" is not null)
);
--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_source_recipe_id_recipe_id_fk" FOREIGN KEY ("source_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_source_ingredient_id_ingredient_id_fk" FOREIGN KEY ("source_ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_assigned_user_id_app_user_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_completed_by_app_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_component" ADD CONSTRAINT "recipe_component_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_component" ADD CONSTRAINT "recipe_component_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_component" ADD CONSTRAINT "recipe_component_child_recipe_id_recipe_id_fk" FOREIGN KEY ("child_recipe_id") REFERENCES "public"."recipe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_photo" ADD CONSTRAINT "recipe_photo_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dish" ADD CONSTRAINT "service_dish_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_dish" ADD CONSTRAINT "service_dish_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_default_station_id_station_id_fk" FOREIGN KEY ("default_station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingredient_name_key" ON "ingredient" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "prep_task_service_idx" ON "prep_task" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "prep_task_station_idx" ON "prep_task" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "prep_task_assignee_idx" ON "prep_task" USING btree ("assigned_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prep_task_generation_key" ON "prep_task" USING btree ("service_id","generation_key");--> statement-breakpoint
CREATE INDEX "recipe_component_recipe_idx" ON "recipe_component" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_component_child_idx" ON "recipe_component" USING btree ("child_recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_photo_recipe_idx" ON "recipe_photo" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_name_key" ON "recipe" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "recipe_station_idx" ON "recipe" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "recipe_status_idx" ON "recipe" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "service_dish_key" ON "service_dish" USING btree ("service_id","recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_date_period_key" ON "service" USING btree ("date","period");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree ("email");