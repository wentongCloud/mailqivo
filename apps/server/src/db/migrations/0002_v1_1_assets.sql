CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_storage_key_key" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "content_rules" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "content_rule_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "attachment_snapshot" jsonb;