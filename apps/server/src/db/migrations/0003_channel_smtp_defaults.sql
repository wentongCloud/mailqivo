-- 通道仅保留 smtp；企业邮箱默认 30/分钟、日上限 300（0=商用通道无日限，由应用层解释）。
ALTER TABLE "channels" DROP CONSTRAINT IF EXISTS "channels_type_check";--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_type_check" CHECK (type IN ('smtp'));--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "rate_per_minute" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "channels" ALTER COLUMN "daily_limit" SET DEFAULT 300;--> statement-breakpoint
UPDATE "channels" SET type = 'smtp' WHERE type <> 'smtp';
