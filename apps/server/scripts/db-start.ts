/**
 * pnpm db:start —— 在前台启动 embedded-postgres（PostgreSQL 16），数据目录为仓库根目录的 .pgdata/。
 * 端口、用户名、密码、库名取自 DATABASE_URL；库不存在时自动创建。Ctrl+C 停止。
 * 有 Docker 的环境可改用 `docker compose up -d`。
 */
import { REPO_ROOT } from "../src/env.ts";
import path from "node:path";
import { ensureDatabase, parseDatabaseUrl, startEmbeddedPg } from "./lib/embedded-pg.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL（请先复制 .env.example 为 .env）");
  process.exit(1);
}
const conn = parseDatabaseUrl(url);
if (!["localhost", "127.0.0.1", "::1"].includes(conn.host)) {
  console.error(`DATABASE_URL 指向 ${conn.host}，embedded-postgres 只能在本机启动`);
  process.exit(1);
}

const dataDir = path.join(REPO_ROOT, ".pgdata");
const server = await startEmbeddedPg({
  dataDir,
  port: conn.port,
  user: conn.user,
  password: conn.password,
  persistent: true
});
await ensureDatabase(
  { user: conn.user, password: conn.password, host: "localhost", port: conn.port },
  conn.database
);
console.log(`PostgreSQL 16 已启动：localhost:${conn.port}，数据库 ${conn.database}，数据目录 ${dataDir}`);
console.log("按 Ctrl+C 停止。");

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\n正在停止 PostgreSQL…");
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// 保持进程存活
setInterval(() => {}, 1 << 30);
