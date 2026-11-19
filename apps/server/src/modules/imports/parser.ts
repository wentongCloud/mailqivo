import ExcelJS from "exceljs";
import iconv from "iconv-lite";
import jschardet from "jschardet";
import { parse } from "csv-parse/sync";
import type { FieldMapping, MappedImportData } from "@mailqivo/shared";
import { Errors } from "../../lib/errors.ts";

export type ParsedImport = {
  headers: string[];
  rows: { row_no: number; raw: Record<string, string> }[];
};

/** 联系人字段。同一实体出现多组时，每组拆成一条记录。 */
const CONTACT_FIELDS = new Set(["email", "name", "phone", "department"]);

const CANONICAL_HEADER: Record<string, string> = {
  email: "邮箱",
  name: "姓名",
  phone: "手机",
  department: "部门"
};

/**
 * 规范化后再做全等匹配：去空白、全角转半角、去掉标点。
 * 「地区」单独出现不是国家，不在此表中。
 */
const ALIAS_SOURCE: [string, string][] = [
  ["邮箱", "email"],
  ["email", "email"],
  ["e-mail", "email"],
  ["mail", "email"],
  ["邮件", "email"],
  ["邮件地址", "email"],
  ["电子邮箱", "email"],
  ["电邮", "email"],
  ["联系人邮箱", "email"],
  ["联系邮箱", "email"],
  ["邮箱地址", "email"],
  ["email地址", "email"],
  ["姓名", "name"],
  ["name", "name"],
  ["联系人", "name"],
  ["联系人姓名", "name"],
  ["名字", "name"],
  ["手机", "phone"],
  ["电话", "phone"],
  ["移动电话", "phone"],
  ["联系人手机", "phone"],
  ["联系电话", "phone"],
  ["手机号", "phone"],
  ["手机号码", "phone"],
  ["phone", "phone"],
  ["mobile", "phone"],
  ["tel", "phone"],
  ["部门", "department"],
  ["联系人部门", "department"],
  ["department", "department"],
  ["国家/地区", "country"],
  ["国家地区", "country"],
  ["国家", "country"],
  ["country", "country"],
  ["城市", "city"],
  ["所在城市", "city"],
  ["city", "city"],
  ["公司", "company"],
  ["company", "company"],
  ["单位", "company"],
  ["企业", "company"],
  ["公司名称", "company"],
  ["企业名称", "company"],
  ["单位名称", "company"],
  ["客户名称", "company"],
  ["机构名称", "company"],
  ["职位", "title"],
  ["title", "title"],
  ["职务", "title"],
  ["职称", "title"]
];

const CUSTOM_KEY: Record<string, string> = {
  country: "国家/地区",
  city: "城市",
  phone: "手机",
  department: "部门"
};

export function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:._\-—–|/\\()（）【】[\]*"'“”‘’*＊]/g, "")
    .replace(/(必填|required)$/g, "");
}

const ALIAS = new Map(ALIAS_SOURCE.map(([label, field]) => [normalizeHeader(label), field]));

function lookupAlias(normalized: string): string | null {
  const direct = ALIAS.get(normalized);
  if (direct) return direct;
  const stripped = normalized.replace(/(zh|en|cn|eng|chs)$/g, "");
  return stripped === normalized ? null : (ALIAS.get(stripped) ?? null);
}

export function classifyHeader(header: string): { field: string | null; slot: number } {
  const normalized = normalizeHeader(header);
  const direct = lookupAlias(normalized);
  if (direct) return { field: direct, slot: 1 };
  const prefixed = normalized.match(/^联系人(\d+)(.*)$/);
  if (prefixed) {
    const field = lookupAlias(prefixed[2]!) ?? lookupAlias(`联系人${prefixed[2]}`);
    if (field && CONTACT_FIELDS.has(field)) return { field, slot: Number(prefixed[1]) };
  }
  const trailing = normalized.match(/^(.*?)(\d+)$/);
  if (trailing?.[1]) {
    const field = lookupAlias(trailing[1]);
    if (field && CONTACT_FIELDS.has(field)) return { field, slot: Number(trailing[2]) };
  }
  // 表头通常很短。「公司公共邮箱（多个逗号分隔）」含邮箱；备注正文里提到邮箱不算表头。
  if (normalized.length <= 40 && /邮箱|email|电邮/.test(normalized) && !/状态|验证|是否/.test(normalized)) {
    return { field: "email", slot: 1 };
  }
  return { field: null, slot: 1 };
}

