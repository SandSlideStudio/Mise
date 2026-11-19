-- Label checks at delivery. Each time someone reads an ingredient's label
-- against what Mise has, the allergens before and after, and whether it was
-- applied or waits for a chef. Empty to start: no label has been checked yet.
CREATE TYPE "public"."label_check_status" AS ENUM('applied', 'pending', 'rejected');--> statement-breakpoint
CREATE TABLE "ingredient_label_check" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ingredient_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" uuid,
	"changed" boolean DEFAULT false NOT NULL,
	"before_allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"before_may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"after_allergens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"after_may_contain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"status" "label_check_status" DEFAULT 'applied' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingredient_label_check" ADD CONSTRAINT "ingredient_label_check_ingredient_id_ingredient_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingredient_label_check" ADD CONSTRAINT "ingredient_label_check_checked_by_app_user_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingredient_label_check_ingredient_idx" ON "ingredient_label_check" USING btree ("ingredient_id","checked_at");--> statement-breakpoint
CREATE INDEX "ingredient_label_check_checked_by_idx" ON "ingredient_label_check" USING btree ("checked_by");--> statement-breakpoint
CREATE INDEX "ingredient_label_check_status_idx" ON "ingredient_label_check" USING btree ("status");