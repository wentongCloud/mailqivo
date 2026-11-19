import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  CONTACT_STATUS_VALUES,
  type ContactDto,
  type ContactFilterInput,
  type ContactStatus,
  type ContactDeleteBody,
  type ContactDeleteResult,
  type ContactDeleteSummary,
  type ContactLanguageBody,
  type ContactStatusBody,
  type ContactStatusResult,
  type ContactStatusSummary,
  type CreateContactBody,
  type UpdateContactBody
} from "@mailqivo/shared";
import { normalizeCountryField } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { contactTags, contacts, tags } from "../../db/schema.ts";
import { consumeConfirmToken, issueConfirmToken } from "../../lib/confirm-token.ts";
import { Errors } from "../../lib/errors.ts";
import type { PageParams } from "../../lib/pagination.ts";
import { findOrCreateTags, isUniqueViolation } from "../tags/service.ts";
import { buildContactWhere } from "./where.ts";

type ContactRow = typeof contacts.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

function toDto(row: ContactRow, tagNames: string[]): ContactDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    company: row.company,
    title: row.title,
    custom_fields: row.custom_fields as Record<string, string>,
    status: row.status as ContactStatus,
    invalid_reason: row.invalid_reason,
    domain_suspect: row.domain_suspect,
    soft_bounce_streak: row.soft_bounce_streak,
    bounce_count: row.bounce_count,
    last_bounce_at: iso(row.last_bounce_at),
    unsubscribed_at: iso(row.unsubscribed_at),
    source: row.source as ContactDto["source"],
    consent_at: iso(row.consent_at),
    consent_source: row.consent_source as ContactDto["consent_source"],
    import_batch_id: row.import_batch_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    tags: tagNames
  };
}

/** 一次查询取出一批联系人的标签名（按名称排序）。 */
async function tagNamesByContact(db: Db, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ contact_id: contactTags.contact_id, name: tags.name })
    .from(contactTags)
    .innerJoin(tags, eq(tags.id, contactTags.tag_id))
    .where(inArray(contactTags.contact_id, ids))
    .orderBy(tags.name);
  for (const r of rows) {
    const list = map.get(r.contact_id!) ?? [];
    list.push(r.name);
    map.set(r.contact_id!, list);
  }
  return map;
}

async function withTags(db: Db, rows: ContactRow[]): Promise<ContactDto[]> {
  const tagMap = await tagNamesByContact(db, rows.map((r) => r.id));
  return rows.map((r) => toDto(r, tagMap.get(r.id) ?? []));
}

/** 通讯录搜索（分页）。返回的联系人含 tags。 */
export async function searchContacts(db: Db, filter: ContactFilterInput, page: PageParams) {
  const where = buildContactWhere(filter);
  const [counted] = await db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(where);
  const total = counted!.total;
  const rows = await db
    .select()
    .from(contacts)
    .where(where)
    .orderBy(desc(contacts.created_at), contacts.id)
    .limit(page.limit)
    .offset(page.offset);
  return { items: await withTags(db, rows), total };
}

/** 按筛选取全部联系人（导出用），分批读取，避免一次性占用过多内存。 */
export async function* iterateContacts(db: Db, filter: ContactFilterInput, batchSize = 1000) {
  const where = buildContactWhere(filter);
  let offset = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(desc(contacts.created_at), contacts.id)
      .limit(batchSize)
      .offset(offset);
    if (rows.length === 0) return;
    yield* await withTags(db, rows);
    if (rows.length < batchSize) return;
    offset += batchSize;
  }
}

export async function getContact(db: Db, id: string): Promise<ContactDto> {
  if (!isUuid(id)) throw Errors.notFound("联系人不存在");
  const [row] = await db.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw Errors.notFound("联系人不存在");
  return (await withTags(db, [row]))[0]!;
}

const duplicateEmail = () =>
  Errors.validation("该邮箱已存在", [{ path: "email", message: "该邮箱已存在" }]);

async function replaceTags(db: Db, contactId: string, names: string[]) {
  await db.delete(contactTags).where(eq(contactTags.contact_id, contactId));
  const ids = await findOrCreateTags(db, names);
  if (ids.size > 0) {
    await db
      .insert(contactTags)
      .values([...ids.values()].map((tag_id) => ({ contact_id: contactId, tag_id })))
      .onConflictDoNothing();
  }
}

