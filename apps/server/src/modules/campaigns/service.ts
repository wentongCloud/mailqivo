import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  AiBlock,
  ContactFilter,
  CONTACT_STATUS_VALUES,
  type CampaignBody,
  type CampaignDto,
  type CampaignListDto,
  type CampaignSendSummary,
  type CampaignStatus,
  type ConfirmChallenge,
  type ContactStatus,
  type RequeueUnknownBody,
  type RequeueUnknownResult,
  type RequeueUnknownSummary
} from "@mailqivo/shared";
import type { Config } from "../../config.ts";
import type { Db } from "../../db/client.ts";
import { campaignLinks, campaigns, channelDailyUsage, channels, confirmTokens, contacts, messages } from "../../db/schema.ts";
import { consumeConfirmToken, issueConfirmToken } from "../../lib/confirm-token.ts";
import { AppError, Errors } from "../../lib/errors.ts";
import { assertUnsubscribeConfigured } from "../../mail/unsubscribe.ts";
import type { PageParams } from "../../lib/pagination.ts";
import { toPage } from "../../lib/pagination.ts";
import { sanitizeEmailHtml } from "../../render/sanitize.ts";
import { BUILTIN_TEMPLATE_KEYS, templateVariables } from "../../render/template.ts";
import type { ChannelRuntimeConfig } from "../channels/service.ts";
import { buildContactWhere } from "../contacts/where.ts";
import { getPrepareWarnRecipientThreshold, getSettings } from "../settings/service.ts";
import { renderCampaign, resolveSignature, type CampaignRow } from "./render.ts";
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
type ChannelRow = typeof channels.$inferSelect;

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

export async function createCampaign(db: Db, body: CampaignBody, config: Pick<Config, "ASSET_DIR">) {
  const [row] = await db.insert(campaigns).values(await clean(db, config, body)).returning({ id: campaigns.id });
  return getCampaign(db, row!.id);
}

