/**
 * §9 MCP 工具表。每个工具都是对 REST 路由所用服务函数的薄封装：校验、两步确认、状态机、匹配器都不在这里重写。
 * 入参 schema 在 shared `dto/mcp.ts`；业务校验仍交给各 REST 共用的 DTO（CampaignBody / ContactStatusBody 等）。
 */
import type { z } from "zod";
import {
  AI_PREVIEW_NOTICE,
  CampaignBody,
  CampaignPreviewBody,
  ContactStatusBody,
  ImportCommitBody,
  LARGE_AUDIENCE_WARNING_TEXT,
  MCP_ASSET_MAX_BYTES,
  MCP_PREVIEW_TEXT_MAX_CHARS,
  McpAssetDisableInput,
  McpAssetListInput,
  McpAssetUploadInput,
  McpCampaignCancelInput,
  McpCampaignCreateInput,
  McpCampaignIdInput,
  McpCampaignListInput,
  McpCampaignPreviewInput,
  McpCampaignSendInput,
  McpCampaignUpdateInput,
  McpContactImportCommitInput,
  McpContactImportInput,
  McpContactSearchInput,
  McpContactUpdateStatusInput,
  McpReplyGetInput,
  McpReplyListInput,
  McpReplyUpdateInput,
  OPEN_RATE_DISCLAIMER,
  ReplyPatchBody,
  type CampaignSendSummary,
  type McpToolName
} from "@mailqivo/shared";
import type { LlmClient } from "../ai/llm-client.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import { Errors, parseOrThrow } from "../lib/errors.ts";
import { parsePagination, toPage } from "../lib/pagination.ts";
import { createAsset, disableAsset, listAssets } from "../modules/assets/index.ts";
import { cancelCampaign, countEstimatedRecipients, createCampaign, getCampaign, listCampaigns, pauseCampaign, resumeCampaign, sendCampaign, updateCampaign } from "../modules/campaigns/service.ts";
import { previewCampaign } from "../modules/campaigns/preview.ts";
import { getCampaignStats } from "../modules/campaigns/stats.ts";
import { searchContacts, updateContactStatus } from "../modules/contacts/service.ts";
import { commitImport, createImport } from "../modules/imports/service.ts";
import { getReply, listReplies, updateReply } from "../modules/replies/service.ts";
import { findOrCreateTags } from "../modules/tags/service.ts";
import { getTemplate } from "../modules/templates/service.ts";

export type McpContext = { db: Db; config: Config; llm: LlmClient | null };

export type McpTool<S extends z.ZodType = z.ZodType> = {
  name: McpToolName;
  description: string;
  schema: S;
  /** `raw` 是客户端原样传入的参数（用于区分“未传”与“默认值”，如 campaign_update 的局部更新）。 */
  handler: (ctx: McpContext, args: z.output<S>, raw: Record<string, unknown>) => Promise<unknown>;
};

/** §9 要求写进两步确认类工具描述的固定句子。 */
export const MCP_CONFIRM_SENTENCE = "第一次调用会返回摘要和 confirm_token，你必须把摘要展示给用户并得到明确同意后，才能带 token 再次调用。";

const tool = <S extends z.ZodType>(t: McpTool<S>): McpTool => t as unknown as McpTool;

// --- base64 -----------------------------------------------------------------

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** 严格解码 base64；在分配缓冲区之前先按长度估算解码后大小。 */
function decodeBase64(input: string, maxBytes: number, tooLarge: () => Error): Buffer {
  const text = input.replace(/\s+/g, "");
  if (text.length % 4 !== 0 || !BASE64_RE.test(text)) throw Errors.validation("file_base64 不是合法的 base64", { reason: "BASE64_INVALID" });
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  if ((text.length / 4) * 3 - padding > maxBytes) throw tooLarge();
  return Buffer.from(text, "base64");
}

const pageOf = <T>(items: T[], raw: unknown) => {
  const page = parsePagination(raw);
  return toPage(items.slice(page.offset, page.offset + page.limit), items.length, page);
};

const stripUndefined = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

// --- 活动 -------------------------------------------------------------------

const NO_SAMPLE_NOTICE = "尚未满足 AI 样例门槛，当前不能发送：请先用 edm_campaign_preview 预览至少 3 位不同收件人（且每条有收件人的内容规则至少 1 位）。";

