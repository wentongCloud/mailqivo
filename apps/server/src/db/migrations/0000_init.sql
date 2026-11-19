CREATE TABLE "ai_cache" (
	"campaign_id" uuid,
	"contact_id" uuid,
	"block_key" text NOT NULL,
	"instruction_hash" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_cache_pkey" PRIMARY KEY("campaign_id","contact_id","block_key")
);
--> statement-breakpoint
CREATE TABLE "campaign_links" (
	"campaign_id" uuid,
	"idx" integer NOT NULL,
	"url" text NOT NULL,
	CONSTRAINT "campaign_links_pkey" PRIMARY KEY("campaign_id","idx")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"editor_mode" text DEFAULT 'rich' NOT NULL,
	"template_id" uuid,
	"signature_id" uuid,
	"channel_id" uuid,
	"contact_filter" jsonb NOT NULL,
	"ai_goal" text,
	"ai_fields" text[] DEFAULT '{}' NOT NULL,
	"ai_blocks" jsonb DEFAULT '[]' NOT NULL,
	"track_opens" boolean DEFAULT true NOT NULL,
	"track_clicks" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pause_reason" text,
	"fail_reason" text,
	"send_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_editor_mode_check" CHECK (editor_mode IN ('rich','html')),
	CONSTRAINT "campaigns_status_check" CHECK (status IN ('draft','scheduled','preparing','sending','paused','completed','cancelled','failed')),
	CONSTRAINT "campaigns_pause_reason_check" CHECK (pause_reason IN ('MANUAL','DAILY_LIMIT','CHANNEL_ERROR'))
);
--> statement-breakpoint
CREATE TABLE "channel_daily_usage" (
	"channel_id" uuid,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "channel_daily_usage_pkey" PRIMARY KEY("channel_id","day")
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config_enc" "bytea" NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text NOT NULL,
	"reply_to" text NOT NULL,
	"rate_per_minute" integer DEFAULT 50 NOT NULL,
	"daily_limit" integer DEFAULT 500 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channels_type_check" CHECK (type IN ('smtp','ses','sendgrid'))
);
--> statement-breakpoint
CREATE TABLE "confirm_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"target" jsonb NOT NULL,
	"summary_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "contact_tags" (
	"contact_id" uuid,
	"tag_id" uuid,
	CONSTRAINT "contact_tags_pkey" PRIMARY KEY("contact_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"title" text,
	"custom_fields" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invalid_reason" text,
	"domain_suspect" boolean DEFAULT false NOT NULL,
	"soft_bounce_streak" integer DEFAULT 0 NOT NULL,
	"bounce_count" integer DEFAULT 0 NOT NULL,
	"last_bounce_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"source" text NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_key" UNIQUE("email"),
	CONSTRAINT "contacts_status_check" CHECK (status IN ('active','invalid','bounced','unsubscribed')),
	CONSTRAINT "contacts_source_check" CHECK (source IN ('import','manual','reply'))
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"field_mapping" jsonb NOT NULL,
	"dedup_strategy" text,
	"tag_ids" uuid[] DEFAULT '{}' NOT NULL,
	"report" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	CONSTRAINT "import_batches_status_check" CHECK (status IN ('previewed','committed','discarded')),
	CONSTRAINT "import_batches_dedup_strategy_check" CHECK (dedup_strategy IN ('skip','overwrite','merge_tags'))
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"batch_id" uuid NOT NULL,
	"row_no" integer NOT NULL,
	"data" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"issues" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "import_rows_pkey" PRIMARY KEY("batch_id","row_no")
);
--> statement-breakpoint
CREATE TABLE "inbound_mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"imap_uid" bigint NOT NULL,
	"uid_validity" bigint NOT NULL,
	"rfc_message_id" text,
	"from_email" text,
	"subject" text,
	"received_at" timestamp with time zone NOT NULL,
	"category" text,
	"message_id" uuid,
	"match_method" text,
	"body_text" text,
	"bounce_type" text,
	"reason_code" text,
	"dsn_status" text,
	"diagnostic" text,
	"intent" text,
	"summary" text,
	"suggested_reply" text,
	"handled" boolean DEFAULT false NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_mails_channel_id_uid_validity_imap_uid_key" UNIQUE("channel_id","uid_validity","imap_uid"),
	CONSTRAINT "inbound_mails_category_check" CHECK (category IN ('bounce','auto_reply','human','unrelated')),
	CONSTRAINT "inbound_mails_match_method_check" CHECK (match_method IN ('header','references','sender_recent','none')),
	CONSTRAINT "inbound_mails_bounce_type_check" CHECK (bounce_type IN ('hard','soft','policy')),
	CONSTRAINT "inbound_mails_intent_check" CHECK (intent IN ('interested','inquiry','reject','complaint','unsubscribe_request','other'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracking_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid,
	"email" text NOT NULL,
	"is_test" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"skip_reason" text,
	"ai_content" jsonb DEFAULT '{}' NOT NULL,
	"rendered_vars" jsonb,
	"rendered_subject" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"smtp_code" integer,
	"smtp_response" text,
	"failure_reason" text,
	"sent_at" timestamp with time zone,
	"bounce_type" text,
	"bounce_reason" text,
	"bounced_at" timestamp with time zone,
	"first_opened_at" timestamp with time zone,
	"open_count" integer DEFAULT 0 NOT NULL,
	"open_suspect" boolean DEFAULT false NOT NULL,
	"first_clicked_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"auto_replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_tracking_id_key" UNIQUE("tracking_id"),
	CONSTRAINT "messages_campaign_id_contact_id_key" UNIQUE("campaign_id","contact_id"),
	CONSTRAINT "messages_status_check" CHECK (status IN ('pending_ai','queued','sending','sent','failed','skipped','unknown')),
	CONSTRAINT "messages_bounce_type_check" CHECK (bounce_type IN ('hard','soft','policy'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"html" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tags_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"subject" text NOT NULL,
	"html" text NOT NULL,
	"editor_mode" text DEFAULT 'rich' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_category_check" CHECK (category IN ('launch','invitation','holiday','other')),
	CONSTRAINT "templates_editor_mode_check" CHECK (editor_mode IN ('rich','html'))
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" uuid NOT NULL,
	"type" text NOT NULL,
	"link_idx" integer,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"ua" text,
	"suspected_machine" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tracking_events_type_check" CHECK (type IN ('open','click'))
);
--> statement-breakpoint
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_cache" ADD CONSTRAINT "ai_cache_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_links" ADD CONSTRAINT "campaign_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_signature_id_fkey" FOREIGN KEY ("signature_id") REFERENCES "public"."signatures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_daily_usage" ADD CONSTRAINT "channel_daily_usage_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_mails" ADD CONSTRAINT "inbound_mails_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_one_default" ON "channels" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE INDEX "contacts_status_idx" ON "contacts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contacts_domain_idx" ON "contacts" USING btree ((split_part(email,'@',2)));--> statement-breakpoint
CREATE INDEX "inbound_category_idx" ON "inbound_mails" USING btree ("category","handled");--> statement-breakpoint
CREATE INDEX "messages_claim_idx" ON "messages" USING btree ("status","next_attempt_at") WHERE status IN ('queued','pending_ai');--> statement-breakpoint
CREATE INDEX "messages_campaign_idx" ON "messages" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "signatures_one_default" ON "signatures" USING btree ("is_default") WHERE is_default;--> statement-breakpoint
CREATE INDEX "tracking_events_msg_idx" ON "tracking_events" USING btree ("message_id","type");