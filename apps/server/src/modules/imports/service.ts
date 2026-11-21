import { isDeepStrictEqual } from "node:util";
import { eq, inArray, sql } from "drizzle-orm";
import {
  IMPORT_ISSUE_VALUES,
  type FieldMapping,
  type ImportCommitBody,
  type ImportCommitSummary,
  type ImportIssue,
  type ImportPreviewResult,
  type ImportReport,
  type ImportSampleRow,
  type MappedImportData
} from "@mailqivo/shared";
import { normalizeCountryField } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { contactTags, contacts, importBatches, importRows, tags } from "../../db/schema.ts";
import { consumeConfirmToken, issueConfirmToken } from "../../lib/confirm-token.ts";
import { AppError, Errors } from "../../lib/errors.ts";
import { isUniqueViolation } from "../tags/service.ts";
import { isUuid } from "../../lib/uuid.ts";
import { automaticFieldMapping, emailsInMappedRow, mapRawRow, parseImportFile } from "./parser.ts";
import { scheduleMxProbe } from "./mx.ts";

type ImportRow = typeof importRows.$inferSelect;
type SourceRow = { row_no: number; raw: Record<string, string> };
type CheckedRow = ImportSampleRow & { source_row_no: number | null };
type Contact = typeof contacts.$inferSelect;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const BLOCKING_ISSUES: ImportIssue[] = ["EMAIL_EMPTY", "EMAIL_INVALID", "DUPLICATE_IN_FILE"];

async function existingContactsByEmail(db: Db, emails: string[]): Promise<Map<string, Contact>> {
  const result = new Map<string, Contact>();
  const unique = [...new Set(emails.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 5000) {
    const rows = await db.select().from(contacts).where(inArray(contacts.email, unique.slice(i, i + 5000)));
    for (const row of rows) result.set(row.email, row);
  }
  return result;
}

async function checkRows(db: Db, rows: Pick<ImportRow, "row_no" | "source_row_no" | "raw" | "data">[], existing?: Map<string, Contact>): Promise<CheckedRow[]> {
  const mapped = rows.map((row) => ({
    row_no: row.row_no,
    source_row_no: row.source_row_no,
    raw: row.raw as Record<string, string>,
    data: row.data as MappedImportData
  }));
  const known = existing ?? (await existingContactsByEmail(db, mapped.map((r) => r.data.email ?? "")));
  const seen = new Set<string>();
  return mapped.map((row) => {
    const issues: ImportIssue[] = [];
    const email = row.data.email?.trim().toLowerCase() ?? "";
    if (!email) issues.push("EMAIL_EMPTY");
    else if (!EMAIL_PATTERN.test(email)) issues.push("EMAIL_INVALID");
    if (email && seen.has(email)) issues.push("DUPLICATE_IN_FILE");
    if (email) seen.add(email);
    if (email && known.has(email)) issues.push("EXISTS_IN_DB");
    return { ...row, issues };
  });
}

function columnSamples(rows: { raw: Record<string, string> }[]): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const row of rows) {
    for (const [header, value] of Object.entries(row.raw)) {
      if (!samples[header] && value.trim()) samples[header] = value.trim();
    }
  }
  return samples;
}

function mapSourceRows(rows: SourceRow[], mapping: FieldMapping, maxRows: number) {
  const mapped: { row_no: number; source_row_no: number; raw: Record<string, string>; data: MappedImportData }[] = [];
  for (const row of rows) {
    const data = mapRawRow(row.raw, mapping);
    const emails = emailsInMappedRow(data);
    const size = Math.max(1, emails.length);
    if (mapped.length + size > maxRows) {
      throw Errors.limitExceeded(`导入行数不能超过 ${maxRows} 行`, { max_rows: maxRows, actual: mapped.length + size });
    }
    const firstRowNo = Math.max(row.row_no, (mapped.at(-1)?.row_no ?? 0) + 1);
    for (let i = 0; i < size; i++) {
      mapped.push({
        row_no: firstRowNo + i, source_row_no: row.row_no, raw: row.raw,
        data: emails[i] ? { ...data, email: emails[i] } : data
      });
    }
  }
  return mapped;
}

function originalRows(rows: ImportRow[]): SourceRow[] {
  const sources = new Map<number, SourceRow>();
  const legacyCopies = new Map<number, Record<string, string>>();
  for (const row of rows) {
    const raw = row.raw as Record<string, string>;
    if (row.source_row_no === null) {
      // 旧预检把映射产生的副本与原行一起保存，副本保留相同 raw。
      if (isDeepStrictEqual(legacyCopies.get(row.row_no), raw)) continue;
      const possibleEmails = emailsInMappedRow({ custom_fields: raw });
      for (let i = 1; i < possibleEmails.length; i++) {
        legacyCopies.set(1_000_000 + row.row_no * 10 + i, raw);
      }
    }
    const id = row.source_row_no ?? row.row_no;
    if (!sources.has(id)) sources.set(id, { row_no: id, raw });
  }
  return [...sources.values()];
}

