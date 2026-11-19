import { resolveSalutation, SALUTATION_KEY } from "./salutation.ts";

export type RenderContact = {
  email: string;
  name?: string | null;
  company?: string | null;
  title?: string | null;
  custom_fields?: Record<string, string>;
};

export type RenderContext = {
  contact: RenderContact;
  settings: { company_name: string; company_address: string };
  ai_content?: Record<string, string>;
  tracking_id: string;
  public_base_url?: string;
  unsubscribe_url: string;
};

export class MissingVarError extends Error {
  constructor(public readonly key: string) {
    super(`缺少模板变量：${key}`);
    this.name = "MissingVarError";
  }
}

export const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*)(?:\s*\|\s*([\s\S]*?))?\s*\}\}/gu;

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** 联系人内置字段的变量名（含中文别名）→ 联系人列。模板渲染与 AI 区块取字段共用。 */
export const CONTACT_FIELD_KEYS: Readonly<Record<string, "name" | "company" | "title" | "email">> = {
  姓名: "name", name: "name",
  公司: "company", company: "company",
  职位: "title", title: "title",
  邮箱: "email", email: "email"
};

const SYSTEM_KEYS = ["sys.unsubscribe_url", "unsubscribe_url", "公司名", "公司地址"] as const;

/** 不依赖自定义字段、总能解析的变量名（ai.* 另按区块校验）。发送前校验用。 */
export const BUILTIN_TEMPLATE_KEYS: ReadonlySet<string> = new Set([...SYSTEM_KEYS, ...Object.keys(CONTACT_FIELD_KEYS), SALUTATION_KEY]);

function valueForKey(key: string, context: RenderContext): string | undefined {
  if (key === "sys.unsubscribe_url" || key === "unsubscribe_url") {
    return context.unsubscribe_url;
  }
  if (key === "公司名") return context.settings.company_name;
  if (key === "公司地址") return context.settings.company_address;
  if (key.startsWith("ai.")) return context.ai_content?.[key.slice(3)];
  if (key.startsWith("ai_")) return context.ai_content?.[key.slice(3)];
  const field = CONTACT_FIELD_KEYS[key];
  if (field) return context.contact[field] ?? undefined;
  if (key === SALUTATION_KEY) return resolveSalutation(context.contact);
  return context.contact.custom_fields?.[key];
}

/** 主题与正文共用变量解析；正文转义，AI 文本保留换行，主题去掉换行。 */
export function renderTemplate(
  source: string,
  context: RenderContext,
  options: { html?: boolean; onDefault?: (key: string) => void } = {}
): string {
  const html = options.html ?? true;
  const rendered = source.replace(TEMPLATE_VARIABLE_PATTERN, (_match, key: string, fallback: string | undefined) => {
    let value = valueForKey(key, context);
    if (value === undefined || value === "") {
      if (fallback === undefined) throw new MissingVarError(key);
      value = fallback;
      options.onDefault?.(key);
    }
    if (!html) return value.replace(/[\r\n]+/g, "");
    const escaped = escapeHtml(value);
    return key.startsWith("ai.") || key.startsWith("ai_") ? escaped.replaceAll("\n", "<br>") : escaped;
  });
  return html ? rendered : rendered.replace(/[\r\n]+/g, "");
}

/** 返回模板中引用的变量名（去重，保持出现顺序），供发送前校验。 */
export function templateVariables(source: string): { key: string; hasDefault: boolean }[] {
  const result: { key: string; hasDefault: boolean }[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const key = match[1]!;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ key, hasDefault: match[2] !== undefined });
    }
  }
  return result;
}