/** send 第一步附带的“必须展示给用户”的提示（纯展示层，不影响摘要与令牌）。 */
function sendNotices(summary: CampaignSendSummary): string[] {
  const notices: string[] = [];
  if (summary.large_audience_warning) notices.push(LARGE_AUDIENCE_WARNING_TEXT);
  if (!summary.sample_confirmed) {
    notices.push(NO_SAMPLE_NOTICE);
    const missing = summary.content_rules_breakdown.filter((item) => item.recipients > 0 && !item.has_sample).map((item) => item.name);
    if (missing.length) notices.push(`以下内容规则尚无样例（未预览）：${missing.join("、")}`);
  }
  return notices;
}

const campaignTools = [
  tool({
    name: "edm_campaign_create",
    description: "创建邮件活动草稿（不会发送）。html 与 template_id 至少提供一个；只给 template_id 时以该模板的 html 为正文。可带 content_rules（按联系人标签 Tags 分组的内容规则：tags_all、instruction、attachment_ids、priority、enabled；附件须先用 edm_asset_upload 上传）。返回 { campaign_id, estimated_recipients }。",
    schema: McpCampaignCreateInput,
    handler: async ({ db, config }, args) => {
      let html = args.html;
      if (html === undefined) {
        if (!args.template_id) throw Errors.validation("html 与 template_id 至少提供一个", [{ path: "html", message: "html 与 template_id 二选一必填" }]);
        html = (await getTemplate(db, args.template_id)).html;
      }
      // SPEC-GAP: §9 未规定 editor_mode；MCP 传入的是成品 HTML，固定为 html 模式，避免网页端富文本编辑器改写。
      const body = parseOrThrow(CampaignBody, { ...args, html, editor_mode: "html" });
      const created = await createCampaign(db, body, config);
      return { campaign_id: created.id, estimated_recipients: await countEstimatedRecipients(db, created.contact_filter) };
    }
  }),
  tool({
    name: "edm_campaign_update",
    description: "修改草稿活动：campaign_id 加上 create 中的任意字段（只改传入的字段，其余保持不变；content_rules 传入则整体替换）。非 draft 状态返回 INVALID_STATE。返回活动对象。",
    schema: McpCampaignUpdateInput,
    handler: async ({ db, config }, args, raw) => {
      const current = await getCampaign(db, args.campaign_id);
      const base = Object.fromEntries(Object.keys(CampaignBody.shape).map((key) => [key, (current as Record<string, unknown>)[key]]));
      const patch = stripUndefined(Object.fromEntries(Object.keys(McpCampaignUpdateInput.shape).filter((k) => k !== "campaign_id").map((k) => [k, raw[k]])));
      const updated = await updateCampaign(db, args.campaign_id, parseOrThrow(CampaignBody, { ...base, ...patch }), config);
      return { ...updated, estimated_recipients: await countEstimatedRecipients(db, updated.contact_filter) };
    }
  }),
  tool({
    name: "edm_campaign_get",
    description: "读取活动对象（含 content_rules）以及 estimated_recipients（当前筛选下会被发送的 active 联系人数）。",
    schema: McpCampaignIdInput,
    handler: async ({ db }, args) => {
      const campaign = await getCampaign(db, args.campaign_id);
      return { ...campaign, estimated_recipients: await countEstimatedRecipients(db, campaign.contact_filter) };
    }
  }),
  tool({
    name: "edm_campaign_list",
    description: "分页列出活动，可按 status、创建时间范围（ISO 8601，必须带时区偏移）筛选；每项含 metrics。",
    schema: McpCampaignListInput,
    handler: async ({ db }, args) =>
      listCampaigns(db, parsePagination(args), { status: args.status, created_from: args.created_from, created_to: args.created_to })
  }),
  tool({
    name: "edm_campaign_preview",
    description: `按当前筛选随机（或按 contact_ids）为 sample 位 active 联系人生成并渲染样例（AI 区块会真实调用 LLM 并写入缓存，样例数量满足门槛才能发送）。每项返回 contact、subject、text（截断到 ${MCP_PREVIEW_TEXT_MAX_CHARS} 字，不返回 html）、ai_content、warnings、content_rule（命中的内容规则）、matched_tags、attachments（仅元数据，不含内容）。含 AI 内容的样例带 notice：「${AI_PREVIEW_NOTICE}」，请原样展示给用户。`,
    schema: McpCampaignPreviewInput,
    handler: async ({ db, config, llm }, args) => {
      const items = await previewCampaign(db, config, llm, args.campaign_id, parseOrThrow(CampaignPreviewBody, { contact_ids: args.contact_ids, sample: args.sample }));
      return items.map(({ html: _html, text, ...rest }) => ({
        ...rest,
        text: text.slice(0, MCP_PREVIEW_TEXT_MAX_CHARS),
        text_truncated: text.length > MCP_PREVIEW_TEXT_MAX_CHARS,
        ...(Object.keys(rest.ai_content).length ? { notice: AI_PREVIEW_NOTICE } : {})
      }));
    }
  }),
  tool({
    name: "edm_campaign_send",
    description: `发送活动（草稿 → 立即发送或按 send_at 定时）。${MCP_CONFIRM_SENTENCE}第一步返回 { requires_confirmation, confirm_token, summary, notices }：summary 含 recipients、skipped_by_status、channel_daily_remaining、estimated_days、sample_confirmed、large_audience_warning、content_rules_breakdown（每条规则的命中人数、附件、has_sample）和 unmatched_recipients，必须全部展示给用户，并标出 has_sample=false 的规则；notices 里的文字（大量收件人提示、缺样例原因）也必须原样展示。sample_confirmed=false 时不得进行第二步（服务端会拒绝为 INVALID_STATE），应先 edm_campaign_preview。第二步返回 { status }。`,
    schema: McpCampaignSendInput,
    handler: async ({ db, config }, args) => {
      const result = await sendCampaign(db, args.campaign_id, { send_at: args.send_at, confirm_token: args.confirm_token }, config);
      if ("requires_confirmation" in result) return { ...result, notices: sendNotices(result.summary) };
      return { status: result.status };
    }
  }),
  tool({
    name: "edm_campaign_pause",
    description: "暂停发送中的活动。返回 { status }。",
    schema: McpCampaignIdInput,
    handler: async ({ db }, args) => ({ status: (await pauseCampaign(db, args.campaign_id)).status })
  }),
  tool({
    name: "edm_campaign_resume",
    description: "恢复已暂停的活动。返回 { status }。",
    schema: McpCampaignIdInput,
    handler: async ({ db }, args) => ({ status: (await resumeCampaign(db, args.campaign_id)).status })
  }),
  tool({
    name: "edm_campaign_cancel",
    description: `取消活动（尚未发出的邮件不再发送）。${MCP_CONFIRM_SENTENCE}第一步返回 { requires_confirmation, confirm_token, summary }，第二步返回 { status }。`,
    schema: McpCampaignCancelInput,
    handler: async ({ db }, args) => {
      const result = await cancelCampaign(db, args.campaign_id, args.confirm_token);
      if ("requires_confirmation" in result) return result;
      return { status: result.status };
    }
  }),
  tool({
    name: "edm_campaign_stats",
    description: "活动统计（§10.3 口径，排除试发）。打开率受邮件客户端隐私保护与图片代理影响，展示时请带上返回的 open_rate_note。",
    schema: McpCampaignIdInput,
    handler: async ({ db }, args) => ({ ...(await getCampaignStats(db, args.campaign_id)), open_rate_note: OPEN_RATE_DISCLAIMER })
  })
];

