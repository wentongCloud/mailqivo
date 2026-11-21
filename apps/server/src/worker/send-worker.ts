import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { SOFT_BOUNCE_STREAK_LIMIT, type AttachmentSnapshotItem, type ReasonCode } from "@mailqivo/shared";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { campaigns, channels, contacts, messages } from "../db/schema.ts";
import { classifyReason } from "../inbound/reason-rules.ts";
import type { MailAttachment, MailChannel, SendReceipt } from "../mail/channel.ts";
import { AssetUnavailableError, readAssetVerified } from "../modules/assets/index.ts";
import { createMailerCache, getChannelMailer } from "../modules/channels/service.ts";
import { contactForRender, loadRenderAssets, renderCampaign, type CampaignRow, type RenderAssets } from "../modules/campaigns/render.ts";
import { contactSkipReason, getCampaignRow, markCampaignCompletedIfDone } from "../modules/campaigns/service.ts";
import { assertCampaignTransition } from "../modules/campaigns/state.ts";
import { MissingVarError } from "../render/template.ts";
import { syncUnsubscribeEvents } from "./unsubscribe-sync.ts";
import { dayInTimezone } from "../lib/timezone.ts";
import { TtlCache } from "../lib/ttl-cache.ts";
import { DbRateLimiter } from "./db-rate-limiter.ts";
import { startClaimLoop } from "./claim-loop.ts";

export type MessageRow = typeof messages.$inferSelect;
type Runtime = Pick<Config, "APP_ENCRYPTION_KEY" | "MAIL_ID_DOMAIN" | "MAIL_PUBLIC_BASE_URL" | "UNSUBSCRIBE_PUBLIC_URL" | "UNSUBSCRIBE_SHARED_SECRET" | "APP_TIMEZONE" | "SEND_WORKER_CONCURRENCY" | "ASSET_DIR">;
type ChannelRow = typeof channels.$inferSelect;
type ContactRow = typeof contacts.$inferSelect;
type MailerFactory = (db: Db, channelId: string, runtime: Runtime, row?: ChannelRow) => Promise<MailChannel>;

/**
 * 发送 worker 的短期缓存（默认 5 秒）：活动正文在 sending 之后不可修改，通道 / settings / 签名
 * 允许几秒的延迟生效；活动与联系人状态仍在交接事务中加锁复查，不依赖缓存。
 */
export type SendCaches = {
  campaigns: TtlCache<CampaignRow>;
  channels: TtlCache<ChannelRow | undefined>;
  renderAssets: TtlCache<RenderAssets>;
};

export function createSendCaches(ttlMs = 5_000): SendCaches {
  return { campaigns: new TtlCache(ttlMs), channels: new TtlCache(ttlMs), renderAssets: new TtlCache(ttlMs) };
}

export interface RateLimiter {
  wait(channelId: string, ratePerMinute: number): Promise<void>;
}

export type SendWorkerOptions = {
  concurrency?: number;
  fetchUnsubscribeEvents?: typeof fetch;
  mailerFactory?: MailerFactory;
  caches?: SendCaches;
  rateLimiter?: RateLimiter;
  now?: () => Date;
  /** 进程内滚动窗口，用于五分钟内五次发件限流暂停活动。 */
  rateLimitEvents?: Map<string, number[]>;
};

const noWait: RateLimiter = { wait: async () => undefined };

/** SMTP 硬退：联系人置为 bounced。 */
const HARD_BOUNCE_REASONS: readonly ReasonCode[] = ["ADDR_NOT_EXIST", "ADDR_DOMAIN_INVALID", "ADDR_DISABLED"];
/** 临时失败：可重试；最终失败时累计联系人 soft_bounce_streak。 */
const TEMPORARY_REASONS: readonly ReasonCode[] = ["TEMP_MAILBOX_FULL", "TEMP_SERVER_BUSY", "UNKNOWN"];

