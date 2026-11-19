/** T06 邮件活动、发送确认与试发。 */
import { z } from "zod";
import { ContactFilter } from "../contact-filter.ts";
import { CAMPAIGN_STATUS_VALUES, EDITOR_MODE_VALUES, PAUSE_REASON_VALUES } from "../enums.ts";
import { EmailInput } from "./contacts.ts";
import { IsoDateTime } from "./common.ts";

const nullableId = z.string().uuid().nullable().default(null);

export const AiBlock = z.object({
  key: z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N}_]+$/u, "只能包含文字、数字和下划线"),
  instruction: z.string().trim().min(1).max(2000),
  max_chars: z.coerce.number().int().min(1).max(2000)
});
export type AiBlock = z.infer<typeof AiBlock>;

/** §8.2 内容规则单项上限。 */
export const CONTENT_RULE_LIMITS = { rules: 50, tags_all: 20, instruction: 4000, attachments: 10 } as const;

/**
 * §8.2 内容规则（V1.1）请求形态：`id` 可选——带已有 id 的保留，不带的视为新增，缺席的视为删除。
 * 服务端校验与 id 处理唯一实现在 `modules/campaigns/content-rules.ts`。
 */
export const ContentRuleInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200),
  tags_all: z.array(z.string().trim().min(1).max(100)).max(CONTENT_RULE_LIMITS.tags_all).default([]),
  /** 空字符串表示不限行业。有值时还须与联系人 custom_fields.industry 一致。 */
  industry: z.string().trim().max(100).optional().default(""),
  instruction: z.string().trim().max(CONTENT_RULE_LIMITS.instruction).default(""),
  attachment_ids: z.array(z.string().uuid()).max(CONTENT_RULE_LIMITS.attachments).default([]),
  priority: z.coerce.number().int().min(-1_000_000).max(1_000_000),
  enabled: z.boolean().default(true)
});
export type ContentRuleInput = z.input<typeof ContentRuleInput>;

/** 已保存的内容规则（id 由服务端生成）。 */
export type ContentRule = {
  id: string;
  name: string;
  tags_all: string[];
  /** 空或省略表示不限行业。 */
  industry?: string;
  instruction: string;
  attachment_ids: string[];
  priority: number;
  enabled: boolean;
};

/** §6.1 / §6.3 messages.content_rule_snapshot。 */
export type ContentRuleSnapshot = {
  id: string;
  name: string;
  tags_all: string[];
  instruction: string;
  matched_tags: string[];
};

export const CampaignBody = z.object({
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(100),
  html: z.string(),
  editor_mode: z.enum(EDITOR_MODE_VALUES).default("rich"),
  template_id: nullableId,
  signature_id: nullableId,
  channel_id: nullableId,
  contact_filter: ContactFilter.default({ statuses: ["active"], exclude_domain_suspect: false }),
  ai_goal: z.string().max(4000).nullable().default(null),
  ai_fields: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  ai_blocks: z.array(AiBlock).max(20).default([]),
  track_opens: z.boolean().default(true),
  track_clicks: z.boolean().default(false),
  content_rules: z.array(ContentRuleInput).max(CONTENT_RULE_LIMITS.rules).default([]),
  /**
   * §11.4 Step 1 时间计划：null=立即发送；非 null 为草稿中的定时意图（确认发送前 status 仍为 draft）。
   * 服务端写入时：非法时间 VALIDATION；已过期则清为 null，避免草稿自动保存被卡住。
   */
  send_at: IsoDateTime.nullable().default(null)
});
export type CampaignBody = z.infer<typeof CampaignBody>;