// --- 联系人 / 导入 ----------------------------------------------------------

const contactTools = [
  tool({
    name: "edm_contact_search",
    description: "按 ContactFilter 分页搜索联系人（含 tags）。",
    schema: McpContactSearchInput,
    handler: async ({ db }, args) => {
      const page = parsePagination(args);
      const { items, total } = await searchContacts(db, args.filter, page);
      return toPage(items, total, page);
    }
  }),
  tool({
    name: "edm_contact_import",
    description: "导入联系人（第一步，预览，不写通讯录）：filename（.xlsx / .csv）+ file_base64（解码后不超过服务端 MAX_IMPORT_FILE_MB）+ 可选 field_mapping。返回 { batch_id, field_mapping, report }；确认问题行后用 edm_contact_import_commit 提交。",
    schema: McpContactImportInput,
    handler: async ({ db, config }, args) => {
      const buffer = decodeBase64(args.file_base64, config.MAX_IMPORT_FILE_MB * 1024 * 1024, () => Errors.limitExceeded("导入文件超过大小限制"));
      return createImport(db, { filename: args.filename, buffer, field_mapping: args.field_mapping, max_rows: config.MAX_IMPORT_ROWS });
    }
  }),
  tool({
    name: "edm_contact_import_commit",
    description: `提交导入批次。${MCP_CONFIRM_SENTENCE}第一步返回 { requires_confirmation, confirm_token, summary }，第二步返回 { created, updated, skipped }。tag_names 为导入联系人要打上的标签名（不存在则创建）。`,
    schema: McpContactImportCommitInput,
    handler: async ({ db }, args) => {
      // SPEC-GAP: §9 入参是 tag_names，而 REST 的 commit 接收 tag_ids；这里按名称 find-or-create 后转成 ids（标签本身无副作用风险，创建发生在第一步）。
      const names = args.tag_names ?? [];
      const byName = await findOrCreateTags(db, names);
      const tag_ids = names.map((name) => byName.get(name)!).filter(Boolean);
      return commitImport(db, args.batch_id, parseOrThrow(ImportCommitBody, { dedup_strategy: args.dedup_strategy, tag_ids, confirm_token: args.confirm_token }));
    }
  }),
  tool({
    name: "edm_contact_update_status",
    description: `批量修改联系人状态（active / invalid / unsubscribed，一次最多 1000 个）。已退订（unsubscribed）的联系人不能改回 active（返回 INVALID_STATE）。${MCP_CONFIRM_SENTENCE}第一步返回 { requires_confirmation, confirm_token, summary }，第二步返回 { updated, unchanged }。`,
    schema: McpContactUpdateStatusInput,
    handler: async ({ db }, args) => updateContactStatus(db, parseOrThrow(ContactStatusBody, args))
  })
];

