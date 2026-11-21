import { and, eq, lte } from "drizzle-orm";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { campaigns } from "../db/schema.ts";
import { dayInTimezone } from "../lib/timezone.ts";
import { failPreparingCampaign, prepareCampaign } from "../modules/campaigns/service.ts";
import { pollAllChannels } from "../inbound/imap-poller.ts";
import { runExclusive, SINGLETON_LOCKS } from "./singleton.ts";

export type SchedulerRuntime = Pick<Config, "APP_ENCRYPTION_KEY" | "MAIL_ID_DOMAIN" | "MAIL_PUBLIC_BASE_URL" | "UNSUBSCRIBE_PUBLIC_URL" | "UNSUBSCRIBE_SHARED_SECRET" | "APP_TIMEZONE" | "LLM_API_KEY" | "LLM_MOCK" | "LLM_MODEL" | "LLM_BASE_URL" | "IMAP_POLL_INTERVAL_SEC" | "ASSET_DIR">;

/** 到点活动先原子置 preparing，再复用 T06 的快照；次日自动恢复日限额暂停。 */
export async function runSchedulerOnce(db: Db, runtime: SchedulerRuntime, now = new Date()) {
  await db.update(campaigns).set({ status: "preparing", updated_at: now })
    .where(and(eq(campaigns.status, "scheduled"), lte(campaigns.send_at, now)));
  // preparing 持久化为待建快照任务；进程重启后仍可拾取，prepareCampaign 持行锁去重。
  const due = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, "preparing"));
  const paused = await db.select().from(campaigns).where(and(eq(campaigns.status, "paused"), eq(campaigns.pause_reason, "DAILY_LIMIT")));
  const today = dayInTimezone(now, runtime.APP_TIMEZONE);
  let resumed = 0;
  for (const campaign of paused) {
    if (dayInTimezone(campaign.updated_at, runtime.APP_TIMEZONE) >= today) continue;
    await db.update(campaigns).set({ status: "sending", pause_reason: null, updated_at: now })
      .where(and(eq(campaigns.id, campaign.id), eq(campaigns.status, "paused"), eq(campaigns.pause_reason, "DAILY_LIMIT")));
    resumed += 1;
  }
  for (const campaign of due) {
    try {
      await prepareCampaign(db, campaign.id, runtime);
    } catch (error) {
      await failPreparingCampaign(db, campaign.id, error, now);
    }
  }
  return { prepared: due.length, resumed };
}

export function startScheduler(db: Db, runtime: SchedulerRuntime) {
  let running = false;
  let inboundRunning = false;
  let stopped = false;
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    // 单轮失败只记日志，留待下个周期重试；不得让 rejection 逃出 tick 导致进程退出。
    // 多 worker 部署时只由持锁进程执行，其余进程跳过本轮。
    try { await runExclusive(db, SINGLETON_LOCKS.scheduler, () => runSchedulerOnce(db, runtime)); }
    catch (error) { console.error("[scheduler] tick 失败，下一轮重试", error); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void tick(); }, 30_000);
  const pollInbound = async () => {
    if (inboundRunning || stopped) return;
    inboundRunning = true;
    try {
      const result = await runExclusive(db, SINGLETON_LOCKS.inboundPoll, () => pollAllChannels(db, runtime));
      if (result.skipped) return;
      for (const item of result.value.errors) {
        console.error(`[scheduler] IMAP 通道失败 channel_id=${item.channel_id}: ${item.error}`);
      }
    } catch (error) {
      console.error("[scheduler] IMAP 轮询失败，下一轮重试", error);
    } finally {
      inboundRunning = false;
    }
  };
  const inboundTimer = setInterval(() => { void pollInbound(); }, runtime.IMAP_POLL_INTERVAL_SEC * 1000);
  timer.unref();
  inboundTimer.unref();
  void tick();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      clearInterval(inboundTimer);
      while (running || inboundRunning) await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
}
