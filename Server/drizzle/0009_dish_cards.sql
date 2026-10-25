CREATE TYPE "public"."course" AS ENUM('amuse', 'starter', 'middle', 'main', 'pre_dessert', 'dessert', 'mignardise', 'side');--> statement-breakpoint
CREATE TYPE "public"."dish_card_access" AS ENUM('everyone', 'managers');--> statement-breakpoint
CREATE TYPE "public"."dish_card_theme" AS ENUM('day', 'night');--> statement-breakpoint
CREATE TYPE "public"."serving_temperature" AS ENUM('cold', 'room', 'warm', 'hot', 'hot_and_cold');--> statement-breakpoint
CREATE TABLE "dish_card_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text,
	"location_name" text,
	"address" text,
	"logo_path" text,
	"warnings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"theme" "dish_card_theme" DEFAULT 'day' NOT NULL,
	"access" "dish_card_access" DEFAULT 'everyone' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "vegan" boolean;--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "allergen_details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "seasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "flavour_profile" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "serving_temperature" "serving_temperature";--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "course" "course";--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "drink_pairings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "cutlery" jsonb DEFAULT '[]'::jsonb NOT NULL;