function makeReport(rows: CheckedRow[]): ImportReport {
  const issueCounts = Object.fromEntries(IMPORT_ISSUE_VALUES.map((issue) => [issue, 0])) as Record<ImportIssue, number>;
  for (const row of rows) for (const issue of row.issues) issueCounts[issue] += 1;
  return {
    total: rows.length,
    valid: rows.filter(isImportable).length,
    issues: issueCounts,
    sample_rows: rows.slice(0, 20).map(({ row_no, raw, data, issues }) => ({ row_no, raw, data, issues })),
    column_samples: columnSamples(rows)
  };
}

async function insertRows(db: Db, batchId: string, rows: CheckedRow[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    await db.insert(importRows).values(
      rows.slice(i, i + 1000).map((row) => ({
        batch_id: batchId,
        row_no: row.row_no,
        source_row_no: row.source_row_no,
        data: row.data,
        raw: row.raw,
        issues: row.issues
      }))
    );
  }
}

export async function createImport(
  db: Db,
  input: { filename: string; buffer: Buffer; field_mapping?: FieldMapping; max_rows: number }
): Promise<ImportPreviewResult> {
  const parsed = await parseImportFile(input.filename, input.buffer, input.max_rows);
  const mapping = input.field_mapping ?? automaticFieldMapping(parsed.headers);
  const initialRows = mapSourceRows(parsed.rows, mapping, input.max_rows);
  const checked = await checkRows(db, initialRows);
  const report = makeReport(checked);
  return db.transaction(async (tx) => {
    const [batch] = await tx.insert(importBatches)
      .values({ filename: input.filename, field_mapping: mapping, report })
      .returning({ id: importBatches.id });
    await insertRows(tx as unknown as Db, batch!.id, checked);
    return { batch_id: batch!.id, field_mapping: mapping, report };
  });
}

async function getBatch(db: Db, id: string, lock = false) {
  if (!isUuid(id)) throw Errors.notFound("导入批次不存在");
  const query = db.select().from(importBatches).where(eq(importBatches.id, id));
  const [batch] = await (lock ? query.for("update") : query);
  if (!batch) throw Errors.notFound("导入批次不存在");
  return batch;
}

export async function updateImportMapping(db: Db, id: string, mapping: FieldMapping, maxRows: number): Promise<ImportPreviewResult> {
  return db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const batch = await getBatch(trx, id, true);
    if (batch.status !== "previewed") throw Errors.invalidState("已提交的导入批次不能修改映射");
    const rows = await trx.select().from(importRows).where(eq(importRows.batch_id, id)).orderBy(importRows.row_no);
    const remapped = mapSourceRows(originalRows(rows), mapping, maxRows);
    const checked = await checkRows(trx, remapped);
    const report = makeReport(checked);
    await trx.delete(importRows).where(eq(importRows.batch_id, id));
    await insertRows(trx, id, checked);
    await trx.update(importBatches).set({ field_mapping: mapping, report }).where(eq(importBatches.id, id));
    return { batch_id: id, field_mapping: mapping, report };
  });
}

function isImportable(row: ImportSampleRow): boolean {
  return !row.issues.some((issue) => BLOCKING_ISSUES.includes(issue));
}

/** 导入要打的标签：REST 按标签 id，MCP 按标签名（不存在的名称在确认后创建）。 */
export type ImportTagSelection = { ids: string[] } | { names: string[] };
export type ImportCommitInput = Pick<ImportCommitBody, "dedup_strategy" | "confirm_token"> & { tags: ImportTagSelection };

/**
 * 解析导入标签。`lock` 为 true 时锁住命中的标签行到事务结束：名称选择用 FOR SHARE 阻止改名与删除，
 * id 选择用 FOR KEY SHARE 阻止删除。只在写入阶段末尾加锁，避免整次导入期间阻塞标签管理。
 */
