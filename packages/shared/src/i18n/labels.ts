import type {
  CampaignStatus,
  ConsentSource,
  ContactStatus,
  ImportIssue,
  ReasonCode,
  SkipReason
} from "../enums.ts";
import { REASON_CODE_VALUES, SOFT_BOUNCE_REPEATED } from "../enums.ts";
import { DEFAULT_LOCALE, type AppLocale } from "./locale.ts";

type L<T extends string> = Record<AppLocale, Record<T, string>>;

function pick<T extends string>(dict: L<T>, key: T, locale: AppLocale = DEFAULT_LOCALE): string {
  return dict[locale][key] ?? dict[DEFAULT_LOCALE][key];
}

const CONTACT_STATUS: L<ContactStatus> = {
  "en-GB": { active: "Active", invalid: "Invalid", bounced: "Bounced", unsubscribed: "Unsubscribed" },
  "zh-CN": { active: "正常", invalid: "无效", bounced: "退信", unsubscribed: "退订" }
};

const CONSENT_SOURCE: L<ConsentSource> = {
  "en-GB": { import: "Import", manual: "Manual", reply: "Reply", web_form: "Web form", other: "Other" },
  "zh-CN": { import: "导入", manual: "手动", reply: "回函", web_form: "网页表单", other: "其他" }
};

const CAMPAIGN_STATUS: L<CampaignStatus> = {
  "en-GB": {
    draft: "Draft",
    scheduled: "Scheduled",
    preparing: "Preparing",
    sending: "Sending",
    paused: "Paused",
    completed: "Completed",
    cancelled: "Cancelled",
    failed: "Failed"
  },
  "zh-CN": {
    draft: "草稿",
    scheduled: "已定时",
    preparing: "准备中",
    sending: "发送中",
    paused: "已暂停",
    completed: "已完成",
    cancelled: "已取消",
    failed: "失败"
  }
};

const SKIP_REASON: L<SkipReason> = {
  "en-GB": {
    CONTACT_INVALID: "Contact invalid",
    CONTACT_BOUNCED: "Contact bounced",
    CONTACT_UNSUBSCRIBED: "Contact unsubscribed",
    MISSING_VAR: "Missing variable",
    AI_FAILED: "AI generation failed",
    CAMPAIGN_CANCELLED: "Campaign cancelled",
    ATTACHMENT_UNAVAILABLE: "Attachment unavailable"
  },
  "zh-CN": {
    CONTACT_INVALID: "联系人无效",
    CONTACT_BOUNCED: "联系人已退信",
    CONTACT_UNSUBSCRIBED: "联系人已退订",
    MISSING_VAR: "缺少变量",
    AI_FAILED: "AI 生成失败",
    CAMPAIGN_CANCELLED: "活动已取消",
    ATTACHMENT_UNAVAILABLE: "附件不可用"
  }
};

const IMPORT_ISSUE: L<ImportIssue> = {
  "en-GB": {
    EMAIL_EMPTY: "Email empty",
    EMAIL_INVALID: "Invalid email format",
    DUPLICATE_IN_FILE: "Duplicate in file",
    EXISTS_IN_DB: "Already in contacts"
  },
  "zh-CN": {
    EMAIL_EMPTY: "邮箱为空",
    EMAIL_INVALID: "邮箱格式不正确",
    DUPLICATE_IN_FILE: "文件内重复",
    EXISTS_IN_DB: "通讯录已存在"
  }
};

const IMPORT_FIELD: L<"email" | "name" | "company" | "title" | "ignore"> = {
  "en-GB": { email: "Email", name: "Name", company: "Company", title: "Title", ignore: "Ignore column" },
  "zh-CN": { email: "邮箱", name: "姓名", company: "公司", title: "职位", ignore: "忽略此列" }
};

const TEMPLATE_CATEGORY: L<"launch" | "invitation" | "holiday" | "other"> = {
  "en-GB": { launch: "Product launch", invitation: "Event invitation", holiday: "Holiday greeting", other: "Other" },
  "zh-CN": { launch: "产品发布", invitation: "活动邀请", holiday: "节日问候", other: "其他" }
};

const REASON_META: Record<
  AppLocale,
  Record<ReasonCode, { category: string; label: string }>
