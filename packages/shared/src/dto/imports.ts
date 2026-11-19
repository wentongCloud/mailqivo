/** T03 Excel / CSV 导入：REST 与界面共用的入参出参（§7.1）。 */
import { z } from "zod";
import { DEDUP_STRATEGY_VALUES, IMPORT_ISSUE_VALUES, type DedupStrategy, type ImportIssue } from "../enums.ts";

export const ImportFieldTarget = z
  .string()
  .refine(
    (v) => ["email", "name", "company", "title", "ignore"].includes(v) || /^custom:.+/.test(v),
    "字段映射目标不合法"
  );
export type ImportFieldTarget = z.infer<typeof ImportFieldTarget>;

export const FieldMapping = z.record(z.string().min(1), ImportFieldTarget);
export type FieldMapping = z.infer<typeof FieldMapping>;

export type MappedImportData = {
  email?: string;
  name?: string;
  company?: string;
  title?: string;
  custom_fields?: Record<string, string>;
};

export type ImportSampleRow = {
  row_no: number;
  data: MappedImportData;
  raw: Record<string, string>;
  issues: ImportIssue[];
};

export type ImportReport = {
  total: number;
  valid: number;
  issues: Record<ImportIssue, number>;
  sample_rows: ImportSampleRow[];
  /** 每一列第一個非空儲存格。某一列為空不代表整列都沒有資料。 */
  column_samples: Record<string, string>;
};

export type ImportPreviewResult = {
  batch_id: string;
  field_mapping: FieldMapping;
  report: ImportReport;
};

export const ImportCommitBody = z.object({
  dedup_strategy: z.enum(DEDUP_STRATEGY_VALUES),
  tag_ids: z.array(z.string().uuid()).max(50).default([]),
  confirm_token: z.string().min(1).optional()
});
export type ImportCommitBody = z.infer<typeof ImportCommitBody>;

export type ImportCommitSummary = {
  filename: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  dedup_strategy: DedupStrategy;
  tag_count: number;
};

export type ImportCommitResult = {
  created: number;
  updated: number;
  skipped: number;
};

export { IMPORT_ISSUE_LABEL, IMPORT_FIELD_LABEL } from "../i18n/labels.ts";

export { IMPORT_ISSUE_VALUES };
