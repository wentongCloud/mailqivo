import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  AiBlock,
  ContactFilter,
  CONTACT_STATUS_VALUES,
  type CampaignBody,
  type CampaignDto,
  type CampaignListDto,
  type CampaignPrerequisites,
  type CampaignPrerequisiteItem,
  type CampaignSendSummary,
  type CampaignStatus,
  type ConfirmChallenge,
  type RequeueUnknownBody,
  type RequeueUnknownResult,
  type RequeueUnknownSummary
} from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { campaignLinks, campaignSendTargets, campaigns, channelDailyUsage, channels, confirmTokens, contacts, messages } from "../../db/schema.ts";
import { consumeConfirmToken, issueConfirmToken } from "../../lib/confirm-token.ts";
import { AppError, Errors } from "../../lib/errors.ts";
import { assertUnsubscribeConfigured, type UnsubscribeConfig } from "../../mail/unsubscribe.ts";
import type { PageParams } from "../../lib/pagination.ts";
import { toPage } from "../../lib/pagination.ts";
import { sanitizeEmailHtml } from "../../render/sanitize.ts";
import { templateVariables } from "../../render/template.ts";
import { getChannelMailer, type ChannelRuntimeConfig } from "../channels/service.ts";
import { buildContactWhere } from "../contacts/where.ts";
import { getPrepareWarnRecipientThreshold } from "../settings/service.ts";
import { resolveCampaignChannel } from "./channel.ts";
import { PLACEHOLDER_TRACKING_ID, placeholderAiContent, renderCampaign, type CampaignRow } from "./render.ts";
import {
  assertRuleAttachments,
  assertRuleTagsExist,
  assetMetaById,
  buildAttachmentSnapshot,
  computeRulesBreakdown,
  contactIndustry,
  contactTagNames,
  matchContentRule,
  normalizeContentRules,
  parseStoredRules,
  toRuleSnapshot
} from "./content-rules.ts";
import { computeSampleStatus } from "./samples.ts";
import { assertCampaignTransition } from "./state.ts";
import { dayInTimezone } from "../../lib/timezone.ts";

export type CampaignRuntimeConfig = ChannelRuntimeConfig & Pick<Config, "APP_TIMEZONE" | "LLM_API_KEY" | "ASSET_DIR">;
type ContactRow = typeof contacts.$inferSelect;
type ChannelRow = Awaited<ReturnType<typeof resolveCampaignChannel>>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function campaignToDto(row: CampaignRow): CampaignDto {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    html: row.html,
    editor_mode: row.editor_mode as CampaignDto["editor_mode"],
    template_id: row.template_id,
    signature_id: row.signature_id,
    channel_id: row.channel_id,
    contact_filter: ContactFilter.parse(row.contact_filter),
    ai_goal: row.ai_goal,
    ai_fields: row.ai_fields,
    ai_blocks: AiBlock.array().parse(row.ai_blocks),
    track_opens: row.track_opens,
    track_clicks: row.track_clicks,
    content_rules: parseStoredRules(row.content_rules),
    status: row.status as CampaignStatus,
    pause_reason: row.pause_reason as CampaignDto["pause_reason"],
    fail_reason: row.fail_reason,
    send_at: iso(row.send_at),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString()
  };
}

export async function getCampaignRow(db: Db, id: string): Promise<CampaignRow> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!row) throw Errors.notFound("活动不存在");
  return row;
}

export async function getCampaign(db: Db, id: string) {
  return campaignToDto(await getCampaignRow(db, id));
}

export type CampaignListFilter = { status?: CampaignStatus; created_from?: string; created_to?: string };