export async function updateCampaign(db: Db, id: string, body: CampaignBody, config: Pick<Config, "ASSET_DIR">) {
  const row = await getCampaignRow(db, id);
  if (row.status !== "draft") throw Errors.invalidState("只有草稿状态的活动可以修改");
  await db.update(campaigns).set({ ...(await clean(db, config, body, row.content_rules)), updated_at: new Date() }).where(eq(campaigns.id, id));
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

async function resolveChannel(db: Db, row: CampaignRow): Promise<ChannelRow> {
  const where = row.channel_id ? eq(channels.id, row.channel_id) : eq(channels.is_default, true);
  const [channel] = await db.select().from(channels).where(where);
  if (!channel) throw Errors.validation(row.channel_id ? "所选发送通道不存在" : "没有可用的默认发送通道");
  return channel;
}

async function validateVariables(db: Db, row: CampaignRow): Promise<void> {
  const [settings, signature, customKeys] = await Promise.all([
    getSettings(db),
    resolveSignature(db, row),
    db.execute<{ key: string }>(sql`SELECT DISTINCT jsonb_object_keys(custom_fields) AS key FROM contacts`)
  ]);
  const source = `${row.subject}${row.html}${signature?.html ?? ""}${settings.footer_html}`;
  const vars = templateVariables(source);
  const blocks = new Set((row.ai_blocks as { key: string }[]).map((block) => block.key));
  const custom = new Set(customKeys.rows.map((item) => item.key));
  const unknown = vars
    .filter((item) => !item.hasDefault)
    .filter((item) => {
      if (BUILTIN_TEMPLATE_KEYS.has(item.key) || custom.has(item.key)) return false;
      if (item.key.startsWith("ai.")) return !blocks.has(item.key.slice(3));
      if (item.key.startsWith("ai_")) return !blocks.has(item.key.slice(3));
      return true;
    })
    .map((item) => item.key);
  if (unknown.length) throw Errors.validation("模板包含无法解析的变量", { variables: [...new Set(unknown)] });
}

type SendContext = {
  row: CampaignRow;
  channel: ChannelRow;
  recipientsRows: ContactRow[];
  summary: CampaignSendSummary;
};

async function buildSendContext(db: Db, id: string, runtime: CampaignRuntimeConfig): Promise<SendContext> {
  const row = await getCampaignRow(db, id);
  if (row.status !== "draft") throw Errors.invalidState("只有草稿状态的活动可以发送");
  assertSingleAudience(ContactFilter.parse(row.contact_filter));
  const channel = await resolveChannel(db, row);
  const blocks = row.ai_blocks as { key: string }[];
  if (blocks.length && !runtime.LLM_API_KEY) throw new AppError("AI_DISABLED", "活动包含 AI 区块，但尚未配置 LLM_API_KEY");
  assertUnsubscribeConfigured(runtime);
  await validateVariables(db, row);
  const filter = { ...ContactFilter.parse(row.contact_filter), statuses: [...CONTACT_STATUS_VALUES] };
  const recipientsRows = await db.select().from(contacts).where(buildContactWhere(filter));
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
  const estimated_days = recipients === 0
    ? 0
    : channel.daily_limit <= 0
      ? 1
      : recipients <= remaining
        ? 1
        : 1 + Math.ceil((recipients - remaining) / channel.daily_limit);
  // §6.2 第 6 步（V1.1）：标签仍存在、启用规则的附件可用；breakdown 按当前筛选快照计算，参与 summary_hash。
  const rules = parseStoredRules(row.content_rules);
  let breakdown: ReturnType<typeof computeRulesBreakdown> = { content_rules_breakdown: [], unmatched_recipients: recipients };
  let tagsByContact: Map<string, string[]> | undefined;
  if (rules.length) {
    await assertRuleTagsExist(db, rules);
    const attachmentsByRule = await assertRuleAttachments(db, runtime, rules);
    tagsByContact = await contactTagNames(db, and(buildContactWhere(filter), eq(contacts.status, "active")));
    const industryByContact = new Map(activeRows.map((contact) => [contact.id, contactIndustry(contact.custom_fields)]));
    breakdown = computeRulesBreakdown(rules, activeRows, tagsByContact, attachmentsByRule, industryByContact);
  }
  const ruleSummary = breakdown;
  // §6.2 第 5 步 + 第 6 步（V1.1）：按联系人当前命中规则计算 hash 的样例门禁（samples.ts）。
  const ruleRecipients = new Map(ruleSummary.content_rules_breakdown.map((item) => [item.rule_id, item.recipients]));
  const samples = await computeSampleStatus(db, row, activeRows.map((contact) => contact.id), { tagsByContact, ruleRecipients });
  const confirmed = samples.sample_confirmed;
  // §5.5：阈值每次计算摘要时读取；变化会改变摘要哈希，已发令牌按 §5.4 返回 CONFIRM_INVALID。
  const threshold = await getPrepareWarnRecipientThreshold(db);
  return {
    row,
    channel,
    recipientsRows,
    summary: {
      recipients,
      skipped_by_status,
      channel_daily_remaining: remaining,
      estimated_days,
      ai_blocks: blocks.map((block) => block.key),
      sample_confirmed: confirmed,
      large_audience_warning: threshold > 0 && recipients >= threshold,
      // §6.2 第 6 步 / §11.4：每项 has_sample（无 ai_blocks 时恒 true），随 summary 一起进入 summary_hash。
      content_rules_breakdown: ruleSummary.content_rules_breakdown.map((item) => ({ ...item, has_sample: samples.rules_with_sample.has(item.rule_id) })),
      unmatched_recipients: ruleSummary.unmatched_recipients
    }
  };
}

export async function sendCampaign(
  db: Db,
  id: string,
  input: { send_at?: string; confirm_token?: string },
  runtime: CampaignRuntimeConfig
): Promise<CampaignDto | ConfirmChallenge<CampaignSendSummary>> {
  const context = await buildSendContext(db, id, runtime);
  // §6.2 第 5 步 / §11.4：第一步照常返回摘要（UI 据 sample_confirmed=false 禁用确认并标出缺样例的规则）；
  // 带令牌的第二步重新计算后仍为 false 则拒绝（INVALID_STATE，在消费令牌之前；UI 与 MCP 共用此服务函数）。
  if (input.confirm_token && !context.summary.sample_confirmed) throw Errors.invalidState("请先生成至少 3 个 AI 样例（且每条有收件人的内容规则至少 1 个）后再发送");
  // 请求显式带 send_at 时覆盖草稿；省略则用草稿已存计划（§11.4 Step 1）。
  const resolvedIso = input.send_at !== undefined ? input.send_at : iso(context.row.send_at);
  const sendAt = resolvedIso ? new Date(resolvedIso) : null;
  const target = { campaign_id: id, send_at: resolvedIso ?? null, channel_id: context.channel.id };
  if (!input.confirm_token) return issueConfirmToken(db, { action: "campaign_send", target, summary: context.summary });
  await consumeConfirmToken(db, { token: input.confirm_token, action: "campaign_send", target, summary: context.summary });
  const scheduled = !!sendAt && sendAt.getTime() > Date.now();
  const nextStatus: CampaignStatus = scheduled ? "scheduled" : "preparing";
  assertCampaignTransition("draft", nextStatus);
  const advanced = await db.update(campaigns).set({
    status: nextStatus,
    channel_id: context.channel.id,
    send_at: scheduled ? sendAt : null,
    updated_at: new Date()
  }).where(and(eq(campaigns.id, id), eq(campaigns.status, "draft"))).returning({ id: campaigns.id });
  if (!advanced.length) throw Errors.invalidState("活动已离开草稿状态");
  if (scheduled) return getCampaign(db, id);
  // 与 scheduler 一致：prepare 失败不得卡在 preparing（令牌已消费）。
  try {
    return await prepareCampaign(db, id, runtime);
  } catch (error) {
    const now = new Date();
    assertCampaignTransition("preparing", "failed");
    await db.update(campaigns).set({
      status: "failed",
      fail_reason: error instanceof Error ? error.message : String(error),
      finished_at: now,
      updated_at: now
    }).where(and(eq(campaigns.id, id), eq(campaigns.status, "preparing")));
    return getCampaign(db, id);
  }
}

/** preparing 快照：筛选此刻的联系人，非 active 也落库为 skipped。T07 到点任务同样调用。 */
export async function prepareCampaign(db: Db, id: string, runtime: CampaignRuntimeConfig) {
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const [current] = await trx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!current) throw Errors.notFound("活动不存在");
    // 即时发送、调度恢复和取消共享活动行锁。已处理的任务无需重复创建快照。
    if (current.status !== "preparing") return;
    assertCampaignTransition("preparing", "sending");
    const filter = { ...ContactFilter.parse(current.contact_filter), statuses: [...CONTACT_STATUS_VALUES] };
    const snapshot = await trx.select().from(contacts).where(buildContactWhere(filter));
    const active = snapshot.filter((contact) => contact.status === "active");
    if (!active.length) {
      await trx.update(campaigns).set({ status: "failed", fail_reason: "收件人为 0", finished_at: new Date(), updated_at: new Date() }).where(eq(campaigns.id, id));
      return;
    }
    // 链接快照使用占位联系人，避免首位联系人缺字段导致整个 preparing 失败；缺失变量由 worker 按 message 跳过。
    const placeholderFields = Object.fromEntries(templateVariables(`${current.subject}${current.html}`).map(({ key }) => [key, `[${key}]`]));
    const rendered = await renderCampaign(trx, current, {
      contact: { email: "preview@example.com", name: "示例联系人", company: "示例公司", title: "示例职位", custom_fields: placeholderFields },
      trackingId: "00000000-0000-4000-8000-000000000000",
      aiContent: Object.fromEntries((current.ai_blocks as { key: string }[]).map((block) => [block.key, `[AI:${block.key}]`]))
    }, runtime);
    await trx.delete(campaignLinks).where(eq(campaignLinks.campaign_id, id));
    if (rendered.links.length) await trx.insert(campaignLinks).values(rendered.links.map((link) => ({ campaign_id: id, ...link })));
    const reason: Record<Exclude<ContactStatus, "active">, string> = { invalid: "CONTACT_INVALID", bounced: "CONTACT_BOUNCED", unsubscribed: "CONTACT_UNSUBSCRIBED" };
    // §6.1 / §8.2 V1.1：每个 active 收件人正式匹配一次内容规则并写快照，此后不再重算。
    const rules = parseStoredRules(current.content_rules);
    const tagsByContact = rules.length ? await contactTagNames(trx, and(buildContactWhere(filter), eq(contacts.status, "active"))) : new Map<string, string[]>();
    const assetMeta = rules.length ? await assetMetaById(trx, rules) : new Map();
    const ruleFields = (contact: ContactRow) => {
      if (contact.status !== "active" || !rules.length) return {};
      const match = matchContentRule(rules, tagsByContact.get(contact.id) ?? [], contactIndustry(contact.custom_fields));
      if (!match) return {};
      return { content_rule_snapshot: toRuleSnapshot(match), attachment_snapshot: buildAttachmentSnapshot(match.rule, assetMeta) };
    };
    const values = snapshot.map((contact) => ({
      campaign_id: id,
      contact_id: contact.id,
      email: contact.email,
      is_test: false,
      status: contact.status === "active" ? ((current.ai_blocks as unknown[]).length ? "pending_ai" : "queued") : "skipped",
      skip_reason: contact.status === "active" ? null : reason[contact.status as Exclude<ContactStatus, "active">],
      ...ruleFields(contact)
    }));
    // 分批插入，避免大名单超过 PostgreSQL 单语句参数上限。
    for (let start = 0; start < values.length; start += 2000) await trx.insert(messages).values(values.slice(start, start + 2000));
    await trx.update(campaigns).set({ status: "sending", started_at: new Date(), updated_at: new Date() }).where(eq(campaigns.id, id));
  });
  return getCampaign(db, id);
}

