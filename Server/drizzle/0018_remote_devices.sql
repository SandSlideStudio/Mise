CREATE TABLE "remote_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_from" text,
	"last_seen_at" timestamp with time zone,
	"user_agent" text,
	"address" text,
	CONSTRAINT "remote_device_status_known" CHECK ("remote_device"."status" in ('pending', 'approved'))
);
--> statement-breakpoint
ALTER TABLE "remote_device" ADD CONSTRAINT "remote_device_approved_by_app_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "remote_device_token_key" ON "remote_device" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "remote_device_status_idx" ON "remote_device" USING btree ("status");