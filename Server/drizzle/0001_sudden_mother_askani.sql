CREATE TYPE "public"."language" AS ENUM('en', 'nl', 'fr', 'es', 'de');--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "language" "language" DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "language" "language";