/** scheduler 到点后先把 scheduled 置为 preparing，再复用快照逻辑。 */
export async function prepareScheduledCampaign(db: Db, id: string, runtime: CampaignRuntimeConfig) {
  const row = await getCampaignRow(db, id);
  assertCampaignTransition(row.status as CampaignStatus, "preparing");
  await db.update(campaigns).set({ status: "preparing", updated_at: new Date() }).where(and(eq(campaigns.id, id), eq(campaigns.status, "scheduled")));
  return prepareCampaign(db, id, runtime);
}

export async function pauseCampaign(db: Db, id: string) {
  const row = await getCampaignRow(db, id);
  assertCampaignTransition(row.status as CampaignStatus, "paused");
  await db.update(campaigns).set({ status: "paused", pause_reason: "MANUAL", updated_at: new Date() }).where(eq(campaigns.id, id));
  return getCampaign(db, id);
}

export async function resumeCampaign(db: Db, id: string) {
  const row = await getCampaignRow(db, id);
  assertCampaignTransition(row.status as CampaignStatus, "sending");
  await db.update(campaigns).set({ status: "sending", pause_reason: null, updated_at: new Date() }).where(eq(campaigns.id, id));
  return getCampaign(db, id);
}

async function completeIfDone(db: Db, id: string) {
  assertCampaignTransition("sending", "completed");
  const now = new Date();
  const [completed] = await db.update(campaigns)
    .set({ status: "completed", finished_at: now, updated_at: now })
    .where(and(eq(campaigns.id, id), eq(campaigns.status, "sending"), sql`NOT EXISTS (
      SELECT 1 FROM messages WHERE campaign_id = ${id} AND status IN ('pending_ai', 'queued', 'sending')
    )`)).returning();
  return completed;
}

export async function completeCampaignIfDone(db: Db, id: string) {
  const completed = await completeIfDone(db, id);
  return completed ? campaignToDto(completed) : getCampaign(db, id);
}

/** worker 热路径用：只做条件更新，不再回读活动、不做 DTO 解析。 */
export async function markCampaignCompletedIfDone(db: Db, id: string): Promise<boolean> {
  return !!(await completeIfDone(db, id));
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