export async function listCampaigns(db: Db, page: PageParams, filter: CampaignListFilter = {}) {
  const where = and(
    filter.status ? eq(campaigns.status, filter.status) : undefined,
    filter.created_from ? gte(campaigns.created_at, new Date(filter.created_from)) : undefined,
    filter.created_to ? lte(campaigns.created_at, new Date(filter.created_to)) : undefined
  );
  const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(campaigns).where(where);
  const rows = await db
    .select({
      campaign: campaigns,
      total: sql<number>`count(*) filter (where ${messages.status} <> 'skipped')::int`,
      sent: sql<number>`count(*) filter (where ${messages.status} = 'sent' and ${messages.bounce_type} is null)::int`,
      failed: sql<number>`count(*) filter (where ${messages.status} = 'failed')::int`,
      bounced: sql<number>`count(*) filter (where ${messages.status} = 'sent' and ${messages.bounce_type} is not null)::int`,
      opened: sql<number>`count(*) filter (where ${messages.status} = 'sent' and ${messages.bounce_type} is null and ${messages.first_opened_at} is not null and ${messages.open_suspect} = false)::int`
    })
    .from(campaigns)
    .leftJoin(messages, and(eq(messages.campaign_id, campaigns.id), eq(messages.is_test, false)))
    .where(where)
    .groupBy(campaigns.id)
    .orderBy(desc(campaigns.created_at), campaigns.id)
    .limit(page.limit)
    .offset(page.offset);
  const items: CampaignListDto[] = rows.map(({ campaign, ...metrics }) => ({ ...campaignToDto(campaign), metrics }));
  return toPage(items, counted!.total, page);
}

/** §9 `estimated_recipients`：当前筛选下会被发送的联系人数（只有 active 会发送，与 send 第一步的 recipients 同口径）。 */
export async function countEstimatedRecipients(db: Db, contactFilter: unknown): Promise<number> {
  const filter = { ...ContactFilter.parse(contactFilter), statuses: ["active" as const] };
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(contacts).where(buildContactWhere(filter));
  return row?.n ?? 0;
}

/** §11.4：活动批次只对应一个目标客群；通讯录筛选仍可用多标签。 */
function assertSingleAudience(filter: CampaignBody["contact_filter"]) {
  if ((filter.tags_any?.length ?? 0) > 1) {
    throw Errors.validation("活动只能选择一个目标客群标签", { field: "contact_filter.tags_any" });
  }
}

/**
 * 草稿定时意图：非法时间 → VALIDATION；已过期 → 清为 null（避免卡住自动保存）；
 * 未来时间原样写入。确认发送时再区分 scheduled / preparing。
 */
function parseDraftSendAt(sendAt: string | null, now = new Date()): Date | null {
  if (sendAt == null) return null;
  const date = new Date(sendAt);
  if (Number.isNaN(date.getTime())) {
    throw Errors.validation("定时发送时间格式无效", { field: "send_at" });
  }
  if (date.getTime() <= now.getTime()) return null;
  return date;
}

/** HTML 消毒 + §8.2 内容规则 id 处理与保存校验（content-rules.ts）+ §11.4 计划/客群。 */
async function clean(db: Db, config: Pick<Config, "ASSET_DIR">, body: CampaignBody, existingRules: unknown = []) {
  assertSingleAudience(body.contact_filter);
  const send_at = parseDraftSendAt(body.send_at);
  const content_rules = await normalizeContentRules(db, config, body.content_rules, parseStoredRules(existingRules), body.ai_blocks.length > 0);
  return { ...body, html: sanitizeEmailHtml(body.html), content_rules, send_at };
}

/**
 * 规格 §6.2 第 1–2 条：创建活动前置条件。至少有一个发送通道，且退订配置完整。
 * 只返回缺项，不返回配置值。Web 新建页读取；REST 与 MCP 创建草稿前经 assertCampaignPrerequisites 执行同一检查。
 */
export async function getCampaignPrerequisites(db: Db, config: UnsubscribeConfig): Promise<CampaignPrerequisites> {
  const missing: CampaignPrerequisiteItem[] = [];
  const [channel] = await db.select({ id: channels.id }).from(channels).limit(1);
  if (!channel) missing.push("channel");
  try {
    assertUnsubscribeConfigured(config);
  } catch {
    missing.push("unsubscribe");
  }
  return { ready: missing.length === 0, missing };
}

async function assertCampaignPrerequisites(db: Db, config: UnsubscribeConfig) {
  const result = await getCampaignPrerequisites(db, config);
  if (!result.ready) throw Errors.validation("创建活动前须先配置发送通道与退订地址", { missing: result.missing });
}

type CampaignWriteConfig = Pick<Config, "ASSET_DIR"> & UnsubscribeConfig;

export async function createCampaign(db: Db, body: CampaignBody, config: CampaignWriteConfig) {
  await assertCampaignPrerequisites(db, config);
  const [row] = await db.insert(campaigns).values(await clean(db, config, body)).returning({ id: campaigns.id });
  return getCampaign(db, row!.id);
}

