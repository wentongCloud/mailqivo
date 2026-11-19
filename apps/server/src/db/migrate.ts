import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./client.ts";

export const MIGRATIONS_DIR = path.resolve(import.meta.dirname, "migrations");

/** 执行 src/db/migrations 下尚未执行的迁移（drizzle 迁移表位于 schema `drizzle`）。 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const handle = createDb(databaseUrl, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await handle.close();
  }
}
