CREATE TABLE "prep_checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "prep_checklist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "prep_checklist_updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "pin_only_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "idle_sign_out_minutes" integer;--> statement-breakpoint
ALTER TABLE "prep_task" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "prep_task" ADD COLUMN "from_checklist" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "pin_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD CONSTRAINT "prep_checklist_item_station_id_station_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."station"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_checklist_item_station_idx" ON "prep_checklist_item" USING btree ("station_id");--> statement-breakpoint
ALTER TABLE "prep_task" ADD CONSTRAINT "prep_task_created_by_app_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prep_task_created_by_idx" ON "prep_task" USING btree ("created_by");--> statement-breakpoint
-- Emails are unique whatever their capitals. A kitchen that already has two
-- that differ only in capitals keeps going on the app's own check instead of
-- failing to update.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "app_user" WHERE "email" IS NOT NULL
    GROUP BY lower("email") HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "app_user_email_lower_key" ON "app_user" USING btree (lower("email"));
  END IF;
END $$;