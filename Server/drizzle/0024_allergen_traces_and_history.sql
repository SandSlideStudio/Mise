-- Each dish's first row is not written here: working out a dish's allergens
-- takes the recipe tree, so the server writes it when it starts.
CREATE TABLE "dish_allergen_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipe_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cause" text,
	"changed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dish_allergen_change" ADD CONSTRAINT "dish_allergen_change_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_allergen_change" ADD CONSTRAINT "dish_allergen_change_changed_by_app_user_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dish_allergen_change_recipe_idx" ON "dish_allergen_change" USING btree ("recipe_id","changed_at");--> statement-breakpoint
CREATE INDEX "dish_allergen_change_changed_by_idx" ON "dish_allergen_change" USING btree ("changed_by");