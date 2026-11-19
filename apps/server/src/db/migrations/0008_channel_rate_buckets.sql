CREATE TABLE "channel_rate_buckets" (
	"channel_id" uuid PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "type" SET DEFAULT 'smtp';--> statement-breakpoint
ALTER TABLE "channel_rate_buckets" ADD CONSTRAINT "channel_rate_buckets_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;