-- One prep list from now on. Work still in front of the brigade, open or being made on
-- today's service or a later one, joins it; everything else from services goes.
DELETE FROM "prep_task" AS "task" USING "service"
WHERE "task"."service_id" = "service"."id"
  AND ("task"."status" NOT IN ('open', 'in_progress') OR "service"."date" < current_date);--> statement-breakpoint
DROP TABLE "service_dish" CASCADE;--> statement-breakpoint
DROP TABLE "service" CASCADE;--> statement-breakpoint
ALTER TABLE "prep_task" DROP CONSTRAINT IF EXISTS "prep_task_service_id_service_id_fk";
--> statement-breakpoint
ALTER TABLE "prep_task" DROP CONSTRAINT IF EXISTS "prep_task_source_recipe_id_recipe_id_fk";
--> statement-breakpoint
ALTER TABLE "prep_task" DROP CONSTRAINT IF EXISTS "prep_task_source_ingredient_id_ingredient_id_fk";
--> statement-breakpoint
DROP INDEX "prep_task_service_idx";--> statement-breakpoint
DROP INDEX "prep_task_source_recipe_idx";--> statement-breakpoint
DROP INDEX "prep_task_source_ingredient_idx";--> statement-breakpoint
DROP INDEX "prep_task_list_idx";--> statement-breakpoint
DROP INDEX "prep_task_generation_key";--> statement-breakpoint
CREATE INDEX "prep_task_status_idx" ON "prep_task" USING btree ("status","completed_at");--> statement-breakpoint
ALTER TABLE "ingredient" DROP COLUMN "requires_prep";--> statement-breakpoint
ALTER TABLE "kitchen" DROP COLUMN "prep_mode";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "service_id";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "source_recipe_id";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "source_ingredient_id";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "generation_key";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "notes";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "used_by";--> statement-breakpoint
ALTER TABLE "prep_task" DROP COLUMN "edited_at";--> statement-breakpoint
DROP TYPE "public"."prep_mode";--> statement-breakpoint
DROP TYPE "public"."prep_task_kind";--> statement-breakpoint
DROP TYPE "public"."prep_task_source";--> statement-breakpoint
DROP TYPE "public"."service_period";--> statement-breakpoint
DROP TYPE "public"."service_status";