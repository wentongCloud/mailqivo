/** T02 通讯录：联系人、标签相关的 REST 入参出参（§10.1）。 */
import { z } from "zod";
import { ContactFilter, type ContactFilterInput } from "../contact-filter.ts";
import { MANUAL_CONSENT_SOURCE_VALUES, type ConsentSource, type ContactStatus } from "../enums.ts";
import {
  CONSENT_AT_LABEL,
  CONSENT_SOURCE_COLUMN_LABEL,
  CONSENT_SOURCE_LABEL,
  CONTACT_STATUS_LABEL,
  consentSourceLabelI18n,
  invalidReasonLabelI18n
} from "../i18n/labels.ts";

// ---------------------------------------------------------------------------
// 展示用文案（前后端共用：导出 xlsx、状态 Badge；默认 en-GB，完整双语见 i18n）
// ---------------------------------------------------------------------------

export {
  CONSENT_AT_LABEL,
  CONSENT_SOURCE_COLUMN_LABEL,
  CONSENT_SOURCE_LABEL,
  CONTACT_STATUS_LABEL
};

/** contacts.invalid_reason → 说明文案（默认 en-GB）。 */
export function invalidReasonLabel(reason: string | null | undefined): string {
  return invalidReasonLabelI18n(reason);
}

/** consent_source → 文案（默认 en-GB）。 */
export function consentSourceLabel(value: string | null | undefined): string {
  return consentSourceLabelI18n(value);
}

// ---------------------------------------------------------------------------
// 联系人
// ---------------------------------------------------------------------------

/** 入库前 trim + lower（§3 约定），再校验格式。 */
export const EmailInput = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "邮箱格式不正确" }));

const optionalText = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const CustomFields = z.record(z.string().min(1).max(50), z.string().max(1000));

export const TagNameInput = z
  .string()
  .trim()
  .min(1, "标签名不能为空")
  .max(50, "标签名最长 50 个字符");

/**
 * POST：`consent_source` 可选（manual | web_form | other，缺省 manual）；`consent_at` 由服务端写入，
 * 请求体出现 `consent_at` → VALIDATION（§10.1）。其他未知字段维持原来的忽略行为。
 */
export const CreateContactBody = z.object({
  email: EmailInput,
  consent_source: z.enum(MANUAL_CONSENT_SOURCE_VALUES).optional(),
  consent_at: z.never({ message: "consent_at 由服务端写入，不能指定" }).optional(),
  name: optionalText,
  company: optionalText,
  title: optionalText,
  custom_fields: CustomFields.optional(),
  /** 标签名；不存在的标签会自动创建 */
  tags: z.array(TagNameInput).max(50).optional()
});
export type CreateContactBody = z.infer<typeof CreateContactBody>;

/**
 * PATCH：不允许改 status（strict：出现 status、source 等未知字段即 VALIDATION）。`tags` 为整体替换。
 * V1.1：`consent_at` / `consent_source` 建行后只读，出现（含显式 null）同样因 strict 返回 VALIDATION。
 */
export const UpdateContactBody = z.strictObject({
  email: EmailInput.optional(),
  name: optionalText,
  company: optionalText,
  title: optionalText,
  custom_fields: CustomFields.optional(),
  tags: z.array(TagNameInput).max(50).optional()
});
export type UpdateContactBody = z.infer<typeof UpdateContactBody>;

export type ContactDto = {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  title: string | null;
  custom_fields: Record<string, string>;
  status: ContactStatus;
  invalid_reason: string | null;
  domain_suspect: boolean;
  soft_bounce_streak: number;
  bounce_count: number;
  last_bounce_at: string | null;
  unsubscribed_at: string | null;
  source: "import" | "manual" | "reply";
  /** V1.1：来源登记时间（不证明已同意） */
  consent_at: string | null;
  /** V1.1：来源 */
  consent_source: ConsentSource | null;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
  /** 标签名 */
  tags: string[];
};

// ---------------------------------------------------------------------------
// 筛选的 query 字符串形式：ContactFilter 的展开
// ---------------------------------------------------------------------------

/**
 * SPEC-GAP: §10.1 只说“query 参数为 ContactFilter 的展开形式”。约定：数组字段用重复的 key
 * （`?tags_any=a&tags_any=b`，标签名中可以含逗号），布尔值用 `1` / `true`。
 */
