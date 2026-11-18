-- Kitchens from before 2.4 kept ticked lines for good: they stay that way
-- (null) until a chef chooses. Only new kitchens start at a year.
ALTER TABLE "kitchen" ADD COLUMN "ticked_keep_days" integer;--> statement-breakpoint
ALTER TABLE "kitchen" ALTER COLUMN "ticked_keep_days" SET DEFAULT 365;--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD CONSTRAINT "prep_checklist_item_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_checklist_item_recipe_idx" ON "prep_checklist_item" USING btree ("recipe_id");