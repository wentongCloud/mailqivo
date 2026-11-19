import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import type { RateLimiter } from "./send-worker.ts";

/**
 * 跨进程共享的每通道令牌桶（表 channel_rate_buckets）。多个 ROLE=worker 进程共用同一额度，
 * 横向扩容不会把 rate_per_minute 放大。单条原子 UPSERT 取令牌；不足时按缺口计算等待时间，
 * 等待期间不占用数据库连接。
 */
export class DbRateLimiter implements RateLimiter {
  constructor(private readonly db: Db, private readonly sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {}

  async wait(channelId: string, ratePerMinute: number): Promise<void> {
    if (ratePerMinute <= 0) return;
    for (;;) {
      const refilled = sql`LEAST(${ratePerMinute}::float8, channel_rate_buckets.tokens + EXTRACT(EPOCH FROM (clock_timestamp() - channel_rate_buckets.updated_at)) * ${ratePerMinute}::float8 / 60)`;
      const taken = await this.db.execute<{ tokens: number }>(sql`
        INSERT INTO channel_rate_buckets (channel_id, tokens, updated_at)
        VALUES (${channelId}, ${ratePerMinute - 1}::float8, clock_timestamp())
        ON CONFLICT (channel_id) DO UPDATE SET tokens = ${refilled} - 1, updated_at = clock_timestamp()
        WHERE ${refilled} >= 1
        RETURNING tokens
      `);
      if (taken.rows.length) return;
      const current = await this.db.execute<{ tokens: number }>(sql`
        SELECT ${refilled} AS tokens FROM channel_rate_buckets WHERE channel_id = ${channelId}
      `);
      const tokens = Number(current.rows[0]?.tokens ?? 0);
      await this.sleep(Math.max(10, (1 - tokens) * 60_000 / ratePerMinute));
    }
  }
}
