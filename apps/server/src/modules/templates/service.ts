import { desc, eq } from "drizzle-orm";
import type { TemplateBody, TemplateDto } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { templates } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";
import { sanitizeEmailHtml } from "../../render/sanitize.ts";

type Row = typeof templates.$inferSelect;
const dto = (row: Row): TemplateDto => ({
  id: row.id,
  name: row.name,
  category: row.category as TemplateDto["category"],
  subject: row.subject,
  html: row.html,
  editor_mode: row.editor_mode as TemplateDto["editor_mode"],
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString()
});
const clean = (body: TemplateBody) => ({ ...body, html: sanitizeEmailHtml(body.html) });

export async function listTemplates(db: Db) {
  return (await db.select().from(templates).orderBy(desc(templates.updated_at))).map(dto);
}
export async function getTemplate(db: Db, id: string) {
  const [row] = await db.select().from(templates).where(eq(templates.id, id));
  if (!row) throw Errors.notFound("模板不存在");
  return dto(row);
}
export async function createTemplate(db: Db, body: TemplateBody) {
  const [row] = await db.insert(templates).values(clean(body)).returning({ id: templates.id });
  return getTemplate(db, row!.id);
}
export async function updateTemplate(db: Db, id: string, body: TemplateBody) {
  await getTemplate(db, id);
  await db.update(templates).set({ ...clean(body), updated_at: new Date() }).where(eq(templates.id, id));
  return getTemplate(db, id);
}
export async function deleteTemplate(db: Db, id: string) {
  const rows = await db.delete(templates).where(eq(templates.id, id)).returning({ id: templates.id });
  if (!rows.length) throw Errors.notFound("模板不存在");
}
