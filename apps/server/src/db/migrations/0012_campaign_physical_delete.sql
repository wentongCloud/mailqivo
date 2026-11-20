-- 活动只有物理删除：此前误做成软删的活动按用户原意永久删除（邮件、追踪事件、链接快照、AI 缓存随外键级联删除）。
DELETE FROM "campaigns" WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" DROP COLUMN "deleted_at";