// --- 附件资产 ---------------------------------------------------------------

const assetTools = [
  tool({
    name: "edm_asset_upload",
    description: "上传邮件附件资产：filename + file_base64（解码后 ≤ 5MB；更大的文件请让用户在网页「设置 → 附件」上传）。允许 pdf / docx / xlsx / pptx / csv / txt / png / jpg / jpeg，类型与大小校验与网页上传一致。返回 { asset_id, filename, mime_type, size_bytes, sha256 }，asset_id 可填入内容规则的 attachment_ids。",
    schema: McpAssetUploadInput,
    handler: async ({ db, config }, args) => {
      const buffer = decodeBase64(args.file_base64, MCP_ASSET_MAX_BYTES, () =>
        Errors.validation("附件解码后超过 5MB，请让用户在网页上传", { reason: "TOO_LARGE", max_bytes: MCP_ASSET_MAX_BYTES }));
      const asset = await createAsset(db, config, { filename: args.filename, buffer });
      return { asset_id: asset.id, filename: asset.filename, mime_type: asset.mime_type, size_bytes: asset.size_bytes, sha256: asset.sha256 };
    }
  }),
  tool({
    name: "edm_asset_list",
    description: "分页列出附件资产元数据（不含内容），可按 enabled 筛选。",
    schema: McpAssetListInput,
    handler: async ({ db }, args) => pageOf(await listAssets(db, { enabled: args.enabled }), args)
  }),
  tool({
    name: "edm_asset_disable",
    description: "停用附件资产（只阻止之后的新引用；已有引用与已排队的邮件不受影响）。返回更新后的元数据。",
    schema: McpAssetDisableInput,
    handler: async ({ db }, args) => disableAsset(db, args.asset_id)
  })
];

// --- 回函 -------------------------------------------------------------------

const replyTools = [
  tool({
    name: "edm_reply_list",
    description: "分页列出回函（不含 body_text），可按 campaign_id、category、intent、handled、needs_review 筛选。",
    schema: McpReplyListInput,
    handler: async ({ db }, args) =>
      listReplies(db, stripUndefined({
        ...args,
        handled: args.handled === undefined ? undefined : String(args.handled),
        needs_review: args.needs_review === undefined ? undefined : String(args.needs_review)
      }))
  }),
  tool({
    name: "edm_reply_get",
    description: "读取回函完整记录（含 body_text）。",
    schema: McpReplyGetInput,
    handler: async ({ db }, args) => getReply(db, args.reply_id)
  }),
  tool({
    name: "edm_reply_update",
    description: "纠正回函分类：category / intent / handled。改为 category='bounce' 时必须同时提供 reason_code，服务端会对联系人生效退信影响（同一封邮件已生效过则不重复计数）。返回更新后的记录。",
    schema: McpReplyUpdateInput,
    handler: async ({ db }, args) => {
      const { reply_id, ...patch } = args;
      return updateReply(db, reply_id, parseOrThrow(ReplyPatchBody, patch));
    }
  })
];

export const MCP_TOOLS: McpTool[] = [...campaignTools, ...contactTools, ...assetTools, ...replyTools];
