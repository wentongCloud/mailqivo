ALTER TABLE "messages" ADD COLUMN "send_lease_id" uuid;--> statement-breakpoint
CREATE INDEX "messages_sending_locked_idx" ON "messages" USING btree ("locked_at") WHERE status = 'sending';
