/** T04 模板、签名与合规设置（§5.5、§7、§10.1）。 */
import { z } from "zod";
import { EDITOR_MODE_VALUES, TEMPLATE_CATEGORY_VALUES } from "../enums.ts";

export const TemplateBody = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(TEMPLATE_CATEGORY_VALUES).default("other"),
  subject: z.string().trim().min(1).max(500),
  html: z.string(),
  editor_mode: z.enum(EDITOR_MODE_VALUES).default("rich")
});
export type TemplateBody = z.infer<typeof TemplateBody>;
export type TemplateDto = TemplateBody & { id: string; created_at: string; updated_at: string };

/** 规格 §7.2「模板导入诊断」：活动第三步套用模板时检查模板正文。 */
export const TemplateDiagnoseBody = z.object({
  /** 本次实际套用到草稿的模板正文；诊断按此正文进行，不重读数据库，避免与界面所见正文不一致。 */
  html: z.string(),
  /** 当前活动草稿的 AI 区块 key；`{{ai.x}}` / `{{ai_x}}` 引用这些区块时不算未知变量。 */
  ai_block_keys: z.array(z.string().trim().min(1)).max(50).default([])
});
export type TemplateDiagnoseBody = z.infer<typeof TemplateDiagnoseBody>;
export type TemplateIssue = { kind: "syntax"; fragment: string } | { kind: "unknown_variable"; key: string };
export type TemplateDiagnosis = { issues: TemplateIssue[] };

export const SignatureBody = z.object({
  name: z.string().trim().min(1).max(100),
  html: z.string(),
  is_default: z.boolean().default(false)
});
export type SignatureBody = z.infer<typeof SignatureBody>;
export type SignatureDto = SignatureBody & { id: string; created_at: string; updated_at: string };

/** §5.5 `prepare_warn_recipient_threshold`：整数 0–10000000，0 为关闭告警。 */
export const PrepareWarnRecipientThreshold = z.number().int().min(0).max(10_000_000);

/** §5.5 `attachment_max_total_mb`：整数 1–20，按 base64 编码后大小计算。 */
export const AttachmentMaxTotalMb = z.number().int().min(1).max(20);

/** PUT /api/settings 请求体：未知键 → VALIDATION（strict）。 */
export const SettingsBody = z.object({
  footer_html: z.string(),
  company_name: z.string().max(200),
  company_address: z.string().max(500),
  unsubscribe_page_text: z.string().max(2000),
  sensitive_words: z.array(z.string().trim().min(1).max(100)).max(500),
  machine_open_ua_patterns: z.array(z.string().trim().min(1).max(500)).max(100),
  prepare_warn_recipient_threshold: PrepareWarnRecipientThreshold,
  attachment_max_total_mb: AttachmentMaxTotalMb,
  /** UI locale; cookie `locale` mirrors this after login. */
  ui_locale: z.enum(["en-GB", "zh-CN"])
}).strict();
export type SettingsBody = z.infer<typeof SettingsBody>;
export type SettingsDto = SettingsBody;

export const DEFAULT_SETTINGS: SettingsDto = {
  footer_html:
    '<p style="font-size:12px;color:#888">{{公司名}} · {{公司地址}}<br>No longer want these emails? <a href="{{sys.unsubscribe_url}}">Unsubscribe</a></p>',
  company_name: "",
  company_address: "",
  unsubscribe_page_text: "After you confirm, you will no longer receive our marketing emails.",
  sensitive_words: [],
  machine_open_ua_patterns: ["bot", "crawler", "spider", "preview", "Barracuda", "Mimecast", "Proofpoint", "GoogleImageProxy\\b.*via ggpht"],
  prepare_warn_recipient_threshold: 5000,
  attachment_max_total_mb: 10,
  ui_locale: "en-GB"
};

export { TEMPLATE_CATEGORY_LABEL } from "../i18n/labels.ts";
