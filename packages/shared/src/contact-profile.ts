import { ISO_3166_1 } from "./iso3166.ts";

/**
 * 联系人资料字段存在 custom_fields 中，同一含义可能有多个 key（导入写中文键，API 可能写英文键）。
 * 读取时按顺序取第一个非空值；写入时归并到第一项。服务端（{{称呼}}、写入标准化）与前端表单、列表共用这份定义。
 */
export const COUNTRY_KEYS = ["国家/地区", "国家", "country"] as const;
export const CITY_KEYS = ["城市", "city"] as const;
export const LANGUAGE_KEYS = ["语言偏好", "language"] as const;

export function readProfileField(fields: Record<string, unknown> | null | undefined, keys: readonly string[]): string {
  if (!fields) return "";
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

const CODE_TO_NAME = new Map(ISO_3166_1.map(([code, name]) => [code, name]));
const NAME_TO_CODE = new Map(ISO_3166_1.map(([code, name]) => [name, code]));

/**
 * 国家/地区取值 → ISO 二位代码。识别二位代码（不区分大小写，全角也可）或中文名称（简体正文）；
 * 空值或不在标准表中返回 undefined。
 */
export function countryCode(value: string | null | undefined): string | undefined {
  const text = value?.normalize("NFKC").trim() ?? "";
  if (/^[A-Za-z]{2}$/.test(text)) {
    const code = text.toUpperCase();
    return CODE_TO_NAME.has(code) ? code : undefined;
  }
  return NAME_TO_CODE.get(text);
}

/** 国家/地区取值 → 标准中文名称（CN / cn / 中国 → 中国）；识别不了返回 undefined。 */
export function standardCountryName(value: string | null | undefined): string | undefined {
  const code = countryCode(value);
  return code ? CODE_TO_NAME.get(code) : undefined;
}

/**
 * 写入前标准化国家/地区：能识别的值改成标准中文名称并归并到 `国家/地区`，去掉别名键；
 * 识别不了的值原样保留（不丢数据，{{称呼}} 会走默认值）。返回新对象，不改入参。
 */
export function normalizeCountryField<T extends Record<string, string>>(fields: T): T {
  const name = standardCountryName(readProfileField(fields, COUNTRY_KEYS));
  if (!name) return fields;
  const result: Record<string, string> = { ...fields };
  for (const key of COUNTRY_KEYS) delete result[key];
  result[COUNTRY_KEYS[0]] = name;
  return result as T;
}

/**
 * 联系人「职位」的常见管理层选项，前端职位 Select 的唯一来源。value 是存库值（简体中文）；
 * 界面文案按 key 取 apps/web/messages 的 `Titles` 命名空间，各语言只显示本语言。
 * 含「总监」「经理」的职位可生成中文 {{称呼}}（如 王经理）；董事长、总裁、C 级职位不在生成规则内，走模板默认值。
 * 导入与 API 仍接受任意文本，表单遇到非标准值原样保留并标注。
 */
export const MANAGEMENT_TITLES = [
  { key: "chairman", value: "董事长" },
  { key: "president", value: "总裁" },
  { key: "ceo", value: "首席执行官" },
  { key: "coo", value: "首席运营官" },
  { key: "cfo", value: "首席财务官" },
  { key: "cto", value: "首席技术官" },
  { key: "cio", value: "首席信息官" },
  { key: "cmo", value: "首席营销官" },
  { key: "general_manager", value: "总经理" },
  { key: "deputy_general_manager", value: "副总经理" },
  { key: "director", value: "总监" },
  { key: "sales_director", value: "销售总监" },
  { key: "marketing_director", value: "市场总监" },
  { key: "operations_director", value: "运营总监" },
  { key: "finance_director", value: "财务总监" },
  { key: "technical_director", value: "技术总监" },
  { key: "it_director", value: "IT总监" },
  { key: "procurement_director", value: "采购总监" },
  { key: "hr_director", value: "人力资源总监" },
  { key: "manager", value: "经理" },
  { key: "department_manager", value: "部门经理" },
  { key: "sales_manager", value: "销售经理" },
  { key: "marketing_manager", value: "市场经理" },
  { key: "operations_manager", value: "运营经理" },
  { key: "finance_manager", value: "财务经理" },
  { key: "it_manager", value: "IT经理" },
  { key: "procurement_manager", value: "采购经理" },
  { key: "hr_manager", value: "人力资源经理" },
  { key: "project_manager", value: "项目经理" },
  { key: "product_manager", value: "产品经理" }
] as const;
