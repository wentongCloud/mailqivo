import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;

export type DbHandle = {
  db: Db;
  pool: pg.Pool;
  close: () => Promise<void>;
};

/** 创建连接池与 drizzle 实例。连接是惰性的：第一次查询时才真正连接。 */
export function createDb(databaseUrl: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: options.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