/** 锁活动行后按 status='draft' 条件更新；与发送确认互斥（规格 §5.4 第 2 条）。 */
export async function updateCampaign(db: Db, id: string, body: CampaignBody, config: Pick<Config, "ASSET_DIR">) {
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [row] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!row) throw Errors.notFound("活动不存在");
    if (row.status !== "draft") throw Errors.invalidState("只有草稿状态的活动可以修改");
    const values = await clean(trx, config, body, row.content_rules);
    const updated = await trx.update(campaigns).set({ ...values, updated_at: new Date() })
      .where(and(eq(campaigns.id, id), eq(campaigns.status, "draft"))).returning({ id: campaigns.id });
    if (!updated.length) throw Errors.invalidState("只有草稿状态的活动可以修改");
  });
  return getCampaign(db, id);
}

/**
 * §6.1：草稿与已完成活动确认后永久删除。邮件、统计、追踪事件随外键级联删除；
 * 联系人状态（退订、退信）属于通讯录，不受影响。
 */
export async function deleteCampaign(db: Db, id: string) {
  await db.transaction(async (trx) => {
    const [row] = await trx.select({ status: campaigns.status }).from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!row) throw Errors.notFound("活动不存在");
    if (row.status !== "draft" && row.status !== "completed") throw Errors.invalidState("只有草稿或已完成的活动可以删除");
    await trx.delete(campaigns).where(eq(campaigns.id, id));
  });
}

/** 按通道日额度估算发完天数。daily_limit=0 表示不限日额度，按 1 天计（仍受每分钟速率约束）。 */
function estimateSendDays(recipients: number, dailyLimit: number, remainingToday: number): number {
  if (recipients === 0) return 0;
  if (dailyLimit <= 0 || recipients <= remainingToday) return 1;
  return 1 + Math.ceil((recipients - remainingToday) / dailyLimit);
}

type SendContext = {
  row: CampaignRow;
  channel: ChannelRow;
  recipientsRows: ContactRow[];
  recipientIdsHash: string;
  summary: CampaignSendSummary;
};

async function buildSendContext(db: Db, id: string, runtime: CampaignRuntimeConfig): Promise<SendContext> {
  const row = await getCampaignRow(db, id);
  if (row.status !== "draft") throw Errors.invalidState("只有草稿状态的活动可以发送");
  assertSingleAudience(ContactFilter.parse(row.contact_filter));
  const channel = await resolveCampaignChannel(db, row);
  const blocks = row.ai_blocks as { key: string }[];
  if (blocks.length && !runtime.LLM_API_KEY) throw new AppError("AI_DISABLED", "活动包含 AI 区块，但尚未配置 LLM_API_KEY");
  assertUnsubscribeConfigured(runtime);
  const recipientsRows = await matchedContacts(db, row);
  const activeRows = recipientsRows.filter((contact) => contact.status === "active");
  const recipients = activeRows.length;
  const skipped_by_status: Record<string, number> = {};
  for (const contact of recipientsRows) {
    if (contact.status !== "active") skipped_by_status[contact.status] = (skipped_by_status[contact.status] ?? 0) + 1;
  }
  const day = dayInTimezone(new Date(), runtime.APP_TIMEZONE);
  const [usage] = await db.select().from(channelDailyUsage).where(and(eq(channelDailyUsage.channel_id, channel.id), eq(channelDailyUsage.day, day)));
  const used = usage?.count ?? 0;
  // daily_limit=0：无日额度；remaining=-1 表示不限，预计 1 天发完（仍受每分钟速率约束）。
  const remaining = channel.daily_limit <= 0 ? -1 : Math.max(0, channel.daily_limit - used);
  const estimated_days = estimateSendDays(recipients, channel.daily_limit, remaining);
  // §6.2 第 6 步（V1.1）：标签仍存在、启用规则的附件可用；breakdown 按当前筛选快照计算，参与 summary_hash。
  const rules = parseStoredRules(row.content_rules);
  let breakdown: ReturnType<typeof computeRulesBreakdown> = { content_rules_breakdown: [], unmatched_recipients: recipients };
  let tagsByContact: Map<string, string[]> | undefined;
  if (rules.length) {
    await assertRuleTagsExist(db, rules);
    const attachmentsByRule = await assertRuleAttachments(db, runtime, rules);
    tagsByContact = await contactTagNames(db, and(buildContactWhere(ContactFilter.parse(row.contact_filter)), eq(contacts.status, "active")));
    const industryByContact = new Map(activeRows.map((contact) => [contact.id, contactIndustry(contact.custom_fields)]));
    breakdown = computeRulesBreakdown(rules, activeRows, tagsByContact, attachmentsByRule, industryByContact);
  }
  // §6.2 第 5 步 + 第 6 步（V1.1）：按联系人当前命中规则计算 hash 的样例门禁（samples.ts）。
  const ruleRecipients = new Map(breakdown.content_rules_breakdown.map((item) => [item.rule_id, item.recipients]));
  const samples = await computeSampleStatus(db, row, activeRows.map((contact) => contact.id), { tagsByContact, ruleRecipients });
  // §5.5：阈值每次计算摘要时读取；变化会改变摘要哈希，已发令牌按 §5.4 返回 CONFIRM_INVALID。
  const threshold = await getPrepareWarnRecipientThreshold(db);
  return {
    row,
    channel,
    recipientsRows,
    recipientIdsHash: recipientIdsHash(recipientsRows),
    summary: {
      recipients,
      skipped_by_status,
      channel_daily_remaining: remaining,
      estimated_days,
      ai_blocks: blocks.map((block) => block.key),
      sample_confirmed: samples.sample_confirmed,
      large_audience_warning: threshold > 0 && recipients >= threshold,
      // §6.2 第 6 步 / §11.4：每项 has_sample（无 ai_blocks 时恒 true），随 summary 一起进入 summary_hash。
      content_rules_breakdown: breakdown.content_rules_breakdown.map((item) => ({ ...item, has_sample: samples.rules_with_sample.has(item.rule_id) })),
      unmatched_recipients: breakdown.unmatched_recipients
    }
  };
}

