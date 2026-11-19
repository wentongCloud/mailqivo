/** pnpm db:migrate —— 对 DATABASE_URL 执行全部未执行的迁移。 */
import "../src/env.ts";
import { runMigrations } from "../src/db/migrate.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL（请先复制 .env.example 为 .env）");
  process.exit(1);
}
await runMigrations(url);
console.log("迁移完成");