export async function claimQueuedMessages(db: Db, limit: number): Promise<MessageRow[]> {
  if (limit <= 0) return [];
  const result = await db.execute<MessageRow>(sql`
    UPDATE messages SET status = 'sending', locked_at = now(), send_lease_id = ${randomUUID()}::uuid
    WHERE id IN (
      SELECT m.id FROM messages m JOIN campaigns c ON c.id = m.campaign_id
      WHERE m.status = 'queued' AND m.next_attempt_at <= now() AND c.status = 'sending'
      ORDER BY m.next_attempt_at LIMIT ${limit} FOR UPDATE OF m SKIP LOCKED
    )
    RETURNING *
  `);
  return result.rows;
}

async function pauseCampaign(db: Db, campaignId: string, reason: "DAILY_LIMIT" | "CHANNEL_ERROR", now: Date) {
  assertCampaignTransition("sending", "paused");
  await db.update(campaigns).set({ status: "paused", pause_reason: reason, updated_at: now }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "sending")));
}

function ownsSending(message: MessageRow) {
  return and(eq(messages.id, message.id), eq(messages.status, "sending"),
    message.send_lease_id ? eq(messages.send_lease_id, message.send_lease_id) : sql`false`);
}

async function releaseClaim(db: Db, message: MessageRow, values: Partial<typeof messages.$inferInsert>) {
  const updated = await db.update(messages).set({ ...values, locked_at: null, send_lease_id: null })
    .where(ownsSending(message)).returning({ id: messages.id });
  return updated.length > 0;
}

async function requeueForSender(db: Db, message: MessageRow, receipt: Extract<SendReceipt, { ok: false }>, reason: ReasonCode, now: Date) {
  const released = await releaseClaim(db, message, {
    status: "queued",
    next_attempt_at: new Date(now.getTime() + 60_000),
    smtp_code: receipt.code,
    smtp_response: receipt.response,
    failure_reason: reason
  });
  if (released && reason === "SENDER_AUTH") await pauseCampaign(db, message.campaign_id, "CHANNEL_ERROR", now);
  return released;
}

async function finishMessage(db: Db, message: MessageRow, values: Partial<typeof messages.$inferInsert>) {
  if (await releaseClaim(db, message, values)) await markCampaignCompletedIfDone(db, message.campaign_id);
}

/**
 * §6.3 步骤 5「其余 → failed … 按 §4.1 更新联系人」：SMTP 会话失败（message 未 sent）对联系人的影响。
 * 只从 active 转出：硬退（ADDR_*）→ bounced；TEMP_* / UNKNOWN 最终失败 → streak+1，≥3 → invalid；
 * POLICY_* 等无影响。已是 unsubscribed / bounced / invalid 的联系人不被改写。
 *
 * R1b 定稿：有意不走 `applyBounceEffect`。后者的幂等键是“已 sent 的 message 的首次退信”
 * （条件 `status='sent' AND bounced_at IS NULL`），而这里的 message 已置为 failed、从未送出，
 * 也不写 message 的 bounce_* 字段、不增加 `bounce_count`（bounce_count 只计送出后的退信，
 * 与 §10.3 的 bounced 口径一致）。每封 message 只会进入一次 failed，因此天然 message 级幂等。
 */
export async function applySmtpContactFailure(db: Db, contactId: string | null, reason: ReasonCode, now = new Date()) {
  if (!contactId) return;
  if (HARD_BOUNCE_REASONS.includes(reason)) {
    await db.update(contacts).set({ status: "bounced", invalid_reason: reason, updated_at: now })
      .where(and(eq(contacts.id, contactId), eq(contacts.status, "active")));
    return;
  }
  if (!TEMPORARY_REASONS.includes(reason)) return;
  await db.transaction(async (tx) => {
    const [contact] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.status, "active"))).for("update");
    if (!contact) return;
    const streak = contact.soft_bounce_streak + 1;
    await tx.update(contacts).set({
      soft_bounce_streak: streak,
      ...(streak >= SOFT_BOUNCE_STREAK_LIMIT ? { status: "invalid", invalid_reason: "SOFT_BOUNCE_REPEATED" } : {}),
      updated_at: now
    }).where(and(eq(contacts.id, contactId), eq(contacts.status, "active")));
  });
}