function mappingTarget(field: string | null, header: string): string {
  if (field === "email" || field === "name" || field === "company" || field === "title") return field;
  if (field && CUSTOM_KEY[field]) return `custom:${CUSTOM_KEY[field]}`;
  return `custom:${header}`;
}

export function automaticFieldMapping(headers: string[]): FieldMapping {
  const usedBuiltin = new Set<string>();
  return Object.fromEntries(
    headers.map((header) => {
      const { field } = classifyHeader(header);
      if (field === "company" || field === "title") {
        if (usedBuiltin.has(field)) return [header, `custom:${header}`];
        usedBuiltin.add(field);
      }
      return [header, mappingTarget(field, header)];
    })
  );
}

function uniqueHeaders(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    // SPEC-GAP: 规格未定义重复或空表头；为其生成稳定且可映射的名称。
    const base = value.trim() || `未命名列${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function trimTrailing(values: string[]): string[] {
  let end = values.length;
  while (end > 0 && !String(values[end - 1] ?? "").trim()) end -= 1;
  return values.slice(0, end);
}

function headerScore(cells: string[]): number {
  let score = 0;
  for (const cell of cells) if (cell.trim() && classifyHeader(cell).field) score += 1;
  return score;
}

/** 标题行得分低于真正的表头行。并列时保留更靠前的一行，现有夹具仍以第 1 行为表头。 */
function findHeaderIndex(matrix: string[][]): number {
  const limit = Math.min(matrix.length, 15);
  let best = 0;
  let bestScore = headerScore(matrix[0] ?? []);
  for (let i = 1; i < limit; i += 1) {
    const score = headerScore(matrix[i] ?? []);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best;
}

function expandContacts(
  headers: string[],
  rows: { row_no: number; raw: Record<string, string> }[]
): ParsedImport {
  const cols = headers.map((header) => ({ header, ...classifyHeader(header) }));
  const slots = [...new Set(cols.filter((col) => col.field && CONTACT_FIELDS.has(col.field)).map((col) => col.slot))].sort(
    (a, b) => a - b
  );
  if (slots.length <= 1) return { headers, rows };

  const entityCols = cols.filter((col) => !col.field || !CONTACT_FIELDS.has(col.field));
  const fieldOrder = ["name", "phone", "department", "email"].filter((field) => cols.some((col) => col.field === field));
  const nextHeaders = uniqueHeaders([...entityCols.map((col) => col.header), ...fieldOrder.map((field) => CANONICAL_HEADER[field]!)]);
  const nextRows: ParsedImport["rows"] = [];
  for (const row of rows) {
    const emitted: Record<string, string>[] = [];
    for (const slot of slots) {
      const raw: Record<string, string> = {};
      for (const col of entityCols) raw[col.header] = row.raw[col.header] ?? "";
      let any = false;
      for (const field of fieldOrder) {
        const col = cols.find((item) => item.field === field && item.slot === slot);
        const value = col ? (row.raw[col.header] ?? "") : "";
        raw[CANONICAL_HEADER[field]!] = value;
        if (value.trim()) any = true;
      }
      if (any) emitted.push(raw);
    }
    if (emitted.length === 0) {
      const raw: Record<string, string> = {};
      for (const col of entityCols) raw[col.header] = row.raw[col.header] ?? "";
      for (const field of fieldOrder) raw[CANONICAL_HEADER[field]!] = "";
      emitted.push(raw);
    }
    for (const raw of emitted) nextRows.push({ row_no: nextRows.length + 2, raw });
  }
  return { headers: nextHeaders, rows: nextRows };
}

function splitEmailCell(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = trimmed
    .split(/[,，;；、|\n\r\t]+|\s+/)
    .map((token) => token.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, ""))
    .filter(Boolean);
  const emails = tokens.filter((token) => token.includes("@"));
  if (emails.length === 0) return [trimmed];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(email);
  }
  return unique;
}

function isContactEmailHeader(header: string): boolean {
  return normalizeHeader(header).includes("联系人") && classifyHeader(header).field === "email";
}

/** 一个单元格里的多个邮箱，或联系人邮箱与公司公共邮箱同时有值时，拆成多条记录。 */
function expandEmailLists(headers: string[], rows: ParsedImport["rows"]): ParsedImport {
  const emailHeaders = headers.filter((header) => classifyHeader(header).field === "email");
  if (emailHeaders.length === 0) return { headers, rows };
  const personal = headers.filter((header) => {
    const field = classifyHeader(header).field;
    return field === "name" || field === "phone" || field === "department";
  });
  const nextRows: ParsedImport["rows"] = [];
  for (const row of rows) {
    const pieces: { header: string; email: string }[] = [];
    const seen = new Set<string>();
    for (const header of emailHeaders) {
      for (const email of splitEmailCell(row.raw[header] ?? "")) {
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pieces.push({ header, email });
      }
    }
    const firstRowNo = Math.max(row.row_no, (nextRows.at(-1)?.row_no ?? 0) + 1);
    if (pieces.length <= 1) {
      nextRows.push({ ...row, row_no: firstRowNo });
      continue;
    }
    const named = pieces.some((piece) => isContactEmailHeader(piece.header));
    pieces.forEach((piece, index) => {
      const raw = { ...row.raw };
      for (const header of emailHeaders) raw[header] = "";
      raw[piece.header] = piece.email;
      const keepPersonal = isContactEmailHeader(piece.header) || (!named && index === 0);
      if (!keepPersonal) for (const header of personal) raw[header] = "";
      nextRows.push({ row_no: firstRowNo + index, raw });
    });
  }
  return { headers, rows: nextRows };
}

function rowsFromArrays(matrix: string[][], maxRows: number): ParsedImport {
  if (matrix.length === 0 || matrix.every((row) => row.every((cell) => !String(cell).trim()))) {
    throw Errors.validation("文件为空，第一行必须是表头");
  }
  const headerIndex = findHeaderIndex(matrix);
  const headerCells = trimTrailing((matrix[headerIndex] ?? []).map((value) => String(value ?? "")));
  if (headerCells.length === 0) throw Errors.validation("文件为空，第一行必须是表头");
  const headers = uniqueHeaders(headerCells);
  const sourceRows = matrix
    .slice(headerIndex + 1)
    .map((values, index) => ({
      excelRow: headerIndex + index + 2,
      values: headerCells.map((_, i) => String(values[i] ?? ""))
    }))
    .filter((row) => row.values.some((value) => value.trim()));
  if (sourceRows.length > maxRows) {
    throw Errors.limitExceeded(`导入行数不能超过 ${maxRows} 行`, { max_rows: maxRows, actual: sourceRows.length });
  }
  const contacts = expandContacts(
    headers,
    sourceRows.map((row) => ({
      row_no: row.excelRow,
      raw: Object.fromEntries(headers.map((header, i) => [header, row.values[i] ?? ""]))
    }))
  );
  const parsed = expandEmailLists(contacts.headers, contacts.rows);
  if (parsed.rows.length > maxRows) {
    throw Errors.limitExceeded(`导入行数不能超过 ${maxRows} 行`, { max_rows: maxRows, actual: parsed.rows.length });
  }
  return parsed;
}

function cellText(cell: ExcelJS.Cell): string {
  const text = cell.text ?? "";
  if (text.trim()) return text;
  const value = cell.value;
  if (value && typeof value === "object" && "hyperlink" in value) {
    const link = String((value as { hyperlink?: unknown }).hyperlink ?? "");
    return link.replace(/^mailto:/i, "");
  }
  return text;
}

async function parseXlsx(buffer: Buffer, maxRows: number): Promise<ParsedImport> {
  try {
    const workbook = new ExcelJS.Workbook();
    // ExcelJS 的 Buffer 类型尚未跟上新版 Node 的泛型 Buffer，运行时完全兼容。
    await workbook.xlsx.load(buffer as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw Errors.validation("Excel 文件中没有工作表");
    const matrix: string[][] = [];
    const columnCount = sheet.columnCount;
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = Array.from({ length: columnCount }, (_, i) => cellText(row.getCell(i + 1)));
      matrix.push(values);
    });
    return rowsFromArrays(matrix, maxRows);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "VALIDATION") throw err;
    if (err instanceof Error && "code" in err && err.code === "LIMIT_EXCEEDED") throw err;
    throw Errors.validation("无法解析 Excel 文件，请上传有效的 .xlsx 文件");
  }
}

function parseCsv(buffer: Buffer, maxRows: number): ParsedImport {
  try {
    const detected = jschardet.detect(buffer).encoding?.toLowerCase() ?? "utf-8";
    const encoding = /gbk|gb18030|gb2312/.test(detected) ? "gb18030" : "utf-8";
    const text = iconv.decode(buffer, encoding);
    const matrix = parse(text, {
      bom: true,
      columns: false,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false
    }) as string[][];
    return rowsFromArrays(matrix, maxRows);
  } catch (err) {
    if (err instanceof Error && "code" in err && ["VALIDATION", "LIMIT_EXCEEDED"].includes(String(err.code))) throw err;
    throw Errors.validation("无法解析 CSV 文件，请检查文件编码与格式");
  }
}

export async function parseImportFile(filename: string, buffer: Buffer, maxRows: number): Promise<ParsedImport> {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension === "xlsx") return parseXlsx(buffer, maxRows);
  if (extension === "csv") return parseCsv(buffer, maxRows);
  throw Errors.validation("仅支持 .xlsx 和 .csv 文件");
}

const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** 整個儲存格都是郵箱（可逗號分隔）才採用。某一格為空不影響同一行的其他格。 */
function emailsInCell(value: string | undefined): string[] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return [];
  const tokens = trimmed
    .split(/[,，;；、|\s]+/)
    .map((token) => token.trim().replace(/^mailto:/i, "").replace(/^<|>$/g, ""))
    .filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => !EMAIL_TOKEN.test(token))) return [];
  return tokens.map((token) => token.toLowerCase());
}

/**
 * 這一行裡實際出現的郵箱。內建郵箱格可以是空的，同一行其他已映射儲存格裡的郵箱仍然算數。
 * 被忽略的列不會進到 data，因此不會被算進來。
 */
export function emailsInMappedRow(data: MappedImportData): string[] {
  const found: string[] = [];
  for (const email of [...emailsInCell(data.email), ...Object.values(data.custom_fields ?? {}).flatMap(emailsInCell)]) {
    if (!found.includes(email)) found.push(email);
  }
  return found;
}

export function mapRawRow(raw: Record<string, string>, mapping: FieldMapping): MappedImportData {
  const data: MappedImportData = {};
  for (const [header, target] of Object.entries(mapping)) {
    const value = (raw[header] ?? "").trim();
    if (target === "ignore") continue;
    if (target === "email") {
      if (value && !data.email) data.email = value.toLowerCase();
    } else if (target === "name" || target === "company" || target === "title") {
      if (value && !data[target]) data[target] = value;
    } else if (target.startsWith("custom:")) {
      const key = target.slice(7);
      if (key && value && !(data.custom_fields ?? {})[key]) (data.custom_fields ??= {})[key] = value;
    }
  }
  return data;
}
