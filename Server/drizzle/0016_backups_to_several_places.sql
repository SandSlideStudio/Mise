ALTER TABLE "backup_settings" ADD COLUMN "send_to_webdav" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "backup_settings" ADD COLUMN "send_to_onedrive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "backup_settings" SET "send_to_webdav" = ("destination" = 'webdav'), "send_to_onedrive" = ("destination" = 'onedrive');