/** 活动筛选命中的全部联系人（含非 active，用于跳过统计与准备时的 skipped）。 */
async function matchedContacts(db: Db, row: Pick<CampaignRow, "contact_filter">): Promise<ContactRow[]> {
  const filter = { ...ContactFilter.parse(row.contact_filter), statuses: [...CONTACT_STATUS_VALUES] };
  return db.select().from(contacts).where(buildContactWhere(filter));
}

/** 规格 §5.4 第 2 条：确认绑定的名单成员。按 contact_id 排序，`contact_id:status` 以 "," 连接后取 sha256。 */
function recipientIdsHash(rows: Pick<ContactRow, "id" | "status">[]): string {
  const items = rows.map((row) => `${row.id}:${row.status}`).sort();
  return createHash("sha256").update(items.join(",")).digest("hex");
}

/** 参与 summary_hash 的摘要：去掉随通道用量自然变化的两项，界面仍展示完整摘要。 */
function confirmedSummary(summary: CampaignSendSummary) {
  const { channel_daily_remaining: _remaining, estimated_days: _days, ...stable } = summary;
  return stable;
}

const confirmInvalid = (message: string) => new AppError("CONFIRM_INVALID", message, { reason: "TARGET_MISMATCH" });

/**
 * 规格 §5.4 第 2 条、§6.2 第 7 条：
 * 1. 第一步只计算摘要并发放令牌，令牌绑定草稿版本、发送时间、通道与名单哈希。
 * 2. 第二步在短事务内锁活动行、复核草稿版本并占用令牌；不一致时不重签。
 * 3. 事务外验证所选通道的 SMTP 连接与认证；失败时活动保持草稿，令牌已用。
 * 4. 新事务内复核版本与名单，写入 campaign_send_targets，再转入 preparing 或 scheduled。
 */
