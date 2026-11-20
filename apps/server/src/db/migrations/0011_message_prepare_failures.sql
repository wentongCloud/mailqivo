-- IF NOT EXISTS：开发期曾以未入库的迁移先加过此列（与 0010 同类情况），已有该列的库跳过。
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "prepare_failures" integer DEFAULT 0 NOT NULL;