export async function createContact(db: Db, body: CreateContactBody): Promise<ContactDto> {
  try {
    const id = await db.transaction(async (tx) => {
      const trx = tx as unknown as Db;
      const [row] = await trx
        .insert(contacts)
        .values({
          email: body.email,
          name: body.name ?? null,
          company: body.company ?? null,
          title: body.title ?? null,
          custom_fields: normalizeCountryField(body.custom_fields ?? {}),
          source: "manual",
          consent_source: body.consent_source ?? "manual",
          consent_at: sql`now()`
        })
        .returning({ id: contacts.id });
      const id = row!.id;
      if (body.tags?.length) await replaceTags(trx, id, body.tags);
      return id;
    });
    return await getContact(db, id);
  } catch (err) {
    if (isUniqueViolation(err, "contacts_email_key")) throw duplicateEmail();
    throw err;
  }
}

export async function updateContact(db: Db, id: string, body: UpdateContactBody): Promise<ContactDto> {
  await getContact(db, id); // 不存在则 NOT_FOUND
  const { tags: tagNames, ...rest } = body;
  const fields = rest.custom_fields ? { ...rest, custom_fields: normalizeCountryField(rest.custom_fields) } : rest;
  try {
    await db.transaction(async (tx) => {
      const trx = tx as unknown as Db;
      await trx
        .update(contacts)
        .set({ ...fields, updated_at: new Date() })
        .where(eq(contacts.id, id));
      if (tagNames) await replaceTags(trx, id, tagNames);
    });
  } catch (err) {
    if (isUniqueViolation(err, "contacts_email_key")) throw duplicateEmail();
    throw err;
  }
  return getContact(db, id);
}

export async function deleteContact(db: Db, id: string): Promise<void> {
  if (!isUuid(id)) throw Errors.notFound("联系人不存在");
  const rows = await db.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id });
  if (rows.length === 0) throw Errors.notFound("联系人不存在");
}

const LANGUAGE_FIELD = "语言偏好";
const LANGUAGE_ALIAS = "language";

/** 批量写入语言偏好。空字符串会清掉已有的语言字段。 */
export async function updateContactLanguage(db: Db, body: ContactLanguageBody) {
  const ids = [...new Set(body.contact_ids)];
  const found = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
  if (found.length < ids.length) throw Errors.notFound(`有 ${ids.length - found.length} 个联系人不存在`);
  const custom_fields = body.language
    ? sql`(${contacts.custom_fields} - ${LANGUAGE_ALIAS} - ${LANGUAGE_FIELD}) || jsonb_build_object(${LANGUAGE_FIELD}::text, ${body.language}::text)`
    : sql`${contacts.custom_fields} - ${LANGUAGE_ALIAS} - ${LANGUAGE_FIELD}`;
  const updated = await db
    .update(contacts)
    .set({ custom_fields, updated_at: new Date() })
    .where(inArray(contacts.id, ids))
    .returning({ id: contacts.id });
  return { updated: updated.length };
}

/** 批量删除。第一步返回摘要与令牌，第二步才删除。 */
export async function deleteContacts(db: Db, body: ContactDeleteBody) {
  const ids = [...new Set(body.contact_ids)].sort();
  const rows = await db
    .select({ id: contacts.id, email: contacts.email })
    .from(contacts)
    .where(inArray(contacts.id, ids));
  if (rows.length < ids.length) throw Errors.notFound(`有 ${ids.length - rows.length} 个联系人不存在`);
  const summary: ContactDeleteSummary = {
    total: rows.length,
    sample: rows.map((row) => row.email).sort((a, b) => a.localeCompare(b)).slice(0, 5)
  };
  const target = { contact_ids: ids };
  if (!body.confirm_token) return issueConfirmToken(db, { action: "contact_delete", target, summary });
  await consumeConfirmToken(db, { token: body.confirm_token, action: "contact_delete", target, summary });
  const deleted = await db.delete(contacts).where(inArray(contacts.id, ids)).returning({ id: contacts.id });
  const result: ContactDeleteResult = { deleted: deleted.length };
  return result;
}

// ---------------------------------------------------------------------------
// 批量修改状态（两步确认，§5.4 / §9 edm_contact_update_status）
// ---------------------------------------------------------------------------

