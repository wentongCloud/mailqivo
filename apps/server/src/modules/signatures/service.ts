import { desc, eq, ne } from "drizzle-orm";
import type { SignatureBody, SignatureDto } from "@mailqivo/shared";
import type { Db } from "../../db/client.ts";
import { signatures } from "../../db/schema.ts";
import { Errors } from "../../lib/errors.ts";
import { sanitizeEmailHtml } from "../../render/sanitize.ts";

type Row = typeof signatures.$inferSelect;
const dto = (row: Row): SignatureDto => ({ ...row, created_at: row.created_at.toISOString(), updated_at: row.updated_at.toISOString() });
const clean = (body: SignatureBody) => ({ ...body, html: sanitizeEmailHtml(body.html) });

export async function listSignatures(db: Db) {
  return (await db.select().from(signatures).orderBy(desc(signatures.is_default), desc(signatures.updated_at))).map(dto);
}
export async function getSignature(db: Db, id: string) {
  const [row] = await db.select().from(signatures).where(eq(signatures.id, id));
  if (!row) throw Errors.notFound("签名不存在");
  return dto(row);
}
export async function createSignature(db: Db, body: SignatureBody) {
  const id = await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    if (body.is_default) await trx.update(signatures).set({ is_default: false }).where(eq(signatures.is_default, true));
    const [row] = await trx.insert(signatures).values(clean(body)).returning({ id: signatures.id });
    return row!.id;
  });
  return getSignature(db, id);
}
export async function updateSignature(db: Db, id: string, body: SignatureBody) {
  await getSignature(db, id);
  await db.transaction(async (tx) => {
    const trx = tx as unknown as Db;
    if (body.is_default) await trx.update(signatures).set({ is_default: false, updated_at: new Date() }).where(ne(signatures.id, id));
    await trx.update(signatures).set({ ...clean(body), updated_at: new Date() }).where(eq(signatures.id, id));
  });
  return getSignature(db, id);
}
export async function deleteSignature(db: Db, id: string) {
  const rows = await db.delete(signatures).where(eq(signatures.id, id)).returning({ id: signatures.id });
  if (!rows.length) throw Errors.notFound("签名不存在");
}
