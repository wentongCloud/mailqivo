/**
 * 规格 §4 与 §3 DDL 中所有枚举的唯一出处。
 *
 * 约定：每个枚举导出三样东西
 *   - `XXX_VALUES`：只读元组，供 DB CHECK 约束、zod、UI 下拉使用
 *   - `XxxSchema`：zod 枚举
 *   - `type Xxx`：TS 联合类型
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// §4.1 ReasonCode（失败与退信原因，唯一分类体系）
// ---------------------------------------------------------------------------

export const BOUNCE_TYPE_VALUES = ["hard", "soft", "policy"] as const;
export const BounceTypeSchema = z.enum(BOUNCE_TYPE_VALUES);
export type BounceType = z.infer<typeof BounceTypeSchema>;

export const REASON_CODE_VALUES = [
  "ADDR_NOT_EXIST",
  "ADDR_DOMAIN_INVALID",
  "ADDR_DISABLED",
  "TEMP_MAILBOX_FULL",
  "TEMP_SERVER_BUSY",
  "POLICY_SPAM",
  "POLICY_CONTENT",
  "SENDER_RATE_LIMIT",
  "SENDER_AUTH",
  "UNKNOWN"
] as const;
export const ReasonCodeSchema = z.enum(REASON_CODE_VALUES);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

export type ReasonCodeMeta = {
  /** `null` 表示表中的“—”（发送方问题，不属于退信类型） */
  bounceType: BounceType | null;
  /** 一级分类（UI 显示） */
  category: string;
  /** 二级标签（UI 显示） */
  label: string;
};

/** §4.1 表格：bounce_type 与默认 locale（en-GB）显示文案。本地化展示用 `reasonCodeDisplay`。 */
export const REASON_CODE_META: Record<ReasonCode, ReasonCodeMeta> = {
  ADDR_NOT_EXIST: { bounceType: "hard", category: "Address", label: "Mailbox does not exist" },
  ADDR_DOMAIN_INVALID: { bounceType: "hard", category: "Address", label: "Invalid domain" },
  ADDR_DISABLED: { bounceType: "hard", category: "Address", label: "Mailbox disabled" },
  TEMP_MAILBOX_FULL: { bounceType: "soft", category: "Temporary", label: "Mailbox full" },
  TEMP_SERVER_BUSY: { bounceType: "soft", category: "Temporary", label: "Recipient server busy" },
  POLICY_SPAM: { bounceType: "policy", category: "Recipient policy", label: "Rejected as spam" },
  POLICY_CONTENT: { bounceType: "policy", category: "Recipient policy", label: "Content or size rejected" },
  SENDER_RATE_LIMIT: { bounceType: null, category: "Sender", label: "Rate limited" },
  SENDER_AUTH: { bounceType: null, category: "Sender", label: "Authentication failed" },
  UNKNOWN: { bounceType: "soft", category: "Other", label: "Other" }
};

/** contacts.invalid_reason 的取值之一（§3、§4.1） */
export const SOFT_BOUNCE_REPEATED = "SOFT_BOUNCE_REPEATED" as const;
/** soft_bounce_streak 达到该值时联系人变为 invalid（§4.1） */
export const SOFT_BOUNCE_STREAK_LIMIT = 3;

// ---------------------------------------------------------------------------
// §4.3 其他枚举
// ---------------------------------------------------------------------------

export const SKIP_REASON_VALUES = [
  "CONTACT_INVALID",
  "CONTACT_BOUNCED",
  "CONTACT_UNSUBSCRIBED",
  "MISSING_VAR",
  "AI_FAILED",
  "CAMPAIGN_CANCELLED",
  "ATTACHMENT_UNAVAILABLE" // V1.1：§6.3 附件缺失或 sha256 不符
] as const;
export const SkipReasonSchema = z.enum(SKIP_REASON_VALUES);
export type SkipReason = z.infer<typeof SkipReasonSchema>;
/** 跳过原因默认 locale（en-GB）文案；本地化用 `skipReasonLabelI18n`。 */
export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  CONTACT_INVALID: "Contact invalid",
  CONTACT_BOUNCED: "Contact bounced",
  CONTACT_UNSUBSCRIBED: "Contact unsubscribed",
  MISSING_VAR: "Missing variable",
  AI_FAILED: "AI generation failed",
  CAMPAIGN_CANCELLED: "Campaign cancelled",
  ATTACHMENT_UNAVAILABLE: "Attachment unavailable"
};
export const skipReasonLabel = (reason: string) => (SKIP_REASON_LABEL as Record<string, string>)[reason] ?? reason;

export const IMPORT_ISSUE_VALUES = [
  "EMAIL_EMPTY",
  "EMAIL_INVALID",
  "DUPLICATE_IN_FILE",
  "EXISTS_IN_DB"
] as const;
export const ImportIssueSchema = z.enum(IMPORT_ISSUE_VALUES);
export type ImportIssue = z.infer<typeof ImportIssueSchema>;

