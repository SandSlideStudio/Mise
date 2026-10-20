CREATE TYPE "public"."prep_mode" AS ENUM('per_service', 'running');--> statement-breakpoint
CREATE TYPE "public"."ticked_retention" AS ENUM('keep', 'delete');--> statement-breakpoint
ALTER TABLE "prep_task" ALTER COLUMN "service_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "prep_mode" "prep_mode" DEFAULT 'per_service' NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "ticked_retention" "ticked_retention" DEFAULT 'keep' NOT NULL;