export async function sendCampaign(
  db: Db,
  id: string,
  input: { send_at?: string; confirm_token?: string },
  runtime: CampaignRuntimeConfig
): Promise<CampaignDto | ConfirmChallenge<CampaignSendSummary>> {
  const context = await buildSendContext(db, id, runtime);
  // 请求显式带 send_at 时覆盖草稿；省略则用草稿已存计划（§11.4 Step 1）。
  const resolvedIso = input.send_at !== undefined ? input.send_at : iso(context.row.send_at);
  const sendAt = resolvedIso ? new Date(resolvedIso) : null;
  const version = context.row.updated_at.toISOString();
  const target = {
    campaign_id: id,
    draft_version: version,
    send_at: resolvedIso ?? null,
    channel_id: context.channel.id,
    recipient_ids_hash: context.recipientIdsHash
  };
  const action = "campaign_send" as const;
  const stable = confirmedSummary(context.summary);
  if (!input.confirm_token) {
    const challenge = await issueConfirmToken(db, { action, target, summary: stable });
    return { ...challenge, summary: context.summary };
  }
  const token = input.confirm_token;

  const claimed = await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [locked] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!locked) throw Errors.notFound("活动不存在");
    if (locked.status !== "draft") throw Errors.invalidState("只有草稿状态的活动可以发送");
    try {
      await consumeConfirmToken(trx, { token, action, target, summary: stable, reissue: false });
    } catch (error) {
      // 令牌作废须提交，返回而非抛出。
      if (error instanceof AppError && error.code === "CONFIRM_INVALID") return error;
      throw error;
    }
    if (locked.updated_at.toISOString() !== version) return confirmInvalid("草稿已修改，请重新获取摘要");
    // 规格 §6.2 第 5 步：令牌与当前摘要一致仍缺样例，说明确认的摘要本就不合格。抛出使事务回滚，令牌不作废。
    // 原摘要合格而当前缺样例时摘要哈希不同，上面的令牌校验已作废令牌并要求重新确认。
    if (!context.summary.sample_confirmed) throw Errors.invalidState("请先生成至少 3 个 AI 样例（且每条有收件人的内容规则至少 1 个）后再发送");
    return null;
  });
  if (claimed) throw claimed;

  const mailer = await getChannelMailer(db, context.channel.id, runtime);
  const smtp = await mailer.verifySmtp();
  if (!smtp.ok) {
    throw new AppError("CHANNEL_ERROR", `发送通道「${context.channel.name}」连接或认证失败：${smtp.error ?? "未知错误"}`, {
      channel_id: context.channel.id,
      channel_name: context.channel.name
    });
  }

  const scheduled = !!sendAt && sendAt.getTime() > Date.now();
  const nextStatus: CampaignStatus = scheduled ? "scheduled" : "preparing";
  assertCampaignTransition("draft", nextStatus);
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [locked] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!locked) throw Errors.notFound("活动不存在");
    if (locked.status !== "draft") throw Errors.invalidState("活动已离开草稿状态");
    if (locked.updated_at.toISOString() !== version) throw confirmInvalid("草稿已修改，请重新获取摘要");
    const rows = await matchedContacts(trx, locked);
    if (recipientIdsHash(rows) !== context.recipientIdsHash) throw confirmInvalid("收件人名单已变化，请重新获取摘要");
    const values = rows.map((row) => ({ campaign_id: id, contact_id: row.id, confirmed_status: row.status }));
    // 分批插入，避免大名单超过 PostgreSQL 单语句参数上限。
    for (let start = 0; start < values.length; start += 5000) await trx.insert(campaignSendTargets).values(values.slice(start, start + 5000));
    await trx.update(campaigns).set({
      status: nextStatus,
      channel_id: context.channel.id,
      send_at: scheduled ? sendAt : null,
      updated_at: new Date()
    }).where(eq(campaigns.id, id));
  });
  if (scheduled) return getCampaign(db, id);
  // 与 scheduler 一致：prepare 失败不得卡在 preparing。
  try {
    return await prepareCampaign(db, id, runtime);
  } catch (error) {
    await failPreparingCampaign(db, id, error);
    return getCampaign(db, id);
  }
}

/** 建快照失败：仍为 preparing 的活动置为 failed 并记录原因，同一事务删除确认名单。即时发送与 scheduler 共用。 */
export async function failPreparingCampaign(db: Db, id: string, error: unknown, now = new Date()): Promise<void> {
  assertCampaignTransition("preparing", "failed");
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const failed = await trx.update(campaigns).set({
      status: "failed",
      fail_reason: error instanceof Error ? error.message : String(error),
      finished_at: now,
      updated_at: now
    }).where(and(eq(campaigns.id, id), eq(campaigns.status, "preparing"))).returning({ id: campaigns.id });
    if (failed.length) await trx.delete(campaignSendTargets).where(eq(campaignSendTargets.campaign_id, id));
  });
}

/** message 未发送时，联系人当前状态对应的 skip_reason（联系人已删除视为 CONTACT_INVALID）。preparing 与发送 worker 共用。 */
export function contactSkipReason(status: string | undefined): "CONTACT_UNSUBSCRIBED" | "CONTACT_BOUNCED" | "CONTACT_INVALID" {
  if (status === "unsubscribed") return "CONTACT_UNSUBSCRIBED";
  if (status === "bounced") return "CONTACT_BOUNCED";
  return "CONTACT_INVALID";
}

