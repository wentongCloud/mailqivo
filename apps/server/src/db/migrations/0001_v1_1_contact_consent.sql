ALTER TABLE "contacts" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "consent_source" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_consent_source_check" CHECK (consent_source IS NULL OR consent_source IN ('import','manual','reply','web_form','other'));