export type CampaignDto = Omit<CampaignBody, "content_rules"> & {
  content_rules: ContentRule[];
  id: string;
  status: (typeof CAMPAIGN_STATUS_VALUES)[number];
  pause_reason: (typeof PAUSE_REASON_VALUES)[number] | null;
  fail_reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignListDto = CampaignDto & {
  metrics: { total: number; sent: number; failed: number; bounced: number; opened: number };
};

export type CampaignSendSummary = {
  recipients: number;
  skipped_by_status: Record<string, number>;
  /** 通道当日剩余额度；`daily_limit=0`（无日限）时为 `-1`。 */
  channel_daily_remaining: number;
  estimated_days: number;
  ai_blocks: string[];
  sample_confirmed: boolean;
  /** §6.2 V1.1：threshold>0 且 recipients>=threshold；只做提示、不阻止发送。 */
  large_audience_warning: boolean;
  /** §6.2 第 6 步（V1.1）：每条启用规则本次命中的收件人数与附件；参与 summary_hash。 */
  content_rules_breakdown: ContentRuleBreakdownItem[];
  /** 未命中任何启用规则的 active 收件人数。 */
  unmatched_recipients: number;
};

export type ContentRuleBreakdownItem = {
  rule_id: string;
  name: string;
  recipients: number;
  attachments: { asset_id: string; filename: string; size_bytes: number }[];
  /**
   * §6.2 第 6 步：该规则是否已有至少 1 位命中收件人的有效 AI 样例（§6.2 第 6 步）；无 ai_blocks 时恒 true。
   * UI 与 MCP 据此标出“未预览”的规则。
   */
  has_sample: boolean;
};

/** §6.2 固定文案：`large_audience_warning=true` 时 UI 与 MCP 必须展示（默认 en-GB）。 */
export { LARGE_AUDIENCE_WARNING_TEXT } from "../i18n/labels.ts";

/** §6.3「unknown 人工回收」请求体。 */
export const RequeueUnknownBody = z.object({
  message_ids: z.array(z.string().uuid()).min(1).max(500).optional(),
  confirm_token: z.string().optional()
});
export type RequeueUnknownBody = z.infer<typeof RequeueUnknownBody>;
export type RequeueUnknownSummary = { unknown_count: number; message_ids_hash: string; message_ids_sample: string[] };
export type RequeueUnknownResult = { requeued: number };

export const CampaignSendBody = z.object({
  send_at: IsoDateTime.optional(),
  confirm_token: z.string().optional()
});
export type CampaignSendBody = z.infer<typeof CampaignSendBody>;

export const CampaignConfirmBody = z.object({ confirm_token: z.string().optional() });
export type CampaignConfirmBody = z.infer<typeof CampaignConfirmBody>;

export const CampaignTestSendBody = z.object({
  emails: z.array(EmailInput).min(1).max(5),
  contact_id: z.string().uuid().optional()
});
export type CampaignTestSendBody = z.infer<typeof CampaignTestSendBody>;

export type CampaignTestSendResult = {
  items: { id: string; email: string; ok: boolean; code?: number; response: string }[];
};

export { CAMPAIGN_STATUS_LABEL, campaignStatusLabel } from "../i18n/labels.ts";

/** §8.3 `POST /api/campaigns/:id/preview` 请求体。 */
export const CampaignPreviewBody = z.object({
  /** Generate examples for contacts whose winning content rule is this saved rule. */
  rule_id: z.string().uuid().optional(),
  contact_ids: z.array(z.string().uuid()).min(1).max(5).optional(),
  // SPEC-GAP: §8.3 只给了 sample 默认 3；上限与 contact_ids 一致取 5。
  sample: z.coerce.number().int().min(1).max(5).default(3)
}).refine((body) => !body.rule_id || !body.contact_ids, { message: "Select a rule or explicit contacts", path: ["rule_id"] });
export type CampaignPreviewBody = z.infer<typeof CampaignPreviewBody>;

/** §8.3 预览返回项（后三项 V1.1；附件只有元数据，不含内容）。 */
export type CampaignPreviewItem = {
  contact: { id: string; email: string; name: string | null; company: string | null };
  subject: string;
  html: string;
  text: string;
  ai_content: Record<string, string>;
  warnings: string[];
  content_rule: { id: string; name: string } | null;
  matched_tags: string[];
  attachments: { asset_id: string; filename: string; mime_type: string; size_bytes: number; sha256: string }[];
};

/** §11.4 预览卡片固定提示（默认 en-GB）。 */
export { AI_PREVIEW_NOTICE } from "../i18n/labels.ts";