> = {
  "en-GB": {
    ADDR_NOT_EXIST: { category: "Address", label: "Mailbox does not exist" },
    ADDR_DOMAIN_INVALID: { category: "Address", label: "Invalid domain" },
    ADDR_DISABLED: { category: "Address", label: "Mailbox disabled" },
    TEMP_MAILBOX_FULL: { category: "Temporary", label: "Mailbox full" },
    TEMP_SERVER_BUSY: { category: "Temporary", label: "Recipient server busy" },
    POLICY_SPAM: { category: "Recipient policy", label: "Rejected as spam" },
    POLICY_CONTENT: { category: "Recipient policy", label: "Content or size rejected" },
    SENDER_RATE_LIMIT: { category: "Sender", label: "Rate limited" },
    SENDER_AUTH: { category: "Sender", label: "Authentication failed" },
    UNKNOWN: { category: "Other", label: "Other" }
  },
  "zh-CN": {
    ADDR_NOT_EXIST: { category: "地址问题", label: "邮箱不存在" },
    ADDR_DOMAIN_INVALID: { category: "地址问题", label: "域名无效" },
    ADDR_DISABLED: { category: "地址问题", label: "邮箱已停用" },
    TEMP_MAILBOX_FULL: { category: "临时性失败", label: "邮箱已满" },
    TEMP_SERVER_BUSY: { category: "临时性失败", label: "对方服务器繁忙" },
    POLICY_SPAM: { category: "接收方策略", label: "被反垃圾拒绝" },
    POLICY_CONTENT: { category: "接收方策略", label: "内容或大小被拒" },
    SENDER_RATE_LIMIT: { category: "发送方问题", label: "发件限流" },
    SENDER_AUTH: { category: "发送方问题", label: "认证失败" },
    UNKNOWN: { category: "其他", label: "其他" }
  }
};

const COMMON: L<
  | "consentAt"
  | "consentSourceColumn"
  | "softBounceRepeated"
  | "largeAudienceWarning"
  | "aiPreviewNotice"
  | "openRateDisclaimer"
  | "yes"
  | "exportEmail"
  | "exportName"
  | "exportCompany"
  | "exportTitle"
  | "exportTags"
  | "exportStatus"
  | "exportReason"
  | "exportDomainSuspect"
  | "exportSource"
  | "exportCreatedAt"
  | "sheetContacts"
> = {
  "en-GB": {
    consentAt: "Source registered at",
    consentSourceColumn: "Source",
    softBounceRepeated: "Repeated soft bounces",
    largeAudienceWarning:
      "Large recipient list: preparation will enqueue everyone, which may take time and disk space.",
    aiPreviewNotice: "AI-generated — please verify facts",
    openRateDisclaimer:
      "Open rate is affected by client privacy and image proxies; treat as a lower-bound estimate.",
    yes: "Yes",
    exportEmail: "Email",
    exportName: "Name",
    exportCompany: "Company",
    exportTitle: "Title",
    exportTags: "Tags",
    exportStatus: "Status",
    exportReason: "Reason",
    exportDomainSuspect: "Domain suspect",
    exportSource: "Created via",
    exportCreatedAt: "Created at",
    sheetContacts: "Contacts"
  },
  "zh-CN": {
    consentAt: "来源登记时间",
    consentSourceColumn: "来源",
    softBounceRepeated: "连续软退信",
    largeAudienceWarning: "收件人较多，准备阶段将写入全量队列，耗时与磁盘占用会上升。",
    aiPreviewNotice: "AI 生成，请核对事实",
    openRateDisclaimer: "打开率受邮件客户端隐私保护与图片代理影响，仅供参考。",
    yes: "是",
    exportEmail: "邮箱",
    exportName: "姓名",
    exportCompany: "公司",
    exportTitle: "职位",
    exportTags: "标签",
    exportStatus: "状态",
    exportReason: "原因",
    exportDomainSuspect: "域名可疑",
    exportSource: "创建方式",
    exportCreatedAt: "创建时间",
    sheetContacts: "通讯录"
  }
};

export function contactStatusLabel(status: ContactStatus, locale: AppLocale = DEFAULT_LOCALE) {
  return pick(CONTACT_STATUS, status, locale);
}

export function consentSourceLabelI18n(value: string | null | undefined, locale: AppLocale = DEFAULT_LOCALE) {
  if (!value) return "";
  const map = CONSENT_SOURCE[locale] as Record<string, string>;
  return map[value] ?? (CONSENT_SOURCE[DEFAULT_LOCALE] as Record<string, string>)[value] ?? value;
}

