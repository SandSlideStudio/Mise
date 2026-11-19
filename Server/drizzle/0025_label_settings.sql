-- Labels for containers of prep. An existing kitchen gets the small Brother
-- roll, and ticking a line prints nothing by itself until someone chooses it.
CREATE TYPE "public"."label_size" AS ENUM('62x29', '62x100', '54x25', '57x32', '89x36', '102x51');--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "label_size" "label_size" DEFAULT '62x29' NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "label_on_tick" boolean DEFAULT false NOT NULL;