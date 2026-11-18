ALTER TABLE "kitchen" ADD COLUMN "ticked_keep_days" integer DEFAULT 365;--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD CONSTRAINT "prep_checklist_item_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_checklist_item_recipe_idx" ON "prep_checklist_item" USING btree ("recipe_id");