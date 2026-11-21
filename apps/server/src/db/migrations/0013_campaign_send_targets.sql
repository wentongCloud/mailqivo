-- 发送确认锁定的收件人集合（规格 §6.1、§6.2 第 7 条）。
CREATE TABLE "campaign_send_targets" (
	"campaign_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"confirmed_status" text NOT NULL,
	CONSTRAINT "campaign_send_targets_pkey" PRIMARY KEY("campaign_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_send_targets" ADD CONSTRAINT "campaign_send_targets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_send_targets" ADD CONSTRAINT "campaign_send_targets_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 旧版确认未锁定名单：已排程或待准备的活动无法还原确认时的名单，退回草稿，由用户重新取摘要并确认。保留 send_at 作为草稿计划。
UPDATE "campaigns" SET "status" = 'draft', "updated_at" = now() WHERE "status" IN ('scheduled', 'preparing');
