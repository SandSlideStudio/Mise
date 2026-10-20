CREATE TABLE "backup_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recovery_key" text NOT NULL,
	"key_confirmed_at" timestamp with time zone,
	"destination" text DEFAULT 'local' NOT NULL,
	"webdav_url" text,
	"webdav_username" text,
	"webdav_password" text,
	"hour" integer DEFAULT 4 NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"keep_local" integer DEFAULT 7 NOT NULL,
	"keep_remote" integer DEFAULT 30 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_fingerprint" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