async function resolveImportTags(db: Db, selection: ImportTagSelection, lock: boolean) {
  if ("names" in selection) {
    const names = [...new Set(selection.names)].sort();
    const query = db.select().from(tags).where(inArray(tags.name, names)).orderBy(tags.id);
    const rows = names.length ? await (lock ? query.for("share") : query) : [];
    const byName = new Map(rows.map(row => [row.name, row.id]));
    return {
      ids: rows.map(row => row.id), pending: names.filter(name => !byName.has(name)),
      target: { tag_ids: [], tag_names: names.map(name => ({ name, id: byName.get(name) ?? null })) }
    };
  }
  const ids = [...new Set(selection.ids.map(id => id.toLowerCase()))].sort();
  if (ids.length) {
    const query = db.select({ id: tags.id }).from(tags).where(inArray(tags.id, ids)).orderBy(tags.id);
    const found = await (lock ? query.for("key share") : query);
    if (found.length !== ids.length) throw Errors.validation("包含不存在的导入标签");
  }
  return { ids, pending: [] as string[], target: { tag_ids: [...selection.ids].sort() } };
}

/** 写入阶段发现导入标签与确认时不同：回滚写入，改为签发新令牌。 */
class ImportTagsChanged extends Error {}

async function commitPlan(db: Db, id: string, body: ImportCommitInput) {
  const batch = await getBatch(db, id, true);
  if (batch.status !== "previewed") throw Errors.invalidState("该导入批次已处理");
  const rows = await db.select().from(importRows).where(eq(importRows.batch_id, id)).orderBy(importRows.row_no);
  const known = await existingContactsByEmail(db, rows.map(row => (row.data as MappedImportData).email ?? ""));
  const checked = await checkRows(db, rows, known);
  const importable = checked.filter(isImportable);
  const existingCount = importable.filter((row) => known.has(row.data.email!)).length;
  const created = importable.length - existingCount;
  const updated = body.dedup_strategy === "skip" ? 0 : existingCount;
  const skipped = checked.length - importable.length + (body.dedup_strategy === "skip" ? existingCount : 0);
  const selected = await resolveImportTags(db, body.tags, false);
  const summary: ImportCommitSummary = {
    filename: batch.filename,
    total: checked.length,
    created,
    updated,
    skipped,
    dedup_strategy: body.dedup_strategy,
    tag_count: selected.ids.length + selected.pending.length
  };
  return { batch, known, importable, summary, selected };
}

async function addTags(db: Db, contactIds: string[], tagIds: string[]) {
  if (!contactIds.length || !tagIds.length) return;
  const values = contactIds.flatMap((contact_id) => tagIds.map((tag_id) => ({ contact_id, tag_id })));
  for (let i = 0; i < values.length; i += 5000) {
    await db.insert(contactTags).values(values.slice(i, i + 5000)).onConflictDoNothing();
  }
}

/**
 * 在保存点内写入联系人与标签。标签在写入末尾才加锁并与确认时的目标比较；
 * 不一致或待建名称被并发创建时抛出，由调用方回滚整个保存点。
 */
