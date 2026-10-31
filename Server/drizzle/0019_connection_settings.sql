CREATE TABLE "connection_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outside_domain" text,
	"trusted_proxy" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
