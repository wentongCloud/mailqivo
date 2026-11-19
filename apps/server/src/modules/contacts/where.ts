/**
 * §5.3 `buildContactWhere(filter) → SQL`：通讯录搜索、导出、（后续）活动收件人三处共用。
 * 所有条件之间是 AND 关系；查询的主表必须是 `contacts`（不能起别名）。
 *
 * 空数组的语义（SPEC-GAP）：`contact_ids: []` 匹配 0 行（避免“空选择 = 全部”的误操作）；
 * `tags_any / tags_all / domains / statuses / exclude_contact_ids / include_contact_ids`
 * 为空数组时视为未设置。`include_contact_ids` 在其余 AND 条件之外并入（仍受 statuses 约束），
 * 然后 `exclude_contact_ids` 从并集中剔除。
 */
import { and, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { ContactFilter, industryAliases, type ContactFilterInput } from "@mailqivo/shared";
import { contacts } from "../../db/schema.ts";

const unique = <T>(list: T[]) => [...new Set(list)];

/** 转义 LIKE 通配符 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function buildContactWhere(input: ContactFilterInput): SQL {
  const filter = ContactFilter.parse(input);
  const conditions: SQL[] = [];

  if (filter.contact_ids) {
    conditions.push(filter.contact_ids.length ? inArray(contacts.id, filter.contact_ids) : sql`false`);
  }

  if (filter.statuses.length > 0) {
    conditions.push(inArray(contacts.status, filter.statuses));
  }

  if (filter.tags_any && filter.tags_any.length > 0) {
    const names = sql.join(unique(filter.tags_any).map((n) => sql`${n}`), sql`, `);
    conditions.push(sql`EXISTS (
      SELECT 1 FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = ${contacts.id} AND t.name IN (${names})
    )`);
  }

  if (filter.tags_all && filter.tags_all.length > 0) {
    const wanted = unique(filter.tags_all);
    const names = sql.join(wanted.map((n) => sql`${n}`), sql`, `);
    conditions.push(sql`(
      SELECT count(DISTINCT t.name) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE ct.contact_id = ${contacts.id} AND t.name IN (${names})
    ) = ${wanted.length}`);
  }

  if (filter.domains && filter.domains.length > 0) {
    const domains = unique(filter.domains.map((d) => d.trim().replace(/^@/, "").toLowerCase()).filter(Boolean));
    if (domains.length > 0) {
      conditions.push(sql`split_part(${contacts.email}, '@', 2) IN (${sql.join(domains.map((d) => sql`${d}`), sql`, `)})`);
    }
  }

  const keyword = filter.keyword?.trim();
  if (keyword) {
    const pattern = `%${escapeLike(keyword)}%`;
    conditions.push(
      or(ilike(contacts.email, pattern), ilike(contacts.name, pattern), ilike(contacts.company, pattern))!
    );
  }

  if (filter.import_batch_id) {
    conditions.push(eq(contacts.import_batch_id, filter.import_batch_id));
  }

  if (filter.exclude_domain_suspect) {
    conditions.push(eq(contacts.domain_suspect, false));
  }

  const industry = filter.industry?.trim();
  if (industry) {
    conditions.push(inArray(sql`${contacts.custom_fields}->>'industry'`, industryAliases(industry)));
  }

  let where: SQL = conditions.length > 0 ? and(...conditions)! : sql`true`;
  const includeIds = unique(filter.include_contact_ids ?? []);
  if (includeIds.length > 0) {
    const included = filter.statuses.length
      ? and(inArray(contacts.id, includeIds), inArray(contacts.status, filter.statuses))!
      : inArray(contacts.id, includeIds);
    where = or(where, included)!;
  }
  const excludeIds = unique(filter.exclude_contact_ids ?? []);
  if (excludeIds.length > 0) {
    where = and(where, notInArray(contacts.id, excludeIds))!;
  }
  return where;
}
