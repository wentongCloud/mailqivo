import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit 以 apps/server 为工作目录运行；环境变量统一放在仓库根目录的 .env
config({ path: "../../.env", quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {})
});