async function writeImport(trx: Db, id: string, body: ImportCommitInput, plan: Awaited<ReturnType<typeof commitPlan>>) {
  const createdEmails: string[] = [];
  // 批量写入（原先逐行 INSERT / UPDATE，10 万行即 10 万次往返）。
  const taggedIds: string[] = [];
  let actualCreated = 0;
  let actualUpdated = 0;
  let actualSkipped = plan.summary.total - plan.importable.length;
  const toUpdate: { id: string; name: string | null; company: string | null; title: string | null; custom_fields: Record<string, string> }[] = [];
  const toCreate: MappedImportData[] = [];
  const planExisting = (existing: Contact, data: MappedImportData) => {
    if (body.dedup_strategy === "skip") {
      actualSkipped += 1;
      return;
    }
    actualUpdated += 1;
    if (body.dedup_strategy === "overwrite") {
      const custom = { ...(existing.custom_fields as Record<string, string>) };
      for (const [key, value] of Object.entries(data.custom_fields ?? {})) if (value !== "") custom[key] = value;
      toUpdate.push({
        id: existing.id,
        name: data.name || existing.name,
        company: data.company || existing.company,
        title: data.title || existing.title,
        custom_fields: normalizeCountryField(custom)
      });
    }
    taggedIds.push(existing.id);
  };
  for (const row of plan.importable) {
    const existing = plan.known.get(row.data.email!);
    if (existing) planExisting(existing, row.data);
    else toCreate.push(row.data);
  }
  for (let i = 0; i < toCreate.length; i += 1000) {
    const chunk = toCreate.slice(i, i + 1000);
    const created = await trx.insert(contacts).values(chunk.map((data) => ({
      email: data.email!,
      name: data.name || null,
      company: data.company || null,
      title: data.title || null,
      custom_fields: data.custom_fields ?? {},
      source: "import",
      consent_source: "import",
      consent_at: sql`now()`,
      import_batch_id: id
    }))).onConflictDoNothing({ target: contacts.email }).returning({ id: contacts.id, email: contacts.email });
    for (const row of created) {
      taggedIds.push(row.id);
      createdEmails.push(row.email);
      actualCreated += 1;
    }
    // 预检之后被并发创建的同邮箱联系人：不再整批失败，按去重策略当作已存在处理。
    if (created.length < chunk.length) {
      const inserted = new Set(created.map((row) => row.email));
      const raced = chunk.filter((data) => !inserted.has(data.email!));
      const now = await existingContactsByEmail(trx, raced.map((data) => data.email!));
      for (const data of raced) {
        const existing = now.get(data.email!);
        if (existing) planExisting(existing, data);
      }
    }
  }
  for (let i = 0; i < toUpdate.length; i += 1000) {
    const rows = sql.join(toUpdate.slice(i, i + 1000).map((row) =>
      sql`(${row.id}::uuid, ${row.name}::text, ${row.company}::text, ${row.title}::text, ${JSON.stringify(row.custom_fields)}::jsonb)`), sql`, `);
    await trx.execute(sql`
      UPDATE contacts SET name = v.name, company = v.company, title = v.title, custom_fields = v.custom_fields, updated_at = now()
      FROM (VALUES ${rows}) AS v(id, name, company, title, custom_fields)
      WHERE contacts.id = v.id
    `);
  }
  const locked = await resolveImportTags(trx, body.tags, true);
  if (!isDeepStrictEqual(locked.target, plan.selected.target)) throw new ImportTagsChanged();
  const finalTagIds = [...locked.ids];
  if (locked.pending.length) {
    // 唯一索引保护尚不存在的名称；并发创建同名标签时 INSERT 失败，整个保存点回滚。
    const added = await trx.insert(tags).values(locked.pending.map(name => ({ name }))).returning({ id: tags.id });
    finalTagIds.push(...added.map(row => row.id));
  }
  await addTags(trx, taggedIds, finalTagIds);
  await trx
    .update(importBatches)
    .set({ status: "committed", dedup_strategy: body.dedup_strategy, tag_ids: finalTagIds, committed_at: new Date() })
    .where(eq(importBatches.id, id));
  return { counts: { created: actualCreated, updated: actualUpdated, skipped: actualSkipped }, createdEmails };
}

export async function commitImport(db: Db, id: string, body: ImportCommitInput) {
  const createdEmails: string[] = [];
  const result = await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    const plan = await commitPlan(trx, id, body);
    const target = {
      batch_id: id, field_mapping: plan.batch.field_mapping,
      dedup_strategy: body.dedup_strategy, ...plan.selected.target
    };
    const challenge = { action: "import_commit" as const, target, summary: plan.summary };
    if (!body.confirm_token) return issueConfirmToken(trx, challenge);
    try {
      await consumeConfirmToken(trx, { ...challenge, token: body.confirm_token });
    } catch (error) {
      // 摘要或映射变化时，提交作废旧令牌与生成新令牌的写入。
      if (error instanceof AppError && error.code === "CONFIRM_INVALID") return error;
      throw error;
    }
    try {
      const written = await tx.transaction((savepoint) => writeImport(savepoint as unknown as Db, id, body, plan));
      createdEmails.push(...written.createdEmails);
      return written.counts;
    } catch (error) {
      // 写入整体回滚；令牌已消费，签发基于最新标签的新令牌并提交。
      if (!(error instanceof ImportTagsChanged) && !isUniqueViolation(error, "tags_name_key")) throw error;
      const latest = await resolveImportTags(trx, body.tags, false);
      const next = await issueConfirmToken(trx, { ...challenge, target: { ...target, ...latest.target } });
      return new AppError("CONFIRM_INVALID", "导入标签已发生变化，请重新确认最新摘要", {
        reason: "TARGET_MISMATCH", summary: next.summary, confirm_token: next.confirm_token
      });
    }
  });
  if (result instanceof AppError) throw result;
  if (createdEmails.length) scheduleMxProbe(db, createdEmails);
  return result;
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function buildProblemRowsCsv(db: Db, id: string): Promise<Buffer> {
  await getBatch(db, id);
  const rows = await db.select().from(importRows).where(eq(importRows.batch_id, id)).orderBy(importRows.row_no);
  const checked = await checkRows(db, rows);
  const problemRows = checked.filter((row) => row.issues.length > 0);
  const headers = [...new Set(problemRows.flatMap((row) => Object.keys(row.raw)))];
  const lines = [[...headers, "问题"], ...problemRows.map((row) => [...headers.map((h) => row.raw[h] ?? ""), row.issues.join("、")])];
  return Buffer.from(`\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`, "utf8");
}
