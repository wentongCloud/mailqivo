import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ContactTagsBody, ContactTagsResult, TagDto } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { contactTags, contacts, tags } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";

const uniq = <T>(list: T[]) => [...new Set(list)];

/** 数据库唯一约束冲突（drizzle 把 pg 错误包了一层，原始错误在 cause） */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } } | undefined)?.cause;
  return cause?.code === "23505" && cause.constraint === constraint;
}

/** 按名称取标签 id；不存在的自动创建。返回 name → id。 */
export async function findOrCreateTags(db: Db, names: string[]): Promise<Map<string, string>> {
  const wanted = uniq(names);
  if (wanted.length === 0) return new Map();
  await db.insert(tags).values(wanted.map((name) => ({ name }))).onConflictDoNothing();
  const rows = await db.select().from(tags).where(inArray(tags.name, wanted));
  return new Map(rows.map((r) => [r.name, r.id]));
}

export async function listTags(db: Db): Promise<TagDto[]> {
  const rows = await db
    .select({
      id: tags.id,
      name: tags.name,
      contact_count: sql<number>`count(${contactTags.contact_id})::int`
    })
    .from(tags)
    .leftJoin(contactTags, eq(contactTags.tag_id, tags.id))
    .groupBy(tags.id, tags.name)
    .orderBy(asc(tags.name));
  return rows;
}

async function getTagDto(db: Db, id: string): Promise<TagDto> {
  const found = (await listTags(db)).find((t) => t.id === id);
  if (!found) throw Errors.notFound("标签不存在");
  return found;
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function createTag(db: Db, name: string): Promise<TagDto> {
  try {
    const [row] = await db.insert(tags).values({ name }).returning({ id: tags.id });
    return await getTagDto(db, row!.id);
  } catch (err) {
    if (isUniqueViolation(err, "tags_name_key")) {
      throw Errors.validation("标签已存在", [{ path: "name", message: "标签已存在" }]);
    }
    throw err;
  }
}

export async function renameTag(db: Db, id: string, name: string): Promise<TagDto> {
  if (!isUuid(id)) throw Errors.notFound("标签不存在");
  try {
    const rows = await db.update(tags).set({ name }).where(eq(tags.id, id)).returning({ id: tags.id });
    if (rows.length === 0) throw Errors.notFound("标签不存在");
  } catch (err) {
    if (isUniqueViolation(err, "tags_name_key")) {
      throw Errors.validation("标签已存在", [{ path: "name", message: "标签已存在" }]);
    }
    throw err;
  }
  return getTagDto(db, id);
}

export async function deleteTag(db: Db, id: string): Promise<void> {
  if (!isUuid(id)) throw Errors.notFound("标签不存在");
  const rows = await db.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
  if (rows.length === 0) throw Errors.notFound("标签不存在");
}

/** 批量打 / 去标签。`add` 中不存在的标签自动创建；不存在的联系人 id 被忽略（计入 matched 之外）。 */
export async function applyContactTags(db: Db, body: ContactTagsBody): Promise<ContactTagsResult> {
  const ids = uniq(body.contact_ids);
  const existing = await db.select({ id: contacts.id }).from(contacts).where(inArray(contacts.id, ids));
  const contactIds = existing.map((r) => r.id);
  let added = 0;
  let removed = 0;

  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    if (contactIds.length === 0) return;
    if (body.add && body.add.length > 0) {
      const tagIds = await findOrCreateTags(trx, body.add);
      const values = contactIds.flatMap((contact_id) =>
        [...tagIds.values()].map((tag_id) => ({ contact_id, tag_id }))
      );
      const inserted = await trx.insert(contactTags).values(values).onConflictDoNothing().returning({ c: contactTags.contact_id });
      added = inserted.length;
    }
    if (body.remove && body.remove.length > 0) {
      const rows = await trx.select({ id: tags.id }).from(tags).where(inArray(tags.name, uniq(body.remove)));
      if (rows.length > 0) {
        const deleted = await trx
          .delete(contactTags)
          .where(and(inArray(contactTags.contact_id, contactIds), inArray(contactTags.tag_id, rows.map((r) => r.id))))
          .returning({ c: contactTags.contact_id });
        removed = deleted.length;
      }
    }
  });

  return { matched: contactIds.length, added, removed };
}