export function campaignStatusLabel(status: CampaignStatus, locale: AppLocale = DEFAULT_LOCALE) {
  return pick(CAMPAIGN_STATUS, status, locale);
}

export function skipReasonLabelI18n(reason: string, locale: AppLocale = DEFAULT_LOCALE) {
  const map = SKIP_REASON[locale] as Record<string, string>;
  return map[reason] ?? (SKIP_REASON[DEFAULT_LOCALE] as Record<string, string>)[reason] ?? reason;
}

export function importIssueLabel(issue: ImportIssue, locale: AppLocale = DEFAULT_LOCALE) {
  return pick(IMPORT_ISSUE, issue, locale);
}

export function importFieldLabel(field: string, locale: AppLocale = DEFAULT_LOCALE): string {
  const map = IMPORT_FIELD[locale] as Record<string, string>;
  return map[field] ?? (IMPORT_FIELD[DEFAULT_LOCALE] as Record<string, string>)[field] ?? field;
}

export function templateCategoryLabel(
  category: "launch" | "invitation" | "holiday" | "other",
  locale: AppLocale = DEFAULT_LOCALE
) {
  return pick(TEMPLATE_CATEGORY, category, locale);
}

export function invalidReasonLabelI18n(reason: string | null | undefined, locale: AppLocale = DEFAULT_LOCALE) {
  if (!reason) return "";
  if (reason === SOFT_BOUNCE_REPEATED) return COMMON[locale].softBounceRepeated;
  if ((REASON_CODE_VALUES as readonly string[]).includes(reason)) {
    const meta = REASON_META[locale][reason as ReasonCode] ?? REASON_META[DEFAULT_LOCALE][reason as ReasonCode];
    return `${meta.category} · ${meta.label}`;
  }
  return reason;
}

export function reasonCodeDisplay(code: ReasonCode, locale: AppLocale = DEFAULT_LOCALE) {
  return REASON_META[locale][code] ?? REASON_META[DEFAULT_LOCALE][code];
}

export function commonLabel(
  key: keyof (typeof COMMON)[AppLocale],
  locale: AppLocale = DEFAULT_LOCALE
) {
  return COMMON[locale][key] ?? COMMON[DEFAULT_LOCALE][key];
}

/** Default-locale maps for gradual call-site migration (en-GB). */
export const CONTACT_STATUS_LABEL = CONTACT_STATUS[DEFAULT_LOCALE];
export const CONSENT_SOURCE_LABEL = CONSENT_SOURCE[DEFAULT_LOCALE];
export const CAMPAIGN_STATUS_LABEL = CAMPAIGN_STATUS[DEFAULT_LOCALE];
export const SKIP_REASON_LABEL = SKIP_REASON[DEFAULT_LOCALE];
export const IMPORT_ISSUE_LABEL = IMPORT_ISSUE[DEFAULT_LOCALE];
export const IMPORT_FIELD_LABEL = IMPORT_FIELD[DEFAULT_LOCALE] as Record<string, string>;
export const TEMPLATE_CATEGORY_LABEL = TEMPLATE_CATEGORY[DEFAULT_LOCALE];
export const CONSENT_AT_LABEL = COMMON[DEFAULT_LOCALE].consentAt;
export const CONSENT_SOURCE_COLUMN_LABEL = COMMON[DEFAULT_LOCALE].consentSourceColumn;
export const LARGE_AUDIENCE_WARNING_TEXT = COMMON[DEFAULT_LOCALE].largeAudienceWarning;
export const AI_PREVIEW_NOTICE = COMMON[DEFAULT_LOCALE].aiPreviewNotice;
export const OPEN_RATE_DISCLAIMER = COMMON[DEFAULT_LOCALE].openRateDisclaimer;

export function contactStatusLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return CONTACT_STATUS[locale];
}
export function campaignStatusLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return CAMPAIGN_STATUS[locale];
}
export function importIssueLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return IMPORT_ISSUE[locale];
}
export function importFieldLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return IMPORT_FIELD[locale] as Record<string, string>;
}
export function consentSourceLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return CONSENT_SOURCE[locale];
}
export function templateCategoryLabelMap(locale: AppLocale = DEFAULT_LOCALE) {
  return TEMPLATE_CATEGORY[locale];
}
