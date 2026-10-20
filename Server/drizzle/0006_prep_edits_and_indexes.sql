ALTER TABLE "prep_task" ADD COLUMN "edited_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "prep_task_source_recipe_idx" ON "prep_task" USING btree ("source_recipe_id");--> statement-breakpoint
CREATE INDEX "prep_task_source_ingredient_idx" ON "prep_task" USING btree ("source_ingredient_id");--> statement-breakpoint
CREATE INDEX "prep_task_completed_by_idx" ON "prep_task" USING btree ("completed_by");--> statement-breakpoint
CREATE INDEX "prep_task_list_idx" ON "prep_task" USING btree ("service_id","status","completed_at");--> statement-breakpoint
CREATE INDEX "recipe_component_ingredient_idx" ON "recipe_component" USING btree ("ingredient_id");--> statement-breakpoint
CREATE INDEX "service_dish_recipe_idx" ON "service_dish" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "session_device_idx" ON "session" USING btree ("device_id");