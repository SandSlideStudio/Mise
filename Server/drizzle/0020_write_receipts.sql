CREATE TABLE "write_receipt" (
	"key" text PRIMARY KEY NOT NULL,
	"status" integer NOT NULL,
	"content_type" text,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "write_receipt_created_idx" ON "write_receipt" USING btree ("created_at");