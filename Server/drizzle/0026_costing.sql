-- Costing. Every price starts unknown, which no cost counts as free; the
-- kitchen starts in euros with the Dutch 9 % VAT on food.
ALTER TABLE "ingredient" ADD COLUMN "price" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "purchase_quantity" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "purchase_unit" text;--> statement-breakpoint
ALTER TABLE "ingredient" ADD COLUMN "price_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "kitchen" ADD COLUMN "food_vat_percent" real DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "sell_price" numeric(12, 4);