/**
 * preparing：读取确认时锁定的名单（campaign_send_targets）并逐人写 messages。
 * 确认时与当前均为 active 的成员入队；确认时已跳过的成员按确认时状态记 skipped，确认后变为非 active 的成员按当前状态记 skipped。
 * 确认后才符合筛选条件的联系人不追加。无人可入队时仍写 skipped 明细，活动置为 failed。
 * 名单行在标签读取与 messages 写入之后、同一事务内删除。T07 到点任务同样调用。
 */
export async function prepareCampaign(db: Db, id: string, runtime: CampaignRuntimeConfig) {
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [current] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!current) throw Errors.notFound("活动不存在");
    // 即时发送、调度恢复和取消共享活动行锁。已处理的任务无需重复创建快照。
    if (current.status !== "preparing") return;
    assertCampaignTransition("preparing", "sending");
    const snapshot = await trx
      .select({ contact: contacts, confirmed_status: campaignSendTargets.confirmed_status })
      .from(campaignSendTargets)
      .innerJoin(contacts, eq(contacts.id, campaignSendTargets.contact_id))
      .where(eq(campaignSendTargets.campaign_id, id));
    const eligible = (item: (typeof snapshot)[number]) => item.confirmed_status === "active" && item.contact.status === "active";
    const anyEligible = snapshot.some(eligible);
    const rules = anyEligible ? parseStoredRules(current.content_rules) : [];
    if (anyEligible) {
      // 链接快照使用占位联系人，避免首位联系人缺字段导致整个 preparing 失败；缺失变量由 worker 按 message 跳过。
      const placeholderFields = Object.fromEntries(templateVariables(`${current.subject}${current.html}`).map(({ key }) => [key, `[${key}]`]));
      const rendered = await renderCampaign(trx, current, {
        contact: { email: "preview@example.com", name: "示例联系人", company: "示例公司", title: "示例职位", custom_fields: placeholderFields },
        trackingId: PLACEHOLDER_TRACKING_ID,
        aiContent: placeholderAiContent(current.ai_blocks)
      }, runtime);
      await trx.delete(campaignLinks).where(eq(campaignLinks.campaign_id, id));
      if (rendered.links.length) await trx.insert(campaignLinks).values(rendered.links.map((link) => ({ campaign_id: id, ...link })));
    }
    // §6.1 / §8.2 V1.1：每个入队收件人正式匹配一次内容规则并写快照，此后不再重算。标签查询依赖名单行，须在删除名单之前执行。
    const queuedTargets = sql`${contacts.id} IN (SELECT ${campaignSendTargets.contact_id} FROM ${campaignSendTargets} WHERE ${campaignSendTargets.campaign_id} = ${id} AND ${campaignSendTargets.confirmed_status} = 'active')`;
    const tagsByContact = rules.length ? await contactTagNames(trx, and(queuedTargets, eq(contacts.status, "active"))) : new Map<string, string[]>();
    const assetMeta = rules.length ? await assetMetaById(trx, rules) : new Map();
    const ruleFields = (contact: ContactRow) => {
      if (!rules.length) return {};
      const match = matchContentRule(rules, tagsByContact.get(contact.id) ?? [], contactIndustry(contact.custom_fields));
      if (!match) return {};
      return { content_rule_snapshot: toRuleSnapshot(match), attachment_snapshot: buildAttachmentSnapshot(match.rule, assetMeta) };
    };
    const queuedStatus = (current.ai_blocks as unknown[]).length ? "pending_ai" : "queued";
    const values = snapshot.map((item) => {
      const base = { campaign_id: id, contact_id: item.contact.id, email: item.contact.email, is_test: false };
      if (eligible(item)) return { ...base, status: queuedStatus, skip_reason: null, ...ruleFields(item.contact) };
      // 摘要中已跳过的成员按确认时状态记原因；确认后才失去资格的成员按当前状态记原因。
      const reasonStatus = item.confirmed_status === "active" ? item.contact.status : item.confirmed_status;
      return { ...base, status: "skipped", skip_reason: contactSkipReason(reasonStatus) };
    });
    // 分批插入，避免大名单超过 PostgreSQL 单语句参数上限。
    for (let start = 0; start < values.length; start += 2000) await trx.insert(messages).values(values.slice(start, start + 2000));
    await trx.delete(campaignSendTargets).where(eq(campaignSendTargets.campaign_id, id));
    const now = new Date();
    if (!anyEligible) {
      await trx.update(campaigns).set({ status: "failed", fail_reason: "收件人为 0", finished_at: now, updated_at: now }).where(eq(campaigns.id, id));
      return;
    }
    await trx.update(campaigns).set({ status: "sending", started_at: now, updated_at: now }).where(eq(campaigns.id, id));
  });
  return getCampaign(db, id);
}