async function reserveDailyQuota(db: Db, channel: CampaignRow["channel_id"], day: string, limit: number) {
  if (!channel) return false;
  // daily_limit=0：商用发信通道无日额度；仍记账便于观测，但不触发 DAILY_LIMIT。
  if (limit <= 0) {
    await db.execute(sql`
      INSERT INTO channel_daily_usage (channel_id, day, count) VALUES (${channel}, ${day}, 1)
      ON CONFLICT (channel_id, day) DO UPDATE SET count = channel_daily_usage.count + 1
    `);
    return true;
  }
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO channel_daily_usage (channel_id, day, count)
    SELECT ${channel}, ${day}, 1
    WHERE NOT EXISTS (SELECT 1 FROM channel_daily_usage WHERE channel_id = ${channel} AND day = ${day} AND count >= ${limit})
    ON CONFLICT (channel_id, day) DO UPDATE SET count = channel_daily_usage.count + 1
    WHERE channel_daily_usage.count < ${limit}
    RETURNING count
  `);
  return result.rows.length > 0;
}

function receiptIsTemporary(receipt: Extract<SendReceipt, { ok: false }>, reason: ReasonCode) {
  return TEMPORARY_REASONS.includes(reason) || (!!receipt.code && receipt.code >= 400 && receipt.code < 500);
}

/**
 * §6.3 步骤 2（V1.1）：按 attachment_snapshot 顺序读取并校验每个附件（不检查 enabled）。
 * 任一失败返回 null（调用方置 skipped(ATTACHMENT_UNAVAILABLE)，禁止去掉附件发送、不重试）。
 * 先校验附件，再消耗通道日额度。
 */
async function loadSnapshotAttachments(db: Db, runtime: Runtime, message: MessageRow): Promise<{ attachments: MailAttachment[] } | { error: AssetUnavailableError }> {
  const snapshot = (message.attachment_snapshot as AttachmentSnapshotItem[] | null) ?? [];
  const attachments: MailAttachment[] = [];
  for (const item of snapshot) {
    try {
      const content = await readAssetVerified(db, runtime, item);
      attachments.push({ filename: item.filename, contentType: item.mime_type, content });
    } catch (error) {
      if (error instanceof AssetUnavailableError) return { error };
      throw error;
    }
  }
  return { attachments };
}

async function reserveSmtpHandoff(
  db: Db, message: MessageRow, contactId: string, channel: Pick<typeof channels.$inferSelect, "id" | "daily_limit">,
  clickTargets: string[], day: string
) {
  // 在 SMTP 之前确认租约、保存本封链接并预扣额度。失去租约的旧进程不得投递或覆盖新结果。
  return db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    // 活动→联系人→消息固定锁序。并发发送可共享读锁，取消或退订与交接按提交顺序生效。
    const [activity] = await trx.select({ status: campaigns.status }).from(campaigns)
      .where(eq(campaigns.id, message.campaign_id)).for("share");
    if (!activity) return "lost";
    if (activity.status === "cancelled") {
      await releaseClaim(trx, message, { status: "skipped", skip_reason: "CAMPAIGN_CANCELLED" });
      return "cancelled";
    }
    if (activity.status !== "sending") {
      await releaseClaim(trx, message, { status: "queued" });
      return "paused";
    }
    const [recipient] = await trx.select({ status: contacts.status }).from(contacts)
      .where(eq(contacts.id, contactId)).for("share");
    if (recipient?.status !== "active") {
      await releaseClaim(trx, message, { status: "skipped", skip_reason: contactSkipReason(recipient?.status) });
      return "skipped";
    }
    const owned = await trx.update(messages).set({
      locked_at: sql`now()`, click_targets: clickTargets
    }).where(ownsSending(message)).returning({ id: messages.id });
    if (!owned.length) return "lost";
    if (await reserveDailyQuota(trx, channel.id, day, channel.daily_limit)) return "ready";
    await releaseClaim(trx, message, { status: "queued" });
    return "limited";
  });
}

/** 已渲染（sent / failed）的 message 记录所用联系人字段与 AI 内容。 */
function renderedVars(contact: ContactRow, message: MessageRow) {
  return { contact: contactForRender(contact), ai_content: message.ai_content };
}

type PreparedSend = {
  contact: ContactRow;
  campaign: CampaignRow;
  rendered: Awaited<ReturnType<typeof renderCampaign>>;
  attachments: MailAttachment[];
  mailer: MailChannel;
};

/** 交接前异常的重试上限：退避 1、2、4、8、16 分钟，约 31 分钟后仍失败则置 failed。 */
export const PREPARE_FAILURE_LIMIT = 6;

/** 公网退订源暂时不可达：合规前置条件，无限期等待恢复，不计入 prepare_failures。 */
export class UnsubscribeSyncError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "UnsubscribeSyncError";
  }
}

export async function processClaimedMessage(
  db: Db, message: MessageRow, runtime: Runtime, options: SendWorkerOptions = {},
  synchronize = () => syncUnsubscribeEvents(db, runtime, options.fetchUnsubscribeEvents)
) {
  let prepared: PreparedSend | null;
  try {
    prepared = await prepareSend(db, message, runtime, options, synchronize);
  } catch (error) {
    // SMTP 交接之前的异常：邮件肯定未发出，不能留在 sending 等租约过期被标成 unknown（“可能已发出”）。
    try {
      await handlePrepareFailure(db, message, error);
    } catch (releaseError) {
      console.error(`[send-worker] message ${message.id} 退回队列失败`, releaseError);
    }
    throw error;
  }
  if (!prepared) return;
  await deliver(db, message, options, prepared);
}

async function handlePrepareFailure(db: Db, message: MessageRow, error: unknown) {
  if (error instanceof UnsubscribeSyncError) {
    await releaseClaim(db, message, { status: "queued", next_attempt_at: new Date(Date.now() + 60_000) });
    return;
  }
  // 数据库抖动等瞬时错误退避重试；通道配置解密失败等确定性错误达到上限后置 failed，让活动可以结束并在界面可见。
  const failures = message.prepare_failures + 1;
  const detail = error instanceof Error ? error.message : String(error);
  if (failures >= PREPARE_FAILURE_LIMIT) {
    await finishMessage(db, message, {
      status: "failed", failure_reason: "UNKNOWN", prepare_failures: failures,
      smtp_response: `发送前准备连续失败 ${failures} 次（未交给 SMTP）：${detail}`.slice(0, 2000)
    });
    return;
  }
  await releaseClaim(db, message, {
    status: "queued", prepare_failures: failures,
    next_attempt_at: new Date(Date.now() + 60_000 * 2 ** (failures - 1))
  });
}

/** 交接前的全部步骤：返回 null 表示 message 已被终结或释放（无需投递）。 */
async function prepareSend(
  db: Db, message: MessageRow, runtime: Runtime, options: SendWorkerOptions,
  synchronize: () => Promise<void>
): Promise<PreparedSend | null> {
  const [contact] = message.contact_id ? await db.select().from(contacts).where(eq(contacts.id, message.contact_id)) : [];
  if (!contact || contact.status !== "active") {
    await finishMessage(db, message, { status: "skipped", skip_reason: contactSkipReason(contact?.status) });
    return null;
  }
  const loaded = await loadSnapshotAttachments(db, runtime, message);
  if ("error" in loaded) {
    // 日志与 smtp_response 只记资产 id 与原因，不含文件内容或 ASSET_DIR 路径。
    await finishMessage(db, message, { status: "skipped", skip_reason: "ATTACHMENT_UNAVAILABLE", smtp_response: `附件不可用：${loaded.error.asset_id} ${loaded.error.reason}` });
    return null;
  }
  const { caches } = options;
  const campaign = caches
    ? await caches.campaigns.get(message.campaign_id, () => getCampaignRow(db, message.campaign_id))
    : await getCampaignRow(db, message.campaign_id);
  if (!campaign.channel_id) {
    await finishMessage(db, message, { status: "failed", failure_reason: "UNKNOWN", smtp_response: "活动没有发送通道" });
    return null;
  }
  const channelId = campaign.channel_id;
  const loadChannel = async () => (await db.select().from(channels).where(eq(channels.id, channelId)))[0];
  const channel = caches ? await caches.channels.get(channelId, loadChannel) : await loadChannel();
  if (!channel) {
    await finishMessage(db, message, { status: "failed", failure_reason: "UNKNOWN", smtp_response: "发送通道不存在" });
    return null;
  }

  await (options.rateLimiter ?? noWait).wait(channel.id, channel.rate_per_minute);
  // 公网退订源不可达时抛出：SMTP 尚未开始，由外层退回队列，等退订源恢复。
  if (runtime.UNSUBSCRIBE_PUBLIC_URL || runtime.UNSUBSCRIBE_SHARED_SECRET) {
    await synchronize().catch((error: unknown) => { throw new UnsubscribeSyncError(error); });
  }
  let rendered: Awaited<ReturnType<typeof renderCampaign>>;
  try {
    rendered = await renderCampaign(db, campaign, {
      contact: contactForRender(contact),
      trackingId: message.tracking_id,
      aiContent: message.ai_content as Record<string, string>
    }, runtime, caches ? await caches.renderAssets.get(`${campaign.id}:${campaign.signature_id ?? "default"}`, () => loadRenderAssets(db, campaign)) : undefined);
  } catch (error) {
    if (error instanceof MissingVarError) {
      await finishMessage(db, message, { status: "skipped", skip_reason: "MISSING_VAR", smtp_response: error.message });
    } else {
      await finishMessage(db, message, { status: "failed", failure_reason: "UNKNOWN", smtp_response: error instanceof Error ? error.message : String(error) });
    }
    return null;
  }

  if (Buffer.byteLength(rendered.html, "utf8") > 500 * 1024) {
    await finishMessage(db, message, {
      status: "failed", failure_reason: "POLICY_CONTENT", smtp_response: "最终 HTML 超过 500KB",
      rendered_vars: renderedVars(contact, message), rendered_subject: rendered.subject
    });
    return null;
  }

  const mailer = await (options.mailerFactory ?? getChannelMailer)(db, channel.id, runtime, channel);
  const handoffTime = options.now?.() ?? new Date();
  const handoff = await reserveSmtpHandoff(db, message, contact.id, channel, rendered.links.map((link) => link.url),
    dayInTimezone(handoffTime, runtime.APP_TIMEZONE));
  if (handoff === "skipped") await markCampaignCompletedIfDone(db, campaign.id);
  if (handoff === "limited") await pauseCampaign(db, campaign.id, "DAILY_LIMIT", handoffTime);
  if (handoff !== "ready") return null;
  return { contact, campaign, rendered, attachments: loaded.attachments, mailer };
}

async function deliver(db: Db, message: MessageRow, options: SendWorkerOptions, prepared: PreparedSend) {
  const { contact, campaign, rendered, attachments, mailer } = prepared;
  const receipt = await mailer.send({
    to: message.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    unsubscribeUrl: rendered.unsubscribeUrl,
    tracking_id: message.tracking_id,
    campaign_id: campaign.id,
    // §6.5：按快照顺序加入附件；无快照时不传，MIME 与 V1.0 完全一致。
    ...(attachments.length ? { attachments } : {})
  });
  const now = options.now?.() ?? new Date();
  if (receipt.ok) {
    await finishMessage(db, message, {
      status: "sent", sent_at: now, smtp_code: receipt.code, smtp_response: receipt.response,
      failure_reason: null,
      rendered_vars: renderedVars(contact, message),
      rendered_subject: rendered.subject
    });
    return;
  }

  const reason = classifyReason(receipt);
  if (reason === "SENDER_AUTH" || reason === "SENDER_RATE_LIMIT") {
    if (!await requeueForSender(db, message, receipt, reason, now)) return;
    if (reason === "SENDER_RATE_LIMIT") {
      const events = options.rateLimitEvents ?? new Map<string, number[]>();
      const recent = [...(events.get(campaign.id) ?? []), now.getTime()].filter((time) => now.getTime() - time <= 5 * 60_000);
      events.set(campaign.id, recent);
      if (recent.length >= 5) await pauseCampaign(db, campaign.id, "CHANNEL_ERROR", now);
    }
    return;
  }

  const temporary = receiptIsTemporary(receipt, reason);
  if (temporary && message.attempt + 1 < 4) {
    const attempt = message.attempt + 1;
    await releaseClaim(db, message, {
      status: "queued", attempt, smtp_code: receipt.code, smtp_response: receipt.response,
      failure_reason: reason, next_attempt_at: new Date(now.getTime() + 5 * 60_000 * 4 ** (attempt - 1))
    });
    return;
  }

  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const failed = await releaseClaim(trx, message, {
      status: "failed", attempt: temporary ? message.attempt + 1 : message.attempt,
      smtp_code: receipt.code, smtp_response: receipt.response, failure_reason: reason,
      rendered_vars: renderedVars(contact, message),
      rendered_subject: rendered.subject
    });
    if (failed) await applySmtpContactFailure(trx, message.contact_id, reason, now);
  });
  await markCampaignCompletedIfDone(db, campaign.id);
}

export async function recoverStaleSending(db: Db, olderThan = new Date(Date.now() - 10 * 60_000)) {
  const rows = await db.update(messages).set({ status: "unknown", locked_at: null, send_lease_id: null })
    .where(and(eq(messages.status, "sending"), sql`${messages.locked_at} < ${olderThan}`)).returning({ campaign_id: messages.campaign_id });
  for (const campaignId of new Set(rows.map((row) => row.campaign_id))) await markCampaignCompletedIfDone(db, campaignId);
  return rows.length;
}

export function startSendWorker(db: Db, runtime: Runtime, options: SendWorkerOptions = {}) {
  // 默认按通道缓存持久 SMTP 连接池；worker 停止时统一关闭。
  const mailers = options.mailerFactory ? undefined : createMailerCache();
  const shared = {
    ...options,
    mailerFactory: options.mailerFactory ?? mailers!.get,
    caches: options.caches ?? createSendCaches(),
    // 默认用数据库令牌桶：多 worker 进程共享 rate_per_minute。
    rateLimiter: options.rateLimiter ?? new DbRateLimiter(db),
    rateLimitEvents: options.rateLimitEvents ?? new Map()
  };
  let syncing: Promise<void> | undefined;
  const synchronize = () => {
    syncing ??= syncUnsubscribeEvents(db, runtime, options.fetchUnsubscribeEvents)
      .finally(() => { syncing = undefined; });
    return syncing;
  };
  let nextRecovery = 0;
  let nextIdleSync = 0;
  return startClaimLoop<MessageRow>({
    name: "send-worker",
    concurrency: options.concurrency ?? runtime.SEND_WORKER_CONCURRENCY,
    claim: (limit) => claimQueuedMessages(db, limit),
    process: (message) => processClaimedMessage(db, message, runtime, shared, synchronize),
    async beforeClaim() {
      if (Date.now() < nextRecovery) return;
      nextRecovery = Date.now() + 60_000;
      await recoverStaleSending(db).catch((error: unknown) => { console.error("[send-worker] 回收发送租约失败", error); });
    },
    async onIdle() {
      if (Date.now() < nextIdleSync) return;
      nextIdleSync = Date.now() + 60_000;
      await synchronize();
    },
    heartbeat: {
      everyMs: 60_000,
      async renew(items) {
        const leases = [...new Set(items.map((item) => item.send_lease_id).filter((lease): lease is string => !!lease))];
        if (!leases.length) return;
        await db.update(messages).set({ locked_at: sql`now()` }).where(and(
          inArray(messages.id, items.map((item) => item.id)), inArray(messages.send_lease_id, leases), eq(messages.status, "sending")
        ));
      }
    },
    onStop: () => mailers?.close()
  });
}
