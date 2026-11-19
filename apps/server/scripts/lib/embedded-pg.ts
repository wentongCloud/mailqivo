/**
 * 无 Docker 时的本地 PostgreSQL 16（§1）：npm 包 embedded-postgres。
 * 供 `pnpm db:start` 与 vitest globalSetup 共用。
 */
import fs from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

export type EmbeddedPgOptions = {
  dataDir: string;
  port: number;
  user: string;
  password: string;
  /** false 时 stop() 后删除数据目录 */
  persistent: boolean;
};

export type ParsedDbUrl = {
  user: string;
  password: string;
  host: string;
  port: number;
  database: string;
};

export function parseDatabaseUrl(url: string): ParsedDbUrl {
  const u = new URL(url);
  return {
    user: decodeURIComponent(u.username || "postgres"),
    password: decodeURIComponent(u.password || "postgres"),
    host: u.hostname || "localhost",
    port: Number(u.port || 5432),
    database: decodeURIComponent(u.pathname.replace(/^\//, "") || "postgres")
  };
}

function isInitialised(dataDir: string) {
  return fs.existsSync(`${dataDir}/PG_VERSION`);
}

export async function startEmbeddedPg(opts: EmbeddedPgOptions): Promise<EmbeddedPostgres> {
  const server = new EmbeddedPostgres({
    databaseDir: opts.dataDir,
    port: opts.port,
    user: opts.user,
    password: opts.password,
    persistent: opts.persistent,
    onLog: () => {},
    onError: (err) => console.error("[embedded-postgres]", err)
  });
  if (!isInitialised(opts.dataDir)) {
    fs.rmSync(opts.dataDir, { recursive: true, force: true });
    await server.initialise();
  } else {
    // 上次异常退出残留的 postmaster.pid 会导致启动失败
    const pidFile = `${opts.dataDir}/postmaster.pid`;
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").split("\n")[0]);
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        throw new Error(`数据目录 ${opts.dataDir} 已被进程 ${pid} 使用（数据库可能已经在运行）`);
      }
      fs.rmSync(pidFile);
    }
  }
  await server.start();
  return server;
}

/** 数据库不存在时创建；`recreate` 为 true 时先删除再创建。 */
export async function ensureDatabase(
  conn: Omit<ParsedDbUrl, "database">,
  database: string,
  recreate = false
): Promise<void> {
  const client = new pg.Client({ ...conn, database: "postgres" });
  await client.connect();
  try {
    const ident = `"${database.replaceAll('"', '""')}"`;
    if (recreate) {
      await client.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
    }
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      database
    ]);
    if (!rowCount) {
      await client.query(`CREATE DATABASE ${ident}`);
    }
  } finally {
    await client.end();
  }
}