/** 条件更新：只有读取时的状态仍未变化才转换，否则返回 INVALID_STATE（避免覆盖并发完成或取消）。 */
async function transitionFrom(db: Db, id: string, to: "paused" | "sending", values: Partial<typeof campaigns.$inferInsert>) {
  const row = await getCampaignRow(db, id);
  const from = row.status as CampaignStatus;
  assertCampaignTransition(from, to);
  const updated = await db.update(campaigns).set({ ...values, status: to, updated_at: new Date() })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, from))).returning({ id: campaigns.id });
  if (!updated.length) throw Errors.invalidState("活动状态已变化，请刷新后重试");
  return getCampaign(db, id);
}

export async function pauseCampaign(db: Db, id: string) {
  return transitionFrom(db, id, "paused", { pause_reason: "MANUAL" });
}

export async function resumeCampaign(db: Db, id: string) {
  return transitionFrom(db, id, "sending", { pause_reason: null });
}

/** sending 活动没有待处理 message 时置为 completed。worker 热路径用：只做条件更新，不回读活动。 */
export async function markCampaignCompletedIfDone(db: Db, id: string): Promise<boolean> {
  assertCampaignTransition("sending", "completed");
  const now = new Date();
  const completed = await db.update(campaigns)
    .set({ status: "completed", finished_at: now, updated_at: now })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "sending"), sql`NOT EXISTS (
      SELECT 1 FROM messages WHERE campaign_id = ${id} AND status IN ('pending_ai', 'queued', 'sending')
    )`)).returning({ id: campaigns.id });
  return completed.length > 0;
}

export async function cancelCampaign(db: Db, id: string, confirmToken?: string): Promise<CampaignDto | ConfirmChallenge<{ queued_messages: number }>> {
  const result = await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [row] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!row) throw Errors.notFound("活动不存在");
    assertCampaignTransition(row.status as CampaignStatus, "cancelled");
    const queued = and(eq(messages.campaign_id, id), inArray(messages.status, ["pending_ai", "queued"]));
    const [counted] = await trx.select({ count: sql<number>`count(*)::int` }).from(messages).where(queued);
    const params = { action: "campaign_cancel" as const, target: { campaign_id: id }, summary: { queued_messages: counted!.count } };
    if (!confirmToken) return issueConfirmToken(trx, params);
    try {
      await consumeConfirmToken(trx, { token: confirmToken, ...params });
    } catch (error) {
      if (error instanceof AppError && error.code === "CONFIRM_INVALID") return error;
      throw error;
    }
    await trx.update(messages).set({ status: "skipped", skip_reason: "CAMPAIGN_CANCELLED" }).where(queued);
    // scheduled 或 preparing 活动的确认名单不再进入准备流程，与终态同一事务删除。
    await trx.delete(campaignSendTargets).where(eq(campaignSendTargets.campaign_id, id));
    const [cancelled] = await trx.update(campaigns).set({ status: "cancelled", finished_at: new Date(), updated_at: new Date() })
      .where(eq(campaigns.id, id)).returning();
    return campaignToDto(cancelled!);
  });
  if (result instanceof AppError) throw result;
  return result;
}

// ---------------------------------------------------------------------------
// §6.3「unknown 人工回收」：POST /api/campaigns/:id/messages/requeue-unknown
// ---------------------------------------------------------------------------

const REQUEUE_ALLOWED: readonly CampaignStatus[] = ["sending", "paused", "completed"];

function assertRequeueState(status: string) {
  if (!REQUEUE_ALLOWED.includes(status as CampaignStatus)) {
    throw Errors.invalidState(`活动状态为 ${status}，不能回收 unknown 邮件`, { status });
  }
}