async function computeStatusSummary(db: Db, ids: string[], body: ContactStatusBody): Promise<ContactStatusSummary> {
  const rows = await db
    .select({ status: contacts.status, n: sql<number>`count(*)::int` })
    .from(contacts)
    .where(inArray(contacts.id, ids))
    .groupBy(contacts.status);
  const by_current_status = Object.fromEntries(CONTACT_STATUS_VALUES.map((s) => [s, 0])) as Record<ContactStatus, number>;
  for (const r of rows) by_current_status[r.status as ContactStatus] = r.n;
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  if (total < ids.length) throw Errors.notFound(`有 ${ids.length - total} 个联系人不存在`);

  // 退订是终态，人工调整不能撤销。
  if (body.status !== "unsubscribed" && by_current_status.unsubscribed > 0) {
    throw Errors.invalidState("不能更改已退订联系人的状态", { unsubscribed: by_current_status.unsubscribed });
  }
  const unchanged = by_current_status[body.status];
  return {
    status: body.status,
    reason: body.reason ?? null,
    total,
    will_change: total - unchanged,
    unchanged,
    by_current_status
  };
}

/** 第一步返回 ConfirmChallenge；第二步（带 confirm_token）执行并返回 { updated, unchanged }。 */
export async function updateContactStatus(db: Db, body: ContactStatusBody) {
  const ids = [...new Set(body.contact_ids)].sort();
  const summary = await computeStatusSummary(db, ids, body);
  const target = { contact_ids: ids, status: body.status, reason: body.reason ?? null };

  if (!body.confirm_token) {
    return issueConfirmToken(db, { action: "contact_status", target, summary });
  }
  await consumeConfirmToken(db, { token: body.confirm_token, action: "contact_status", target, summary });

  if (body.status === "unsubscribed") {
    // §4.1：退订一律逐个走 applyUnsubscribe（已退订为 no-op，不改首次 unsubscribed_at）
    let applied = 0;
    await db.transaction(async (tx) => {
      const trx = tx as unknown as Db;
      for (const id of ids) {
        if ((await applyUnsubscribe(trx, { contact_id: id, reason: body.reason ?? null })).applied) applied += 1;
      }
    });
    const result: ContactStatusResult = { updated: applied, unchanged: ids.length - applied };
    return result;
  }

  const now = new Date();
  const set =
    body.status === "active"
      ? { status: "active", invalid_reason: null, soft_bounce_streak: 0, updated_at: now }
      : {
          status: "invalid",
          invalid_reason: sql`coalesce(${body.reason ?? null}::text, ${contacts.invalid_reason})`,
          updated_at: now
        };
  const updated = await db
    .update(contacts)
    .set(set)
    // 确认后才发生的退订同样受保护，计入 unchanged。
    .where(and(
      inArray(contacts.id, ids),
      ne(contacts.status, body.status),
      ne(contacts.status, "unsubscribed")
    ))
    .returning({ id: contacts.id });
  const result: ContactStatusResult = { updated: updated.length, unchanged: ids.length - updated.length };
  return result;
}

// ---------------------------------------------------------------------------
// 退订唯一生效函数（§4.1 V1.1）
// ---------------------------------------------------------------------------

export type ApplyUnsubscribeInput = {
  contact_id: string;
  /**
   * SPEC-GAP: §4.1 的 SQL 只写 status / unsubscribed_at；批量改状态（§9）原有可选 `reason`，
   * 这里在同一条 UPDATE 中以 coalesce 写入 invalid_reason，其余路径不传。
   */
  reason?: string | null;
};

/**
 * 退订信号（退订链接、回函 unsubscribe_request、webhook complaint、人工批量退订）的唯一生效函数。
 * active / bounced / invalid → unsubscribed；已退订为 no-op（applied:false），不覆盖首次 unsubscribed_at，
 * 不计入 bounce_count。`db` 可以是事务。
 */
export async function applyUnsubscribe(db: Db, input: ApplyUnsubscribeInput): Promise<{ applied: boolean }> {
  const rows = await db
    .update(contacts)
    .set({
      status: "unsubscribed",
      unsubscribed_at: sql`now()`,
      updated_at: sql`now()`,
      ...(input.reason ? { invalid_reason: sql`coalesce(${input.reason}::text, ${contacts.invalid_reason})` } : {})
    })
    .where(and(eq(contacts.id, input.contact_id), ne(contacts.status, "unsubscribed")))
    .returning({ id: contacts.id });
  return { applied: rows.length > 0 };
}
