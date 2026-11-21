/**
 * §9 MCP 工具入参 schema（T12）。服务端把它们转成 JSON Schema 作为 `inputSchema`，
 * 业务校验仍由各 REST 共用的 DTO（CampaignBody / ContactStatusBody / ImportCommitBody 等）完成。
 */
import { z } from "zod";
import { ContactFilter } from "../contact-filter.ts";
import {
  CampaignStatusSchema,
  DedupStrategySchema,
  InboundCategorySchema,
  ReasonCodeSchema,
  ReplyIntentSchema
} from "../enums.ts";
import { CampaignBody, CampaignPreviewBody } from "./campaigns.ts";
import { IsoDateTime, PAGE_SIZE_MAX } from "./common.ts";
import { FieldMapping } from "./imports.ts";
import { MANUAL_STATUS_VALUES } from "./contacts.ts";

/** §9 全部工具名（`edm_xxx_yyy`，A4：不含点号）。 */
export const MCP_TOOL_NAMES = [
  "edm_campaign_create",
  "edm_campaign_update",
  "edm_campaign_get",
  "edm_campaign_list",
  "edm_campaign_preview",
  "edm_campaign_send",
  "edm_campaign_pause",
  "edm_campaign_resume",
  "edm_campaign_cancel",
  "edm_campaign_stats",
  "edm_contact_search",
  "edm_asset_upload",
  "edm_asset_list",
  "edm_asset_disable",
  "edm_contact_import",
  "edm_contact_import_commit",
  "edm_contact_update_status",
  "edm_reply_list",
  "edm_reply_get",
  "edm_reply_update"
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** `edm_asset_upload` 解码后上限（§9）。 */
export const MCP_ASSET_MAX_BYTES = 5 * 1024 * 1024;
/** `edm_campaign_preview` 返回的 text 截断长度（§9）。 */
export const MCP_PREVIEW_TEXT_MAX_CHARS = 3000;

const id = z.uuid();
const page = z.coerce.number().int().min(1).optional();
const pageSize = z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).optional();
const confirmToken = z.string().min(1).optional();

// create / update 共用的活动字段（不含 editor_mode；MCP 创建的活动固定为 html 模式）
const { editor_mode: _editorMode, html: _html, ...campaignFields } = CampaignBody.shape;

/** html 与 template_id 二选一必填由服务端检查（模板的 html 作为正文）。 */
export const McpCampaignCreateInput = z.object({
  ...campaignFields,
  html: z.string().optional()
});
export type McpCampaignCreateInput = z.input<typeof McpCampaignCreateInput>;

export const McpCampaignUpdateInput = z.object({
  campaign_id: id,
  ...z.object({ ...campaignFields, html: z.string() }).partial().shape
});

export const McpCampaignIdInput = z.object({ campaign_id: id });

export const McpCampaignListInput = z.object({
  status: CampaignStatusSchema.optional(),
  created_from: IsoDateTime.optional(),
  created_to: IsoDateTime.optional(),
  page,
  page_size: pageSize
}).refine((input) => !input.created_from || !input.created_to || new Date(input.created_from) <= new Date(input.created_to), {
  path: ["created_from"],
  message: "created_from 不能晚于 created_to"
});
export type McpCampaignListInput = z.infer<typeof McpCampaignListInput>;

export const McpCampaignPreviewInput = z.object({ campaign_id: id, ...CampaignPreviewBody.shape });

export const McpCampaignSendInput = z.object({
  campaign_id: id,
  send_at: IsoDateTime.optional(),
  confirm_token: confirmToken
});

export const McpCampaignCancelInput = z.object({ campaign_id: id, confirm_token: confirmToken });

export const McpContactSearchInput = z.object({ filter: ContactFilter.default({ statuses: ["active"], exclude_domain_suspect: false }), page, page_size: pageSize });

export const McpAssetUploadInput = z.object({
  filename: z.string().min(1),
  file_base64: z.string().min(1)
});

export const McpAssetListInput = z.object({ enabled: z.boolean().optional(), page, page_size: pageSize });
export const McpAssetDisableInput = z.object({ asset_id: id });

export const McpContactImportInput = z.object({
  filename: z.string().min(1),
  file_base64: z.string().min(1),
  field_mapping: FieldMapping.optional()
});

export const McpContactImportCommitInput = z.object({
  batch_id: id,
  dedup_strategy: DedupStrategySchema,
  tag_names: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  confirm_token: confirmToken
});

export const McpContactUpdateStatusInput = z.object({
  contact_ids: z.array(id).min(1).max(1000),
  status: z.enum(MANUAL_STATUS_VALUES),
  reason: z.string().trim().min(1).max(200).optional(),
  confirm_token: confirmToken
});

export const McpReplyListInput = z.object({
  campaign_id: id.optional(),
  category: InboundCategorySchema.optional(),
  intent: ReplyIntentSchema.optional(),
  handled: z.boolean().optional(),
  needs_review: z.boolean().optional(),
  page,
  page_size: pageSize
});

export const McpReplyGetInput = z.object({ reply_id: id });

export const McpReplyUpdateInput = z.object({
  reply_id: id,
  category: InboundCategorySchema.optional(),
  intent: ReplyIntentSchema.nullable().optional(),
  handled: z.boolean().optional(),
  reason_code: ReasonCodeSchema.optional()
});