export const ERROR_CODE_VALUES = [
  "VALIDATION",
  "NOT_FOUND",
  "INVALID_STATE",
  "CONFIRM_REQUIRED",
  "CONFIRM_INVALID",
  "LIMIT_EXCEEDED",
  "NO_UNSUBSCRIBE_LINK",
  "CHANNEL_ERROR",
  "AI_DISABLED",
  "UNAUTHORIZED",
  /** 未预期异常（HTTP 500）；规格 §4.3 补齐。 */
  "INTERNAL"
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODE_VALUES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

// ---------------------------------------------------------------------------
// §3 DDL 中 text + CHECK 的枚举（取值与 DDL 逐字一致）
// ---------------------------------------------------------------------------

/** import_batches.status */
export const IMPORT_BATCH_STATUS_VALUES = ["previewed", "committed", "discarded"] as const;
export const ImportBatchStatusSchema = z.enum(IMPORT_BATCH_STATUS_VALUES);
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>;

/** import_batches.dedup_strategy */
export const DEDUP_STRATEGY_VALUES = ["skip", "overwrite", "merge_tags"] as const;
export const DedupStrategySchema = z.enum(DEDUP_STRATEGY_VALUES);
export type DedupStrategy = z.infer<typeof DedupStrategySchema>;

/** contacts.status */
export const CONTACT_STATUS_VALUES = ["active", "invalid", "bounced", "unsubscribed"] as const;
export const ContactStatusSchema = z.enum(CONTACT_STATUS_VALUES);
export type ContactStatus = z.infer<typeof ContactStatusSchema>;

/** contacts.source */
export const CONTACT_SOURCE_VALUES = ["import", "manual", "reply"] as const;
export const ContactSourceSchema = z.enum(CONTACT_SOURCE_VALUES);
export type ContactSource = z.infer<typeof ContactSourceSchema>;

/** contacts.consent_source（V1.1：来源登记，建行时写入，此后只读；不证明已同意） */
export const CONSENT_SOURCE_VALUES = ["import", "manual", "reply", "web_form", "other"] as const;
export const ConsentSourceSchema = z.enum(CONSENT_SOURCE_VALUES);
export type ConsentSource = z.infer<typeof ConsentSourceSchema>;

/** POST /api/contacts 允许调用方指定的 consent_source（§10.1） */
export const MANUAL_CONSENT_SOURCE_VALUES = ["manual", "web_form", "other"] as const;

/** templates.category */
export const TEMPLATE_CATEGORY_VALUES = ["launch", "invitation", "holiday", "other"] as const;
export const TemplateCategorySchema = z.enum(TEMPLATE_CATEGORY_VALUES);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

/** templates.editor_mode / campaigns.editor_mode（§11.3） */
export const EDITOR_MODE_VALUES = ["rich", "html"] as const;
export const EditorModeSchema = z.enum(EDITOR_MODE_VALUES);
export type EditorMode = z.infer<typeof EditorModeSchema>;

/** channels.type（本期只实现 smtp） */
/** 本期仅 SMTP；不提供类型选择。 */
export const CHANNEL_TYPE_VALUES = ["smtp"] as const;
export const ChannelTypeSchema = z.enum(CHANNEL_TYPE_VALUES);
export type ChannelType = z.infer<typeof ChannelTypeSchema>;

/** campaigns.status（§6.1） */
export const CAMPAIGN_STATUS_VALUES = [
  "draft",
  "scheduled",
  "preparing",
  "sending",
  "paused",
  "completed",
  "cancelled",
  "failed"
] as const;
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUS_VALUES);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

/** campaigns.pause_reason */
export const PAUSE_REASON_VALUES = ["MANUAL", "DAILY_LIMIT", "CHANNEL_ERROR"] as const;
export const PauseReasonSchema = z.enum(PAUSE_REASON_VALUES);
export type PauseReason = z.infer<typeof PauseReasonSchema>;

/** messages.status（§6.3） */
export const MESSAGE_STATUS_VALUES = [
  "pending_ai",
  "queued",
  "sending",
  "sent",
  "failed",
  "skipped",
  "unknown"
] as const;
export const MessageStatusSchema = z.enum(MESSAGE_STATUS_VALUES);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

/** tracking_events.type */
export const TRACKING_EVENT_TYPE_VALUES = ["open", "click"] as const;
export const TrackingEventTypeSchema = z.enum(TRACKING_EVENT_TYPE_VALUES);
export type TrackingEventType = z.infer<typeof TrackingEventTypeSchema>;

/** inbound_mails.category（§10.4） */
export const INBOUND_CATEGORY_VALUES = ["bounce", "auto_reply", "human", "unrelated"] as const;
export const InboundCategorySchema = z.enum(INBOUND_CATEGORY_VALUES);
export type InboundCategory = z.infer<typeof InboundCategorySchema>;

/** inbound_mails.match_method */
export const MATCH_METHOD_VALUES = ["header", "references", "sender_recent", "none"] as const;
export const MatchMethodSchema = z.enum(MATCH_METHOD_VALUES);
export type MatchMethod = z.infer<typeof MatchMethodSchema>;

/** inbound_mails.intent（§8.4） */
export const REPLY_INTENT_VALUES = [
  "interested",
  "inquiry",
  "reject",
  "complaint",
  "unsubscribe_request",
  "other"
] as const;
export const ReplyIntentSchema = z.enum(REPLY_INTENT_VALUES);
export type ReplyIntent = z.infer<typeof ReplyIntentSchema>;

/** confirm_tokens.action（§5.4）。DDL 中该列没有 CHECK，只有注释。 */
export const CONFIRM_ACTION_VALUES = [
  "campaign_send",
  "campaign_cancel",
  "contact_status",
  "contact_delete",
  "import_commit",
  "message_requeue_unknown",
  "app_update"
] as const;
export const ConfirmActionSchema = z.enum(CONFIRM_ACTION_VALUES);
export type ConfirmAction = z.infer<typeof ConfirmActionSchema>;

/** 服务端 ROLE 环境变量（§2.1） */
export const SERVER_ROLE_VALUES = ["all", "api", "worker"] as const;
export const ServerRoleSchema = z.enum(SERVER_ROLE_VALUES);
export type ServerRole = z.infer<typeof ServerRoleSchema>;