/** 校验 message_ids 并求目标集合 S（升序 id）。`strict` 为第一步：含本活动但非 unknown 的 id → VALIDATION。 */
async function requeueTargetSet(db: Db, id: string, messageIds: string[] | undefined, strict: boolean, lock: boolean): Promise<string[]> {
  const base = and(eq(messages.campaign_id, id), eq(messages.is_test, false));
  if (messageIds) {
    const unique = [...new Set(messageIds)];
    const query = db.select({ id: messages.id, status: messages.status }).from(messages).where(and(base, inArray(messages.id, unique)));
    const rows = lock ? await query.for("update") : await query;
    const found = new Set(rows.map((row) => row.id));
    const foreign = unique.filter((messageId) => !found.has(messageId));
    if (foreign.length) throw Errors.validation("message_ids 含非本活动的邮件", { message_ids: foreign });
    const notUnknown = rows.filter((row) => row.status !== "unknown");
    if (strict && notUnknown.length) {
      throw Errors.validation("message_ids 含状态不是 unknown 的邮件", { messages: notUnknown.map((row) => ({ id: row.id, status: row.status })) });
    }
    return rows.filter((row) => row.status === "unknown").map((row) => row.id).sort();
  }
  const query = db.select({ id: messages.id }).from(messages).where(and(base, eq(messages.status, "unknown")));
  const rows = lock ? await query.for("update") : await query;
  return rows.map((row) => row.id).sort();
}

function requeueSummary(ids: string[]): RequeueUnknownSummary {
  return {
    unknown_count: ids.length,
    message_ids_hash: createHash("sha256").update(ids.join(",")).digest("hex"),
    message_ids_sample: ids.slice(0, 10)
  };
}

class RequeueRowCountMismatch extends Error {}

export async function requeueUnknownMessages(
  db: Db,
  id: string,
  input: RequeueUnknownBody
): Promise<RequeueUnknownResult | ConfirmChallenge<RequeueUnknownSummary>> {
  const action = "message_requeue_unknown" as const;
  const target = { campaign_id: id, message_ids: input.message_ids ? [...new Set(input.message_ids)].sort() : null };
  if (!input.confirm_token) {
    const row = await getCampaignRow(db, id);
    assertRequeueState(row.status);
    const ids = await requeueTargetSet(db, id, input.message_ids, true, false);
    return issueConfirmToken(db, { action, target, summary: requeueSummary(ids) });
  }
  const token = input.confirm_token;
  let outcome: { requeued: number } | { invalid: AppError };
  try {
    outcome = await db.transaction(async (tx) => {
      const trx = tx as unknown as Db;
      // ① 锁活动行并复查状态
      const [row] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
      if (!row) throw Errors.notFound("活动不存在");
      assertRequeueState(row.status);
      const ids = await requeueTargetSet(trx, id, input.message_ids, false, true);
      try {
        await consumeConfirmToken(trx, { token, action, target, summary: requeueSummary(ids) });
      } catch (error) {
        // 令牌作废与新令牌须提交；此前没有任何业务写入。
        if (error instanceof AppError && error.code === "CONFIRM_INVALID") return { invalid: error };
        throw error;
      }
      if (!ids.length) return { requeued: 0 };
      // ② 回收，attempt 不变；行数必须等于 |S|
      const updated = await trx.update(messages).set({ status: "queued", locked_at: null, next_attempt_at: sql`now()` })
        .where(and(eq(messages.campaign_id, id), eq(messages.status, "unknown"), eq(messages.is_test, false), inArray(messages.id, ids)))
        .returning({ id: messages.id });
      if (updated.length !== ids.length) throw new RequeueRowCountMismatch();
      // ③ completed → sending（唯一允许离开 completed 的转换）
      if (row.status === "completed") {
        assertCampaignTransition("completed", "sending", "requeue_unknown");
        await trx.update(campaigns).set({ status: "sending", finished_at: null, updated_at: new Date() }).where(eq(campaigns.id, id));
      }
      return { requeued: updated.length };
    });
  } catch (error) {
    if (!(error instanceof RequeueRowCountMismatch)) throw error;
    // 已回滚：作废旧令牌，按最新集合发新令牌。
    await db.update(confirmTokens).set({ used_at: new Date() }).where(and(eq(confirmTokens.token, token), isNull(confirmTokens.used_at)));
    const ids = await requeueTargetSet(db, id, input.message_ids, false, false);
    const next = await issueConfirmToken(db, { action, target, summary: requeueSummary(ids) });
    throw new AppError("CONFIRM_INVALID", "数据已发生变化，请重新确认最新摘要", { reason: "SUMMARY_CHANGED", summary: next.summary, confirm_token: next.confirm_token });
  }
  if ("invalid" in outcome) throw outcome.invalid;
  return outcome;
}
