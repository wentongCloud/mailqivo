import ExcelJS from "exceljs";
import {
  commonLabel,
  consentSourceLabelI18n,
  contactStatusLabel,
  invalidReasonLabelI18n,
  type AppLocale,
  type ContactFilterInput,
  DEFAULT_LOCALE
} from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { iterateContacts } from "./service.ts";

const SOURCE_LABEL: Record<AppLocale, Record<"import" | "manual" | "reply", string>> = {
  "en-GB": { import: "Import", manual: "Manual", reply: "Reply" },
  "zh-CN": { import: "导入", manual: "手动", reply: "回函" }
};

/** 导出的列（顺序即 xlsx 列顺序）。 */
export function exportColumns(locale: AppLocale = DEFAULT_LOCALE) {
  return [
    { header: commonLabel("exportEmail", locale), key: "email", width: 32 },
    { header: commonLabel("exportName", locale), key: "name", width: 16 },
    { header: commonLabel("exportCompany", locale), key: "company", width: 24 },
    { header: commonLabel("exportTitle", locale), key: "title", width: 16 },
    { header: commonLabel("exportTags", locale), key: "tags", width: 24 },
    { header: commonLabel("exportStatus", locale), key: "status", width: 10 },
    { header: commonLabel("exportReason", locale), key: "reason", width: 28 },
    { header: commonLabel("exportDomainSuspect", locale), key: "domain_suspect", width: 10 },
    { header: commonLabel("exportSource", locale), key: "source", width: 10 },
    { header: commonLabel("consentAt", locale), key: "consent_at", width: 22 },
    { header: commonLabel("consentSourceColumn", locale), key: "consent_source", width: 10 },
    { header: commonLabel("exportCreatedAt", locale), key: "created_at", width: 22 }
  ] as const;
}

/**
 * 按筛选导出 xlsx（含状态与原因列）。
 * 状态、原因写当前 locale 文案；标签用顿号“、”连接；时间为 ISO 8601。
 */
export async function buildContactsWorkbook(
  db: Db,
  filter: ContactFilterInput,
  locale: AppLocale = DEFAULT_LOCALE
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(commonLabel("sheetContacts", locale));
  const columns = exportColumns(locale);
  sheet.columns = columns.map((c) => ({ ...c }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const tagSep = locale === "zh-CN" ? "、" : ", ";
  for await (const c of iterateContacts(db, filter)) {
    sheet.addRow({
      email: c.email,
      name: c.name ?? "",
      company: c.company ?? "",
      title: c.title ?? "",
      tags: c.tags.join(tagSep),
      status: contactStatusLabel(c.status, locale),
      reason: invalidReasonLabelI18n(c.invalid_reason, locale),
      domain_suspect: c.domain_suspect ? commonLabel("yes", locale) : "",
      source: SOURCE_LABEL[locale][c.source],
      consent_at: c.consent_at ?? "",
      consent_source: consentSourceLabelI18n(c.consent_source, locale),
      created_at: c.created_at
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
