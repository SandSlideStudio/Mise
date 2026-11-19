-- Par levels. A checklist item may say how much the chef wants ready; a prep
-- line made up to one keeps the par and what was there, to say why it asks
-- for its amount. All empty to start: nothing has a par until a chef sets one.
ALTER TABLE "prep_checklist_item" ADD COLUMN "par_value" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "prep_checklist_item" ADD COLUMN "par_unit" text;--> statement-breakpoint
ALTER TABLE "prep_task" ADD COLUMN "par_base" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "prep_task" ADD COLUMN "on_hand_base" numeric(14, 4);
