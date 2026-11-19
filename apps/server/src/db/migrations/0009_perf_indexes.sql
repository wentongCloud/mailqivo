CREATE INDEX "ai_cache_contact_idx" ON "ai_cache" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "inbound_mails_message_idx" ON "inbound_mails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_email_sent_idx" ON "messages" USING btree ("email","sent_at") WHERE status = 'sent';--> statement-breakpoint
CREATE INDEX "messages_contact_idx" ON "messages" USING btree ("contact_id");