export function contactFilterFromQuery(query: unknown): ContactFilter {
  const q = (query ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] | undefined => {
    if (v === undefined) return undefined;
    return (Array.isArray(v) ? v : [v]).map(String).filter((s) => s !== "");
  };
  const bool = (v: unknown): boolean | undefined =>
    v === undefined ? undefined : v === true || v === "1" || v === "true";
  const keyword = typeof q.keyword === "string" && q.keyword.trim() !== "" ? q.keyword.trim() : undefined;
  const industry = typeof q.industry === "string" && q.industry.trim() !== "" ? q.industry.trim() : undefined;
  return ContactFilter.parse({
    contact_ids: list(q.contact_ids),
    tags_any: list(q.tags_any),
    tags_all: list(q.tags_all),
    statuses: list(q.statuses),
    domains: list(q.domains),
    keyword,
    industry,
    import_batch_id: typeof q.import_batch_id === "string" && q.import_batch_id !== "" ? q.import_batch_id : undefined,
    exclude_domain_suspect: bool(q.exclude_domain_suspect),
    exclude_contact_ids: list(q.exclude_contact_ids),
    include_contact_ids: list(q.include_contact_ids)
  });
}

/** contactFilterFromQuery 的逆操作（前端用）。contact_ids 为空匹配零人，statuses 为空匹配全部状态；两者均须显式保留。*/
export function contactFilterToSearchParams(filter: ContactFilterInput): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of ["contact_ids", "tags_any", "tags_all", "statuses", "domains", "exclude_contact_ids", "include_contact_ids"] as const) {
    if ((key === "contact_ids" || key === "statuses") && filter[key]?.length === 0) params.set(key, "");
    for (const value of filter[key] ?? []) params.append(key, value);
  }
  if (filter.keyword) params.set("keyword", filter.keyword);
  if (filter.industry) params.set("industry", filter.industry);
  if (filter.import_batch_id) params.set("import_batch_id", filter.import_batch_id);
  if (filter.exclude_domain_suspect) params.set("exclude_domain_suspect", "1");
  return params;
}

// ---------------------------------------------------------------------------
// 批量操作
// ---------------------------------------------------------------------------

export const ContactTagsBody = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(10000),
  add: z.array(TagNameInput).max(50).optional(),
  remove: z.array(TagNameInput).max(50).optional()
});
export type ContactTagsBody = z.infer<typeof ContactTagsBody>;

export type ContactTagsResult = { matched: number; added: number; removed: number };

/** 手动可设置的状态：`bounced` 只能由退信流程设置。 */
export const MANUAL_STATUS_VALUES = ["active", "invalid", "unsubscribed"] as const;

export const ContactStatusBody = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(1000),
  status: z.enum(MANUAL_STATUS_VALUES),
  reason: z.string().trim().min(1).max(200).optional(),
  confirm_token: z.string().min(1).optional()
});
export type ContactStatusBody = z.infer<typeof ContactStatusBody>;

export type ContactStatusSummary = {
  status: (typeof MANUAL_STATUS_VALUES)[number];
  reason: string | null;
  total: number;
  will_change: number;
  unchanged: number;
  by_current_status: Record<ContactStatus, number>;
};

export type ContactStatusResult = { updated: number; unchanged: number };

/** 批量删除。不带 confirm_token 只返回摘要；带上后才删除。 */
export const ContactDeleteBody = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(1000),
  confirm_token: z.string().min(1).optional()
});
export type ContactDeleteBody = z.infer<typeof ContactDeleteBody>;

export type ContactDeleteSummary = { total: number; sample: string[] };
export type ContactDeleteResult = { deleted: number };

/** 批量设置语言偏好。空字符串表示清除。 */
export const CONTACT_LANGUAGE_VALUES = ["", "中文", "English"] as const;

export const ContactLanguageBody = z.object({
  contact_ids: z.array(z.string().uuid()).min(1).max(1000),
  language: z.enum(CONTACT_LANGUAGE_VALUES)
});
export type ContactLanguageBody = z.infer<typeof ContactLanguageBody>;
export type ContactLanguageResult = { updated: number };

// ---------------------------------------------------------------------------
// 标签
// ---------------------------------------------------------------------------

export const TagBody = z.object({ name: TagNameInput });
export type TagBody = z.infer<typeof TagBody>;

export type TagDto = { id: string; name: string; contact_count: number };
