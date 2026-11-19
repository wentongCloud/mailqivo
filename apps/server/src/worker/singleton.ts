import type pg from "pg";
import type { Db } from "../db/client.ts";

/** advisory lock 键（任意固定的 bigint）。 */
export const SINGLETON_LOCKS = {
  scheduler: 7_310_001,
  inboundPoll: 7_310_002
} as const;

/**
 * 多 worker 进程部署时，scheduler / IMAP 轮询只应有一个进程执行。
 * 用会话级 pg_try_advisory_lock 绑定在一条专用连接上；拿不到锁直接跳过本轮（返回 skipped）。
 * 进程崩溃时连接断开，锁自动释放。
 */
export async function runExclusive<T>(db: Db, key: number, fn: () => Promise<T>): Promise<{ skipped: true } | { skipped: false; value: T }> {
  // drizzle(pool) 在运行时把连接池挂在 $client 上（Db 类型未声明）。
  const pool = (db as Db & { $client?: pg.Pool }).$client;
  if (typeof pool?.connect !== "function") return { skipped: false, value: await fn() };
  const client = await pool.connect();
  let locked = false;
  let releaseError: Error | undefined;
  try {
    const result = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [key]);
    locked = result.rows[0]?.ok === true;
    if (!locked) return { skipped: true };
    return { skipped: false, value: await fn() };
  } finally {
    if (locked) {
      // 解锁失败时销毁连接（而不是放回池中），会话结束即释放锁，避免带锁连接被复用。
      await client.query("SELECT pg_advisory_unlock($1)", [key]).catch((error: Error) => { releaseError = error; });
    }
    client.release(releaseError);
  }
}
