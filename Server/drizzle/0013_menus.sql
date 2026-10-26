CREATE TYPE "public"."menu_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "menu_dish" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_id" uuid NOT NULL,
	"recipe_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "menu_status" DEFAULT 'draft' NOT NULL,
	"cards_printed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_dish" ADD CONSTRAINT "menu_dish_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_dish" ADD CONSTRAINT "menu_dish_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "menu_dish_key" ON "menu_dish" USING btree ("menu_id","recipe_id");--> statement-breakpoint
CREATE INDEX "menu_dish_recipe_idx" ON "menu_dish" USING btree ("recipe_id");--> statement-breakpoint
CREATE UNIQUE INDEX "menu_name_key" ON "menu" USING btree (lower("name"));