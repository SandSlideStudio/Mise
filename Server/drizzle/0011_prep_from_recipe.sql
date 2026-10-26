ALTER TABLE "prep_task" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_task_recipe_idx" ON "prep_task" USING btree ("recipe_id");